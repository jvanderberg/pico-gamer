// VM Runner — runs VM bytecode on RP2040 with SH1106 display
//
// Boot flow:
//   1. Init hardware, auto-format FAT12 if no valid filesystem
//   2. Init USB MSC via Adafruit TinyUSB (device appears as USB drive)
//   3. Show game menu on OLED — list .GAME/.BIN files from FAT12
//   4. User selects game → load from FAT12 → run VM
//
// Hardware: Pico + SH1106 OLED (I2C) + KY-023 joystick + rotary encoder button
// Build:    cd firmware/vm-runner && pio run
// Deploy:   cd firmware/vm-runner && pio run -t upload

#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <RotaryEncoder.h>

#include <string.h>
#include "pico/stdlib.h"
#include "hardware/adc.h"
#include "hardware/flash.h"
#include "hardware/sync.h"

#include "sh1106_dma.h"

// VM library
#include "vm.h"
#include "display.h"
#include "font.h"
#include "sprites.h"
#include "particles.h"
#include "syscalls.h"
#include "runtime.h"
#include "memory.h"

// Storage
extern "C" {
#include "flash_store.h"
#include "fat12.h"
}

// --- USB MSC with deferred writes ---
// USB callbacks run from IRQ context — no cross-TU function calls, no flash ops.
// Writes go to a RAM queue; the main loop drains them to flash.

Adafruit_USBD_MSC usb_msc;

#define WQ_SIZE 128  // 64KB queue — enough for small file copies
struct WQEntry {
    uint32_t lba;
    uint8_t  data[FLASH_SECTOR_SIZE];
};

static WQEntry          wq[WQ_SIZE];
static volatile uint32_t wq_head = 0;
static volatile uint32_t wq_tail = 0;
static volatile bool     wq_flush = false;

// Inline RMW flash cache (bypasses flash_store.c which doesn't work)
static uint8_t  rw_cache[FLASH_ERASE_SIZE];
static int32_t  rw_block = -1;
static bool     rw_dirty = false;

static void rw_flush(void) {
    if (!rw_dirty || rw_block < 0) return;
    uint32_t off = FLASH_PARTITION_OFFSET + (uint32_t)rw_block * FLASH_ERASE_SIZE;
    uint32_t ints = save_and_disable_interrupts();
    flash_range_erase(off, FLASH_ERASE_SIZE);
    flash_range_program(off, rw_cache, FLASH_ERASE_SIZE);
    restore_interrupts(ints);
    rw_dirty = false;
}

static void rw_write_sector(uint32_t lba, const uint8_t *data) {
    int32_t block = (int32_t)(lba / FLASH_SECTORS_PER_BLOCK);
    uint32_t off  = (lba % FLASH_SECTORS_PER_BLOCK) * FLASH_SECTOR_SIZE;
    if (block != rw_block) {
        rw_flush();
        rw_block = block;
        const uint8_t *src = (const uint8_t *)(XIP_BASE + FLASH_PARTITION_OFFSET
                                               + (uint32_t)block * FLASH_ERASE_SIZE);
        memcpy(rw_cache, src, FLASH_ERASE_SIZE);
    }
    memcpy(rw_cache + off, data, FLASH_SECTOR_SIZE);
    rw_dirty = true;
}

// Drain pending writes to flash (call from main loop only)
static void process_writes(void) {
    while (wq_tail != wq_head) {
        uint32_t t = wq_tail;
        rw_write_sector(wq[t].lba, wq[t].data);
        wq_tail = (t + 1) % WQ_SIZE;
    }
    if (wq_flush) {
        rw_flush();
        wq_flush = false;
    }
}

