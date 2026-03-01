#pragma once
// SH1106 1.3" OLED display driver with DMA I2C flush
// Extracted from firmware/fps-bench/main.c

#include <string.h>
#include "pico/stdlib.h"
#include "hardware/i2c.h"
#include "hardware/dma.h"

#ifndef SH1106_ADDR
#define SH1106_ADDR 0x3C
#endif
#ifndef I2C_PORT
#define I2C_PORT    i2c0
#endif
#ifndef SDA_PIN
#define SDA_PIN     4
#endif
#ifndef SCL_PIN
#define SCL_PIN     5
#endif
#ifndef I2C_BAUD
#define I2C_BAUD    1000000  // 1MHz
#endif

#define SH1106_WIDTH      128
#define SH1106_HEIGHT     64
#define SH1106_PAGES      (SH1106_HEIGHT / 8)
#define SH1106_COL_OFFSET 2  // SH1106 has 132-col RAM, 128-col display offset by 2
#define SH1106_BUF_SIZE   (SH1106_PAGES * SH1106_WIDTH)  // 1024

// DMA transfer buffer: 16-bit IC_DATA_CMD entries
// Worst case: 8 pages * (command overhead + 128 data bytes) ≈ 1176, round up
#define DMA_BUF_SIZE 1200

static uint8_t  sh_buf_a[SH1106_BUF_SIZE];
static uint8_t  sh_buf_b[SH1106_BUF_SIZE];
static uint8_t *draw_buf = sh_buf_a;   // game draws here
static uint8_t *disp_buf = sh_buf_b;   // what's currently on the display
static uint16_t dma_buf[DMA_BUF_SIZE];
static int      dma_chan = -1;
static volatile bool     dma_busy = false;

static void sh1106_cmd(uint8_t cmd) {
    uint8_t buf[2] = {0x00, cmd};
    i2c_write_blocking(I2C_PORT, SH1106_ADDR, buf, 2, false);
}

static void sh1106_init(void) {
    sh1106_cmd(0xAE);                     // display off
    sh1106_cmd(0xD5); sh1106_cmd(0x80);   // clock div
    sh1106_cmd(0xA8); sh1106_cmd(0x3F);   // multiplex 64
    sh1106_cmd(0xD3); sh1106_cmd(0x00);   // display offset 0
    sh1106_cmd(0x40);                     // start line 0
    sh1106_cmd(0x8D); sh1106_cmd(0x14);   // charge pump on
    sh1106_cmd(0xA1);                     // segment remap
    sh1106_cmd(0xC8);                     // COM scan direction
    sh1106_cmd(0xDA); sh1106_cmd(0x12);   // COM pins
    sh1106_cmd(0x81); sh1106_cmd(0x7F);   // contrast
    sh1106_cmd(0xD9); sh1106_cmd(0x22);   // pre-charge
    sh1106_cmd(0xDB); sh1106_cmd(0x20);   // VCOMH deselect
    sh1106_cmd(0xA4);                     // display from RAM
    sh1106_cmd(0xA6);                     // normal (not inverted)
    sh1106_cmd(0xAF);                     // display on
}

// Encode an I2C write transaction into 16-bit IC_DATA_CMD words
static int encode_i2c_write(uint16_t *dest, const uint8_t *data, int len) {
    int n = 0;
    for (int i = 0; i < len; i++) {
        uint16_t word = data[i];
        if (i == 0) word |= (1 << 11);       // RESTART
        if (i == len - 1) word |= (1 << 9);  // STOP on last byte
        dest[n++] = word;
    }
    return n;
}

static void dma_irq_handler(void) {
    dma_hw->ints0 = 1u << dma_chan;
    dma_busy = false;
}

static void dma_init_i2c(void) {
    dma_chan = dma_claim_unused_channel(true);

    dma_channel_config c = dma_channel_get_default_config(dma_chan);
    channel_config_set_transfer_data_size(&c, DMA_SIZE_16);
    channel_config_set_read_increment(&c, true);
    channel_config_set_write_increment(&c, false);
    channel_config_set_dreq(&c, i2c_get_dreq(I2C_PORT, true));

    dma_channel_configure(
        dma_chan, &c,
        &i2c_get_hw(I2C_PORT)->data_cmd,
        dma_buf,
        0,
        false
    );

    dma_channel_set_irq0_enabled(dma_chan, true);
    irq_set_exclusive_handler(DMA_IRQ_0, dma_irq_handler);
    irq_set_enabled(DMA_IRQ_0, true);
}

