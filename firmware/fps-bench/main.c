#include <stdio.h>
#include <string.h>
#include "pico/stdlib.h"
#include "hardware/i2c.h"
#include "hardware/dma.h"

#define SH1106_ADDR 0x3C
#define I2C_PORT    i2c0
#define SDA_PIN     4
#define SCL_PIN     5
#define I2C_BAUD    1000000  // 1MHz

#define WIDTH       128
#define HEIGHT      64
#define PAGES       (HEIGHT / 8)
#define COL_OFFSET  2  // SH1106 has 132-col RAM, 128-col display offset by 2

static uint8_t framebuf[PAGES * WIDTH];
static uint8_t prevbuf[PAGES * WIDTH];

// DMA transfer buffer: 16-bit IC_DATA_CMD entries
// Worst case: 8 pages * (3 cmd bytes + 1 control + 128 data + overhead)
// Each I2C transaction: start+addr+data+stop encoded as 16-bit words
// Per page cmd: 2 words (control byte + cmd) per command * 3 commands = 6 words per transaction * 3 = ~18
// Per page data: 1 control byte + up to 128 data bytes = 129 words
// Total worst case: 8 * (18 + 129) = ~1176, round up
#define DMA_BUF_SIZE 1200
static uint16_t dma_buf[DMA_BUF_SIZE];
static int dma_chan = -1;
static volatile bool dma_busy = false;
static uint32_t dma_bytes_queued = 0;

static void sh1106_cmd(uint8_t cmd) {
    uint8_t buf[2] = {0x00, cmd};
    i2c_write_blocking(I2C_PORT, SH1106_ADDR, buf, 2, false);
}

static void sh1106_init(void) {
    sh1106_cmd(0xAE);
    sh1106_cmd(0xD5); sh1106_cmd(0x80);
    sh1106_cmd(0xA8); sh1106_cmd(0x3F);
    sh1106_cmd(0xD3); sh1106_cmd(0x00);
    sh1106_cmd(0x40);
    sh1106_cmd(0x8D); sh1106_cmd(0x14);
    sh1106_cmd(0xA1);
    sh1106_cmd(0xC8);
    sh1106_cmd(0xDA); sh1106_cmd(0x12);
    sh1106_cmd(0x81); sh1106_cmd(0x7F);
    sh1106_cmd(0xD9); sh1106_cmd(0x22);
    sh1106_cmd(0xDB); sh1106_cmd(0x20);
    sh1106_cmd(0xA4);
    sh1106_cmd(0xA6);
    sh1106_cmd(0xAF);
}

// Encode an I2C write transaction into 16-bit IC_DATA_CMD words
// Returns number of words written to dest
static int encode_i2c_write(uint16_t *dest, const uint8_t *data, int len) {
    int n = 0;
    for (int i = 0; i < len; i++) {
        uint16_t word = data[i];
        if (i == 0) word |= (1 << 11);       // RESTART (start condition)
        if (i == len - 1) word |= (1 << 9);  // STOP on last byte
        dest[n++] = word;
    }
    return n;
}

static void dma_init_i2c(void) {
    dma_chan = dma_claim_unused_channel(true);

    dma_channel_config c = dma_channel_get_default_config(dma_chan);
    channel_config_set_transfer_data_size(&c, DMA_SIZE_16);
    channel_config_set_read_increment(&c, true);
    channel_config_set_write_increment(&c, false);
    channel_config_set_dreq(&c, i2c_get_dreq(I2C_PORT, true));  // TX dreq

    dma_channel_configure(
        dma_chan, &c,
        &i2c_get_hw(I2C_PORT)->data_cmd,  // write to IC_DATA_CMD
        dma_buf,                            // read from buffer
        0,                                  // count set later
        false                               // don't start yet
    );
}

static void dma_wait(void) {
    if (dma_busy) {
        dma_channel_wait_for_finish_blocking(dma_chan);
        dma_busy = false;
    }
}