int32_t msc_read(uint32_t lba, void *buf, uint32_t bufsize) {
    uint32_t sectors = bufsize / FLASH_SECTOR_SIZE;
    uint8_t *out = (uint8_t *)buf;

    for (uint32_t s = 0; s < sectors; s++) {
        uint32_t target = lba + s;
        bool found = false;

        // Check write queue (newest first) for pending data
        uint32_t h = wq_head, t = wq_tail;
        uint32_t i = h;
        while (i != t) {
            i = (i + WQ_SIZE - 1) % WQ_SIZE;
            if (wq[i].lba == target) {
                memcpy(out + s * FLASH_SECTOR_SIZE, wq[i].data, FLASH_SECTOR_SIZE);
                found = true;
                break;
            }
        }

        if (!found) {
            const uint8_t *src = (const uint8_t *)(XIP_BASE + FLASH_PARTITION_OFFSET
                                                   + target * FLASH_SECTOR_SIZE);
            memcpy(out + s * FLASH_SECTOR_SIZE, src, FLASH_SECTOR_SIZE);
        }
    }
    return (int32_t)bufsize;
}

int32_t msc_write(uint32_t lba, uint8_t *buf, uint32_t bufsize) {
    uint32_t sectors = bufsize / FLASH_SECTOR_SIZE;
    for (uint32_t s = 0; s < sectors; s++) {
        uint32_t next = (wq_head + 1) % WQ_SIZE;
        if (next == wq_tail) break;  // queue full — drop
        wq[wq_head].lba = lba + s;
        memcpy(wq[wq_head].data, buf + s * FLASH_SECTOR_SIZE, FLASH_SECTOR_SIZE);
        wq_head = next;
    }
    return (int32_t)bufsize;
}

void msc_flush() { wq_flush = true; }

// --- Input pin assignments ---
#ifndef JOY_X_PIN
#define JOY_X_PIN  26   // ADC0
#endif
#ifndef JOY_Y_PIN
#define JOY_Y_PIN  27   // ADC1
#endif
#ifndef CONF_BTN_PIN
#define CONF_BTN_PIN 9   // Confirm button (active low)
#endif
#ifndef BACK_BTN_PIN
#define BACK_BTN_PIN 10  // Back button (active low)
#endif
#ifndef ENC_A_PIN
#define ENC_A_PIN  6    // Encoder A (CLK)
#endif
#ifndef ENC_B_PIN
#define ENC_B_PIN  7    // Encoder B (DT)
#endif
#ifndef ENC_SW_PIN
#define ENC_SW_PIN 8    // Encoder button (active low)
#endif

// ADC thresholds for digital joystick conversion (center ~2048)
#define JOY_THRESHOLD_LO 1400
#define JOY_THRESHOLD_HI 2700

// Input bit positions (matches VM INPUT syscall convention)
#define INPUT_UP      (1 << 0)
#define INPUT_DOWN    (1 << 1)
#define INPUT_LEFT    (1 << 2)
#define INPUT_RIGHT   (1 << 3)
#define INPUT_BTN     (1 << 4)
#define INPUT_ENC_CW  (1 << 5)
#define INPUT_ENC_CCW (1 << 6)
#define INPUT_ENC_BTN (1 << 7)

#define TARGET_FPS 60
#define FRAME_US   (1000000 / TARGET_FPS)

// --- Encoder (interrupt-driven via RotaryEncoder library) ---
static RotaryEncoder encoder(ENC_A_PIN, ENC_B_PIN, RotaryEncoder::LatchMode::FOUR3);

// Accumulated signed detents from encoder position deltas.
static volatile int16_t enc_detent_accum = 0;  // signed detents (+/-)
static volatile long    enc_poll_pos = 0;

static void reset_encoder_queue(void) {
    uint32_t ints = save_and_disable_interrupts();
    enc_detent_accum = 0;
    enc_poll_pos = encoder.getPosition();
    restore_interrupts(ints);
}

static void encoderISR(void) {
    // Keep ISR minimal: library updates quadrature state.
    encoder.tick();
}

// Encoder button latch — ISR captures press so quick clicks aren't missed between frames
static volatile bool     enc_btn_latch  = false;
static volatile uint32_t enc_btn_isr_us = 0;
#define ENC_BTN_DEBOUNCE_US 50000  // 50ms