static void dma_wait(void) {
    if (dma_busy) {
        while (dma_busy) tight_loop_contents();
        // DMA done = TX FIFO fed, but I2C may still be clocking out bytes
        while (!(i2c_get_hw(I2C_PORT)->raw_intr_stat & I2C_IC_RAW_INTR_STAT_TX_EMPTY_BITS))
            tight_loop_contents();
        while (i2c_get_hw(I2C_PORT)->status & I2C_IC_STATUS_ACTIVITY_BITS)
            tight_loop_contents();
    }
}

// Diff draw_buf vs disp_buf, DMA the deltas, then swap buffers.
// Caller must dma_wait() first.
static void sh1106_flush_delta_dma(void) {
    int pos = 0;
    uint8_t cmd_buf[2];

    for (int page = 0; page < SH1106_PAGES; page++) {
        int offset = page * SH1106_WIDTH;

        int lo = -1, hi = -1;
        for (int x = 0; x < SH1106_WIDTH; x++) {
            if (draw_buf[offset + x] != disp_buf[offset + x]) {
                if (lo < 0) lo = x;
                hi = x;
            }
        }
        if (lo < 0) continue;

        int span = hi - lo + 1;
        int col = SH1106_COL_OFFSET + lo;

        cmd_buf[0] = 0x00;
        cmd_buf[1] = 0xB0 | page;
        pos += encode_i2c_write(&dma_buf[pos], cmd_buf, 2);

        cmd_buf[1] = 0x00 | (col & 0x0F);
        pos += encode_i2c_write(&dma_buf[pos], cmd_buf, 2);

        cmd_buf[1] = 0x10 | ((col >> 4) & 0x0F);
        pos += encode_i2c_write(&dma_buf[pos], cmd_buf, 2);

        uint16_t *start = &dma_buf[pos];
        int data_len = 1 + span;

        uint16_t word = 0x40 | (1 << 11);  // data mode + RESTART
        if (data_len == 1) word |= (1 << 9);
        start[0] = word;

        for (int i = 0; i < span; i++) {
            word = draw_buf[offset + lo + i];
            if (i == span - 1) word |= (1 << 9);  // STOP on last
            start[1 + i] = word;
        }
        pos += data_len;
    }

    if (pos > 0) {
        i2c_get_hw(I2C_PORT)->enable = 0;
        i2c_get_hw(I2C_PORT)->tar = SH1106_ADDR;
        i2c_get_hw(I2C_PORT)->enable = 1;

        dma_channel_set_read_addr(dma_chan, dma_buf, false);
        dma_channel_set_trans_count(dma_chan, pos, true);
        dma_busy = true;
    }

    // Swap: draw_buf becomes the new display reference
    uint8_t *tmp = draw_buf;
    draw_buf = disp_buf;
    disp_buf = tmp;
}

// Blocking full-screen refresh (used on first frame and periodic correction)
static void sh1106_flush_full(void) {
    uint8_t buf[1 + SH1106_WIDTH];
    buf[0] = 0x40;  // data mode
    for (int page = 0; page < SH1106_PAGES; page++) {
        sh1106_cmd(0xB0 | page);
        sh1106_cmd(0x00 | ((SH1106_COL_OFFSET) & 0x0F));
        sh1106_cmd(0x10 | ((SH1106_COL_OFFSET >> 4) & 0x0F));
        memcpy(&buf[1], &draw_buf[page * SH1106_WIDTH], SH1106_WIDTH);
        i2c_write_blocking(I2C_PORT, SH1106_ADDR, buf, 1 + SH1106_WIDTH, false);
    }
    // Swap so disp_buf reflects what's on screen
    uint8_t *tmp = draw_buf;
    draw_buf = disp_buf;
    disp_buf = tmp;
}