// Queue all dirty pages into dma_buf, then fire DMA
static uint32_t sh1106_flush_delta_dma(void) {
    dma_wait();  // ensure previous transfer done

    int pos = 0;
    uint32_t bytes_sent = 0;
    uint8_t cmd_buf[2];

    for (int page = 0; page < PAGES; page++) {
        int offset = page * WIDTH;

        int lo = -1, hi = -1;
        for (int x = 0; x < WIDTH; x++) {
            if (framebuf[offset + x] != prevbuf[offset + x]) {
                if (lo < 0) lo = x;
                hi = x;
            }
        }
        if (lo < 0) continue;

        int span = hi - lo + 1;
        int col = COL_OFFSET + lo;

        // Page address command
        cmd_buf[0] = 0x00;  // control: command mode
        cmd_buf[1] = 0xB0 | page;
        pos += encode_i2c_write(&dma_buf[pos], cmd_buf, 2);

        // Column low nibble
        cmd_buf[1] = 0x00 | (col & 0x0F);
        pos += encode_i2c_write(&dma_buf[pos], cmd_buf, 2);

        // Column high nibble
        cmd_buf[1] = 0x10 | ((col >> 4) & 0x0F);
        pos += encode_i2c_write(&dma_buf[pos], cmd_buf, 2);

        // Data: control byte 0x40 + pixel data
        // Build inline: first byte is 0x40 (data mode), rest is pixel data
        uint16_t *start = &dma_buf[pos];
        int data_len = 1 + span;

        // 0x40 control byte
        uint16_t word = 0x40 | (1 << 11);  // RESTART
        if (data_len == 1) word |= (1 << 9);  // STOP if only control byte
        start[0] = word;

        for (int i = 0; i < span; i++) {
            word = framebuf[offset + lo + i];
            if (i == span - 1) word |= (1 << 9);  // STOP on last
            start[1 + i] = word;
        }
        pos += data_len;

        bytes_sent += span;
        memcpy(&prevbuf[offset + lo], &framebuf[offset + lo], span);
    }

    if (pos > 0) {
        // Set target address
        i2c_get_hw(I2C_PORT)->enable = 0;
        i2c_get_hw(I2C_PORT)->tar = SH1106_ADDR;
        i2c_get_hw(I2C_PORT)->enable = 1;

        dma_channel_set_read_addr(dma_chan, dma_buf, false);
        dma_channel_set_trans_count(dma_chan, pos, true);  // start
        dma_busy = true;
        dma_bytes_queued = bytes_sent;
    }

    return bytes_sent;
}

static void sh1106_flush_full(void) {
    uint8_t buf[1 + WIDTH];
    buf[0] = 0x40;
    for (int page = 0; page < PAGES; page++) {
        sh1106_cmd(0xB0 | page);
        sh1106_cmd(0x00 | ((COL_OFFSET) & 0x0F));
        sh1106_cmd(0x10 | ((COL_OFFSET >> 4) & 0x0F));
        memcpy(&buf[1], &framebuf[page * WIDTH], WIDTH);
        i2c_write_blocking(I2C_PORT, SH1106_ADDR, buf, 1 + WIDTH, false);
    }
    memcpy(prevbuf, framebuf, sizeof(framebuf));
}

static void fill_dither50(void) {
    for (int page = 0; page < PAGES; page++) {
        int y0 = page * 8;
        for (int x = 0; x < WIDTH; x++) {
            uint8_t col = 0;
            for (int bit = 0; bit < 8; bit++) {
                if ((x + y0 + bit) & 1) col |= 1 << bit;
            }
            framebuf[page * WIDTH + x] = col;
        }
    }
}

static void hline(int x0, int x1, int y) {
    if (y < 0 || y >= HEIGHT) return;
    if (x0 < 0) x0 = 0;
    if (x1 >= WIDTH) x1 = WIDTH - 1;
    int page = y / 8;
    uint8_t mask = 1 << (y & 7);
    for (int x = x0; x <= x1; x++) {
        framebuf[page * WIDTH + x] |= mask;
    }
}

static void fill_circle(int cx, int cy, int r) {
    int x = r, y = 0, d = 1 - r;
    while (x >= y) {
        hline(cx - x, cx + x, cy + y);
        hline(cx - x, cx + x, cy - y);
        hline(cx - y, cx + y, cy + x);
        hline(cx - y, cx + y, cy - x);
        y++;
        if (d < 0) {
            d += 2 * y + 1;
        } else {
            x--;
            d += 2 * (y - x) + 1;
        }
    }
}

#define NUM_BALLS 5

typedef struct {
    int x, y, dx, dy, r;
} ball_t;

static uint32_t rng_state = 12345;
static uint32_t rng(void) {
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 17;
    rng_state ^= rng_state << 5;
    return rng_state;
}

#define NUM_STARS 30
typedef struct {
    int x, y, speed;
} star_t;