static void encBtnISR(void) {
    uint32_t now = time_us_32();
    if (now - enc_btn_isr_us > ENC_BTN_DEBOUNCE_US) {
        enc_btn_latch = true;
        enc_btn_isr_us = now;
    }
}

// --- State machine ---
enum AppState { STATE_MENU, STATE_GAME };
static AppState app_state = STATE_MENU;

// Game menu state
#define MAX_GAMES 32

struct GameEntry {
    char     name[FAT12_MAX_LFN];
    uint32_t size;
    uint16_t first_cluster;
};

static GameEntry game_list[MAX_GAMES];
static int       game_count = 0;

// Menu state
static int      menu_selected = 0;
static int      menu_scroll = 0;
static uint16_t menu_prev_input = 0;
static uint32_t menu_last_scan_ms = 0;

// Game state
static VMState         vm;
static SpriteTable     sprites;
static WallTable       walls;
static ParticleTable   particles;
static SyscallContext   game_ctx;
static uint32_t        game_frame_count = 0;

// Shared
static Framebuffer fb;

// Convert VM horizontal-bitmap framebuffer to SH1106 vertical-page format.
//
// VM format:  byte[(y * 128 + x) / 8], bit 7-(x&7)  — row-major, MSB-first
// SH1106:    byte[(y/8) * 128 + x],    bit (y&7)     — column-major, LSB=top
static void fb_to_sh1106(const uint8_t* fb_data, uint8_t* sh_data) {
    for (int x = 0; x < 128; x++) {
        int byteX = x >> 3;
        uint8_t mask = 1 << (7 - (x & 7));
        for (int page = 0; page < 8; page++) {
            uint8_t col = 0;
            int baseRow = page * 8;
            for (int bit = 0; bit < 8; bit++) {
                if (fb_data[(baseRow + bit) * 16 + byteX] & mask)
                    col |= (1 << bit);
            }
            sh_data[page * 128 + x] = col;
        }
    }
}

// Read controls -> VM INPUT() word:
//   low byte: input bits (legacy)
//   high byte: signed encoder delta (detents accumulated this frame)
static uint16_t read_input(void) {
    uint16_t bits = 0;

    // Read joystick X axis (ADC0)
    adc_select_input(JOY_X_PIN - 26);
    uint16_t joy_x = adc_read();

    // Read joystick Y axis (ADC1)
    adc_select_input(JOY_Y_PIN - 26);
    uint16_t joy_y = adc_read();

    // Threshold to digital
    if (joy_y < JOY_THRESHOLD_LO) bits |= INPUT_UP;
    if (joy_y > JOY_THRESHOLD_HI) bits |= INPUT_DOWN;
    if (joy_x < JOY_THRESHOLD_LO) bits |= INPUT_LEFT;
    if (joy_x > JOY_THRESHOLD_HI) bits |= INPUT_RIGHT;

    // Buttons (active low — pull-up, pressed = 0)
    if (!gpio_get(CONF_BTN_PIN)) bits |= INPUT_BTN;

    // Encoder button (latched by ISR to catch clicks between frames)
    bool enc_btn_from_isr = false;
    uint32_t ints = save_and_disable_interrupts();
    enc_btn_from_isr = enc_btn_latch;
    enc_btn_latch = false;
    restore_interrupts(ints);
    if (enc_btn_from_isr || !gpio_get(ENC_SW_PIN)) {
        bits |= INPUT_ENC_BTN;
    }

    // Fold all encoder movement since last frame into accumulator.
    ints = save_and_disable_interrupts();
    long pos = encoder.getPosition();
    long diff = pos - enc_poll_pos;
    enc_poll_pos = pos;
    restore_interrupts(ints);
    if (diff != 0) {
        // RotaryEncoder position increases in opposite sign to VM CW/CCW convention.
        int32_t next = (int32_t)enc_detent_accum - (int32_t)diff;
        if (next > 32767) next = 32767;
        if (next < -32768) next = -32768;
        enc_detent_accum = (int16_t)next;
    }

    // Encoder rotation: emit signed int8 this frame, carry excess into next frames.
    ints = save_and_disable_interrupts();
    int8_t enc_delta = 0;
    int16_t accum = enc_detent_accum;
    if (accum > 127) {
        enc_delta = 127;
        enc_detent_accum = (int16_t)(accum - 127);
    } else if (accum < -128) {
        enc_delta = -128;
        enc_detent_accum = (int16_t)(accum + 128);
    } else {
        enc_delta = (int8_t)accum;
        enc_detent_accum = 0;
    }
    restore_interrupts(ints);

    // Legacy direction bits are derived from the same delta.
    if (enc_delta > 0) bits |= INPUT_ENC_CW;
    else if (enc_delta < 0) bits |= INPUT_ENC_CCW;

    return (uint16_t)(bits | ((uint16_t)((uint8_t)enc_delta) << 8));
}

