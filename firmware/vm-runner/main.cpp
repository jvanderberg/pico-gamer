// VM Runner — runs VM bytecode on RP2040 with SH1106 display
//
// Hardware: Pico + SH1106 OLED (I2C) + KY-023 joystick + rotary encoder button
// Build:    ./firmware/build.sh vm-runner
// Deploy:   ./firmware/deploy.sh vm-runner

#include <stdio.h>
#include <string.h>
#include "pico/stdlib.h"
#include "hardware/adc.h"

#include "sh1106_dma.h"

// VM library
#include "vm.h"
#include "display.h"
#include "sprites.h"
#include "syscalls.h"
#include "runtime.h"
#include "memory.h"

// Game bytecode — override with -DGAME_HEADER=path/to/file.h
#ifndef GAME_HEADER
#include "game_bytecode.h"
#else
#include GAME_HEADER
#endif

// --- Input pin assignments ---
#ifndef JOY_X_PIN
#define JOY_X_PIN  26   // ADC0
#endif
#ifndef JOY_Y_PIN
#define JOY_Y_PIN  27   // ADC1
#endif
#ifndef JOY_SW_PIN
#define JOY_SW_PIN 22   // Joystick button (active low)
#endif
#ifndef ENC_SW_PIN
#define ENC_SW_PIN 6    // Encoder button (active low)
#endif

// ADC thresholds for digital joystick conversion (center ~2048)
#define JOY_THRESHOLD_LO 1400
#define JOY_THRESHOLD_HI 2700

// Input bit positions (matches VM INPUT syscall convention)
#define INPUT_UP    (1 << 0)
#define INPUT_DOWN  (1 << 1)
#define INPUT_LEFT  (1 << 2)
#define INPUT_RIGHT (1 << 3)
#define INPUT_A     (1 << 4)
#define INPUT_B     (1 << 5)

#define TARGET_FPS 60
#define FRAME_US   (1000000 / TARGET_FPS)

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

// Read joystick ADC + buttons → inputBits bitmask
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
    if (!gpio_get(JOY_SW_PIN)) bits |= INPUT_A;
    if (!gpio_get(ENC_SW_PIN)) bits |= INPUT_B;

    return bits;
}

int main() {
    stdio_init_all();

    // --- I2C for SH1106 ---
    i2c_init(I2C_PORT, I2C_BAUD);
    gpio_set_function(SDA_PIN, GPIO_FUNC_I2C);
    gpio_set_function(SCL_PIN, GPIO_FUNC_I2C);
    gpio_pull_up(SDA_PIN);
    gpio_pull_up(SCL_PIN);

    // --- ADC for joystick ---
    adc_init();
    adc_gpio_init(JOY_X_PIN);
    adc_gpio_init(JOY_Y_PIN);

    // --- GPIO for buttons ---
    gpio_init(JOY_SW_PIN);
    gpio_set_dir(JOY_SW_PIN, GPIO_IN);
    gpio_pull_up(JOY_SW_PIN);

    gpio_init(ENC_SW_PIN);
    gpio_set_dir(ENC_SW_PIN, GPIO_IN);
    gpio_pull_up(ENC_SW_PIN);

    // --- Display init ---
    sleep_ms(100);
    sh1106_init();
    dma_init_i2c();

    // --- VM init ---
    static VMState vm = createVM();
    static Framebuffer fb = createFramebuffer();
    static SpriteTable sprites = createSpriteTable();
    static WallTable walls = createWallTable();
    SyscallContext ctx = createSyscallContext(&fb, &sprites, &walls);

    // Load game bytecode
    loadProgram(vm.memory, GAME_PROGRAM, GAME_PROGRAM_SIZE);

    // Initial full flush (blank screen)
    memset(draw_buf, 0, SH1106_BUF_SIZE);
    sh1106_flush_full();

    uint32_t frame_count = 0;

    while (true) {
        absolute_time_t frame_start = get_absolute_time();

        // 1. Read input
        ctx.inputBits = read_input();
        ctx.elapsed_ms = (uint16_t)to_ms_since_boot(get_absolute_time());

        // 2. Execute one VM frame
        bool running = execGameFrame(vm, fb, ctx, sprites, walls);

        // 3. Convert VM framebuffer → SH1106 format
        fb_to_sh1106(frontBuf(fb), draw_buf);

        // 4. Wait for previous frame's DMA to finish
        dma_wait();

        // 5. Force full-dirty every 60 frames for error correction
        if (frame_count % 60 == 0) {
            memset(disp_buf, 0xFF, SH1106_BUF_SIZE);
        }

        // 6. Kick DMA for this frame
        sh1106_flush_delta_dma();

        frame_count++;

        if (!running) {
            // VM halted — show final frame and stop
            break;
        }

        // 7. Sleep to hit 60fps target
        int64_t elapsed = absolute_time_diff_us(frame_start, get_absolute_time());
        if (elapsed < FRAME_US) {
            sleep_us(FRAME_US - elapsed);
        }
    }

    // VM halted — wait for final DMA then idle
    dma_wait();
    while (true) {
        tight_loop_contents();
    }

    return 0;
}