static void set_pixel(int x, int y) {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
    framebuf[(y / 8) * WIDTH + x] |= 1 << (y & 7);
}

int main(void) {
    stdio_init_all();

    i2c_init(I2C_PORT, I2C_BAUD);
    gpio_set_function(SDA_PIN, GPIO_FUNC_I2C);
    gpio_set_function(SCL_PIN, GPIO_FUNC_I2C);
    gpio_pull_up(SDA_PIN);
    gpio_pull_up(SCL_PIN);

    sleep_ms(100);
    sh1106_init();
    dma_init_i2c();

    ball_t balls[NUM_BALLS];
    for (int i = 0; i < NUM_BALLS; i++) {
        balls[i].r = 4 + (rng() % 8);
        balls[i].x = balls[i].r + (rng() % (WIDTH - 2 * balls[i].r));
        balls[i].y = balls[i].r + (rng() % (HEIGHT - 2 * balls[i].r));
        balls[i].dx = 1 + (rng() % 3);
        balls[i].dy = 1 + (rng() % 2);
        if (rng() & 1) balls[i].dx = -balls[i].dx;
        if (rng() & 1) balls[i].dy = -balls[i].dy;
    }

    star_t stars[NUM_STARS];
    for (int i = 0; i < NUM_STARS; i++) {
        stars[i].x = rng() % WIDTH;
        stars[i].y = rng() % HEIGHT;
        stars[i].speed = 1 + (rng() % 3);
    }

    #define TARGET_FPS 60
    #define FRAME_US (1000000 / TARGET_FPS)

    // First frame: full blocking flush
    fill_dither50();
    for (int i = 0; i < NUM_BALLS; i++)
        fill_circle(balls[i].x, balls[i].y, balls[i].r);
    sh1106_flush_full();

    uint32_t frame_count = 0;
    uint32_t total_bytes = 0;
    uint64_t total_game_us = 0;
    uint64_t total_flush_us = 0;
    absolute_time_t last_report = get_absolute_time();

    while (true) {
        absolute_time_t frame_start = get_absolute_time();

        // --- Game logic (runs while previous DMA may still be in flight) ---
        fill_dither50();

        for (int i = 0; i < NUM_STARS; i++) {
            stars[i].x -= stars[i].speed;
            if (stars[i].x < 0) {
                stars[i].x = WIDTH - 1;
                stars[i].y = rng() % HEIGHT;
            }
            set_pixel(stars[i].x, stars[i].y);
        }

        for (int i = 0; i < NUM_BALLS; i++) {
            balls[i].x += balls[i].dx;
            balls[i].y += balls[i].dy;
            int r = balls[i].r;
            if (balls[i].x - r <= 0 || balls[i].x + r >= WIDTH - 1)
                balls[i].dx = -balls[i].dx;
            if (balls[i].y - r <= 0 || balls[i].y + r >= HEIGHT - 1)
                balls[i].dy = -balls[i].dy;
            fill_circle(balls[i].x, balls[i].y, r);
        }

        absolute_time_t after_game = get_absolute_time();

        // --- Kick off DMA flush (waits for previous if still running) ---
        total_bytes += sh1106_flush_delta_dma();

        absolute_time_t after_flush = get_absolute_time();

        total_game_us += absolute_time_diff_us(frame_start, after_game);
        total_flush_us += absolute_time_diff_us(after_game, after_flush);
        frame_count++;

        absolute_time_t now = get_absolute_time();
        int64_t elapsed_us = absolute_time_diff_us(last_report, now);
        if (elapsed_us >= 1000000) {
            uint32_t avg_game = total_game_us / frame_count;
            uint32_t avg_flush = total_flush_us / frame_count;
            uint32_t avg_bytes = total_bytes / frame_count;
            uint32_t avail = FRAME_US - avg_game - avg_flush;
            float fps = (float)frame_count * 1000000.0f / (float)elapsed_us;
            printf("FPS: %.1f  game: %uus  flush: %uus  avail: %uus  bytes: %u\n",
                   fps, avg_game, avg_flush, avail, avg_bytes);
            frame_count = 0;
            total_bytes = 0;
            total_game_us = 0;
            total_flush_us = 0;
            last_report = now;
        }

        int64_t frame_elapsed = absolute_time_diff_us(frame_start, get_absolute_time());
        if (frame_elapsed < FRAME_US) {
            sleep_us(FRAME_US - frame_elapsed);
        }
    }

    return 0;
}