// --- FAT12 directory scan ---

static bool has_game_ext(const char *name) {
    const char *dot = strrchr(name, '.');
    if (!dot) return false;
    return (strcasecmp(dot, ".GAM") == 0 ||
            strcasecmp(dot, ".BIN") == 0 ||
            strcasecmp(dot, ".GAME") == 0);
}

static void collect_game(const Fat12Entry *entry, void *user_data) {
    (void)user_data;
    if (game_count >= MAX_GAMES) return;
    const char *check_name = (entry->long_name[0] != '\0') ? entry->long_name : entry->name;
    if (!has_game_ext(check_name)) return;
    // Skip macOS resource fork files (._filename)
    if (check_name[0] == '.') return;

    GameEntry *g = &game_list[game_count];

    // Prefer long filename, fall back to 8.3 short name
    const char *src = (entry->long_name[0] != '\0') ? entry->long_name : entry->name;
    strncpy(g->name, src, FAT12_MAX_LFN - 1);
    g->name[FAT12_MAX_LFN - 1] = '\0';

    // Strip extension for display
    char *dot = strrchr(g->name, '.');
    if (dot) *dot = '\0';

    // Uppercase for font compatibility
    for (char *p = g->name; *p; p++) {
        if (*p >= 'a' && *p <= 'z') *p -= 32;
        if (*p == '~') *p = '-';
    }
    g->size          = entry->size;
    g->first_cluster = entry->first_cluster;
    game_count++;
}

static void scan_games(void) {
    game_count = 0;
    fat12_list_files(collect_game, nullptr);
}

// --- Menu rendering ---

// Draw the game selection menu using the VM's font renderer.
// Uses small font (3x5, advance 4) for filenames, large font (5x7, advance 6) for title.
static void draw_menu(int selected, int scroll_offset) {
    clearFB(fb);

    // Title bar
    drawText(fb, "PICO GAMER", 1, 1, FONT_LG, 5, 7, 6);
    // Separator line
    drawLine(fb, 0, 10, 127, 10, 1);

    if (game_count == 0) {
        drawText(fb, "NO GAMES FOUND", 4, 20, FONT_SM, 3, 5, 4);
        drawText(fb, "CONNECT USB TO", 4, 30, FONT_SM, 3, 5, 4);
        drawText(fb, "COPY .GAME FILES", 4, 40, FONT_SM, 3, 5, 4);
    } else {
        // Show up to 7 entries (each 7px tall, starting at y=13)
        int visible = 5;
        for (int i = 0; i < visible && (scroll_offset + i) < game_count; i++) {
            int idx = scroll_offset + i;
            int y = 13 + i * 10;

            if (idx == selected) {
                drawText(fb, game_list[idx].name, 2, y, FONT_LG, 5, 7, 6);
                uint8_t *buf = backBuf(fb);
                for (int bx = 0; bx < 16; bx++) {
                    for (int by = y - 1; by < y + 9 && by < 64; by++) {
                        buf[by * 16 + bx] ^= 0xFF;
                    }
                }
            } else {
                drawText(fb, game_list[idx].name, 2, y, FONT_LG, 5, 7, 6);
            }
        }

        // Scroll indicators
        if (scroll_offset > 0) {
            drawText(fb, "^", 122, 13, FONT_LG, 5, 7, 6);
        }
        if (scroll_offset + visible < game_count) {
            drawText(fb, "v", 122, 57, FONT_LG, 5, 7, 6);
        }
    }

    swapBuffers(fb);
}

// --- State transitions ---

static void start_game(int game_idx) {
    reset_encoder_queue();
    resetVM(vm);
    sprites = createSpriteTable();
    walls = createWallTable();
    particles = createParticleTable();
    game_ctx = createSyscallContext(&fb, &sprites, &walls, &particles);

    // Load game bytecode from FAT12
    GameEntry *g = &game_list[game_idx];
    uint32_t load_size = g->size;
    if (load_size > 65536) load_size = 65536;  // clamp to VM memory size

    fat12_read_file(g->first_cluster, load_size, vm.memory);

    // Initial full flush (blank screen)
    memset(draw_buf, 0, SH1106_BUF_SIZE);
    sh1106_flush_full();

    game_frame_count = 0;
    app_state = STATE_GAME;
}

static void return_to_menu(void) {
    reset_encoder_queue();
    fat12_init();
    scan_games();
    menu_selected = 0;
    menu_scroll = 0;
    menu_prev_input = 0;
    menu_last_scan_ms = 0;
    app_state = STATE_MENU;
}

// --- Per-frame tick functions ---

static void menu_tick(void) {
    absolute_time_t frame_start = get_absolute_time();

    // Periodically re-scan directory (catches new files from USB)
    uint32_t now_ms = to_ms_since_boot(get_absolute_time());
    if (now_ms - menu_last_scan_ms > 2000) {
        int prev_count = game_count;
        scan_games();
        if (game_count != prev_count) {
            // List changed — clamp selection
            if (menu_selected >= game_count) menu_selected = game_count > 0 ? game_count - 1 : 0;
            if (menu_scroll > menu_selected) menu_scroll = menu_selected;
        }
        menu_last_scan_ms = now_ms;
    }

    // Read input (edge-triggered)
    uint16_t input = read_input();
    int8_t enc_delta = (int8_t)(input >> 8);
    uint16_t pressed = input & ~menu_prev_input;  // newly pressed bits
    menu_prev_input = input;

    if (game_count > 0) {
        int visible = 5;

        // Encoder rotation from signed delta (single input path).
        while (enc_delta < 0) {
            if (menu_selected > 0) {
                menu_selected--;
                if (menu_selected < menu_scroll) menu_scroll = menu_selected;
            }
            enc_delta++;
        }
        while (enc_delta > 0) {
            if (menu_selected < game_count - 1) {
                menu_selected++;
                if (menu_selected >= menu_scroll + visible) menu_scroll = menu_selected - visible + 1;
            }
            enc_delta--;
        }

        // Button select (edge-triggered)
        if (pressed & (INPUT_BTN | INPUT_ENC_BTN)) {
            fat12_init();
            start_game(menu_selected);
            return;
        }
    }

    // Draw menu
    draw_menu(menu_selected, menu_scroll);
    fb_to_sh1106(frontBuf(fb), draw_buf);

    dma_wait();
    sh1106_flush_delta_dma();

    // Maintain ~30fps for menu — use delay() so yield() services USB
    int64_t elapsed = absolute_time_diff_us(frame_start, get_absolute_time());
    int64_t target_us = 1000000 / 30;
    if (elapsed < target_us) {
        delay((target_us - elapsed) / 1000);
    }
}

static void game_tick(void) {
    absolute_time_t frame_start = get_absolute_time();

    // 1. Read input
    game_ctx.inputBits = read_input();
    game_ctx.elapsed_ms = (uint16_t)to_ms_since_boot(get_absolute_time());

    // 2. Execute one VM frame
    bool running = execGameFrame(vm, fb, game_ctx, sprites, walls);

    // 3. Convert VM framebuffer -> SH1106 format
    fb_to_sh1106(frontBuf(fb), draw_buf);

    // 4. Wait for previous frame's DMA to finish
    dma_wait();

    // 5. Force full-dirty every 60 frames for error correction
    if (game_frame_count % 60 == 0) {
        memset(disp_buf, 0xFF, SH1106_BUF_SIZE);
    }

    // 6. Kick DMA for this frame
    sh1106_flush_delta_dma();

    game_frame_count++;

    if (!running) {
        // VM halted — show final frame briefly
        dma_wait();
        sleep_ms(1000);
        return_to_menu();
        return;
    }

    // 7. Sleep to hit 60fps target — use delay() so yield() services USB
    int64_t elapsed = absolute_time_diff_us(frame_start, get_absolute_time());
    if (elapsed < FRAME_US) {
        delay((FRAME_US - elapsed) / 1000);
    }
}

// --- Arduino entry points ---

void setup() {
    // Manual begin for cores without built-in support (mbed rp2040)
    if (!TinyUSBDevice.isInitialized()) {
        TinyUSBDevice.begin(0);
    }

    Serial.begin(115200);

    // USB MSC
    usb_msc.setID("PicoGmr", "PICO GAMER", "1.0");
    usb_msc.setCapacity(FLASH_TOTAL_SECTORS, FLASH_SECTOR_SIZE);
    usb_msc.setReadWriteCallback(msc_read, msc_write, msc_flush);
    usb_msc.setUnitReady(true);
    usb_msc.begin();

    // If already enumerated, MSC won't take effect until re-enumeration
    if (TinyUSBDevice.mounted()) {
        TinyUSBDevice.detach();
        delay(10);
        TinyUSBDevice.attach();
    }

    // I2C for SH1106
    i2c_init(I2C_PORT, I2C_BAUD);
    gpio_set_function(SDA_PIN, GPIO_FUNC_I2C);
    gpio_set_function(SCL_PIN, GPIO_FUNC_I2C);
    gpio_pull_up(SDA_PIN);
    gpio_pull_up(SCL_PIN);

    // ADC for joystick
    adc_init();
    adc_gpio_init(JOY_X_PIN);
    adc_gpio_init(JOY_Y_PIN);

    // GPIO for buttons
    gpio_init(CONF_BTN_PIN);
    gpio_set_dir(CONF_BTN_PIN, GPIO_IN);
    gpio_pull_up(CONF_BTN_PIN);

    gpio_init(BACK_BTN_PIN);
    gpio_set_dir(BACK_BTN_PIN, GPIO_IN);
    gpio_pull_up(BACK_BTN_PIN);

    pinMode(ENC_A_PIN, INPUT_PULLUP);
    pinMode(ENC_B_PIN, INPUT_PULLUP);
    pinMode(ENC_SW_PIN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(ENC_A_PIN), encoderISR, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENC_B_PIN), encoderISR, CHANGE);
    attachInterrupt(digitalPinToInterrupt(ENC_SW_PIN), encBtnISR, FALLING);
    reset_encoder_queue();

    // Display
    sleep_ms(100);
    sh1106_init();
    dma_init_i2c();

    // Flash + filesystem
    flash_store_init();

    if (!flash_store_has_filesystem()) {
        flash_store_format();
    }

    fat12_init();

    // Framebuffer + VM
    fb = createFramebuffer();
    vm = createVM();
    sprites = createSpriteTable();
    walls = createWallTable();
    particles = createParticleTable();

    // Blank screen
    memset(draw_buf, 0, SH1106_BUF_SIZE);
    sh1106_flush_full();

    // Start in menu
    scan_games();
}

void loop() {
    #ifdef TINYUSB_NEED_POLLING_TASK
    TinyUSBDevice.task();
    #endif

    // Drain USB write queue to flash (deferred from IRQ context)
    process_writes();

    switch (app_state) {
        case STATE_MENU: menu_tick(); break;
        case STATE_GAME: game_tick(); break;
    }
}
