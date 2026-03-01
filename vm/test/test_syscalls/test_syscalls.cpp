#include <unity.h>
#include "vm.h"
#include "display.h"
#include "sprites.h"
#include "syscalls.h"
#include "assembler.h"
#include "memory.h"

static VMState vm;
static Framebuffer fb;
static SpriteTable sprites;
static WallTable walls;
static SyscallContext ctx;

void setUp(void) {
    vm = createVM();
    fb = createFramebuffer();
    sprites = createSpriteTable();
    walls = createWallTable();
    ctx = createSyscallContext(&fb, &sprites, &walls);
}
void tearDown(void) {}

// Helper: assemble and load
static void loadAsm(const char* source) {
    AssemblerResult r = assemble(source);
    if (r.error) {
        TEST_FAIL_MESSAGE(r.errorMsg);
        return;
    }
    resetVM(vm);
    resetSpriteTable(sprites);
    resetWallTable(walls);
    ctx.yieldRequested = false;
    loadProgram(vm.memory, r.bytecode, r.length);
}

// Helper: run until halt or yield
static void runUntilStop(void) {
    int budget = 50000;
    while (budget-- > 0 && !vm.halted && !ctx.yieldRequested) {
        step(vm, handleSyscall, &ctx);
    }
}

void test_clear_syscall(void) {
    setPixel(fb, 10, 10, 1);
    loadAsm("SYSCALL 0\nHALT");
    runUntilStop();
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 10, 10));
}

void test_pixel_syscall(void) {
    loadAsm(
        "PUSH8 50\n"   // x
        "PUSH8 30\n"   // y
        "PUSH8 1\n"    // color
        "SYSCALL 1\n"  // PIXEL
        "HALT\n"
    );
    runUntilStop();
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 50, 30));
}

void test_line_syscall(void) {
    // LINE: push y0, x0, y1, x1
    loadAsm(
        "PUSH8 5\n"    // y0
        "PUSH8 10\n"   // x0
        "PUSH8 5\n"    // y1
        "PUSH8 20\n"   // x1
        "SYSCALL 2\n"  // LINE
        "HALT\n"
    );
    runUntilStop();
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 10, 5));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 20, 5));
}

void test_rect_syscall(void) {
    loadAsm(
        "PUSH8 10\n"   // x
        "PUSH8 10\n"   // y
        "PUSH8 4\n"    // w
        "PUSH8 4\n"    // h
        "SYSCALL 3\n"  // RECT
        "HALT\n"
    );
    runUntilStop();
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 10, 10));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 13, 13));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 14, 10));
}

void test_yield_syscall(void) {
    loadAsm("SYSCALL 6\nHALT");
    step(vm, handleSyscall, &ctx); // SYSCALL 6 (YIELD)
    TEST_ASSERT_TRUE(ctx.yieldRequested);
    TEST_ASSERT_FALSE(vm.halted);
}

void test_input_syscall(void) {
    ctx.inputBits = 0x0F; // up+down+left+right
    loadAsm("SYSCALL 16\nHALT"); // INPUT = 0x10
    runUntilStop();
    TEST_ASSERT_EQUAL_UINT16(0x0F, pop(vm));
}

void test_rand_syscall(void) {
    ctx.rngState = 1;
    loadAsm("SYSCALL 32\nHALT"); // RAND = 0x20
    runUntilStop();
    uint16_t val = pop(vm);
    TEST_ASSERT_NOT_EQUAL(0, val); // xorshift16 with seed=1 should produce nonzero
}

void test_rand_deterministic(void) {
    ctx.rngState = 42;
    loadAsm("SYSCALL 32\nSYSCALL 32\nHALT");
    runUntilStop();
    uint16_t v2 = pop(vm);
    uint16_t v1 = pop(vm);

    // Reset and run again with same seed
    setUp();
    ctx.rngState = 42;
    loadAsm("SYSCALL 32\nSYSCALL 32\nHALT");
    runUntilStop();
    TEST_ASSERT_EQUAL_UINT16(v2, pop(vm));
    TEST_ASSERT_EQUAL_UINT16(v1, pop(vm));
}

void test_time_syscall(void) {
    ctx.elapsed_ms = 1234;
    loadAsm("SYSCALL 33\nHALT"); // TIME = 0x21
    runUntilStop();
    TEST_ASSERT_EQUAL_UINT16(1234, pop(vm));
}

void test_sin_syscall(void) {
    // SIN(0) should be 0
    loadAsm("PUSH8 0\nSYSCALL 34\nHALT"); // SIN = 0x22
    runUntilStop();
    TEST_ASSERT_EQUAL_UINT16(0, pop(vm));
}

void test_cos_syscall(void) {
    // COS(0) = SIN(64) which should be ~127
    loadAsm("PUSH8 0\nSYSCALL 35\nHALT"); // COS = 0x23
    runUntilStop();
    TEST_ASSERT_EQUAL_UINT16(127, pop(vm));
}

void test_ashr_syscall(void) {
    // ASHR(256, 2) = 64
    loadAsm(
        "PUSH16 0 1\n"  // 256
        "PUSH8 2\n"
        "SYSCALL 39\n"  // ASHR = 0x27
        "HALT\n"
    );
    runUntilStop();
    TEST_ASSERT_EQUAL_UINT16(64, pop(vm));
}

void test_fx_mul_syscall(void) {
    // FX_MUL(256, 250, 8) = (256 * 250) >> 8 = 64000 >> 8 = 250
    loadAsm(
        "PUSH16 0 1\n"  // 256
        "PUSH8 250\n"
        "PUSH8 8\n"
        "SYSCALL 40\n"  // FX_MUL = 0x28
        "HALT\n"
    );
    runUntilStop();
    TEST_ASSERT_EQUAL_UINT16(250, pop(vm));
}

void test_text_num_syscall(void) {
    loadAsm(
        "PUSH8 42\n"   // value
        "PUSH8 0\n"    // x
        "PUSH8 0\n"    // y
        "SYSCALL 38\n" // TEXT_NUM = 0x26
        "HALT\n"
    );
    runUntilStop();
    // Should have drawn "42" at (0,0) — just check that some pixels are set
    bool anyPixelSet = false;
    for (int y = 0; y < 5; y++) {
        for (int x = 0; x < 8; x++) {
            if (getPixel(fb, x, y)) anyPixelSet = true;
        }
    }
    TEST_ASSERT_TRUE(anyPixelSet);
}

void test_spr_set_get(void) {
    // Store sprite data at addr 0x100
    vm.memory[0x100] = 0x80;
    loadAsm(
        "PUSH8 0\n"     // slot
        "PUSH16 0 1\n"  // addr = 0x100
        "PUSH8 8\n"     // width
        "PUSH8 8\n"     // height
        "PUSH8 42\n"    // x
        "PUSH8 17\n"    // y
        "PUSH8 0\n"     // flags
        "PUSH8 0\n"     // vx
        "PUSH8 0\n"     // vy
        "PUSH8 0\n"     // edge
        "SYSCALL 64\n"  // SPR_SET = 0x40
        "PUSH8 0\n"     // slot
        "SYSCALL 67\n"  // SPR_GET = 0x43
        "HALT\n"
    );
    runUntilStop();
    uint16_t y = pop(vm);
    uint16_t x = pop(vm);
    TEST_ASSERT_EQUAL_UINT16(42, x);
    TEST_ASSERT_EQUAL_UINT16(17, y);
}

void test_spr_vis(void) {
    vm.memory[0x100] = 0xFF;
    loadAsm(
        "PUSH8 0\n"     // slot
        "PUSH16 0 1\n"  // addr
        "PUSH8 8\n"     // width
        "PUSH8 1\n"     // height
        "PUSH8 0\n"     // x
        "PUSH8 0\n"     // y
        "PUSH8 0\n"     // flags
        "PUSH8 0\n"     // vx
        "PUSH8 0\n"     // vy
        "PUSH8 0\n"     // edge
        "SYSCALL 64\n"  // SPR_SET
        "PUSH8 0\n"     // slot
        "PUSH8 0\n"     // visible = false
        "SYSCALL 79\n"  // SPR_VIS = 0x4F
        "HALT\n"
    );
    runUntilStop();
    TEST_ASSERT_FALSE(sprites.sprites[0].visible);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_clear_syscall);
    RUN_TEST(test_pixel_syscall);
    RUN_TEST(test_line_syscall);
    RUN_TEST(test_rect_syscall);
    RUN_TEST(test_yield_syscall);
    RUN_TEST(test_input_syscall);
    RUN_TEST(test_rand_syscall);
    RUN_TEST(test_rand_deterministic);
    RUN_TEST(test_time_syscall);
    RUN_TEST(test_sin_syscall);
    RUN_TEST(test_cos_syscall);
    RUN_TEST(test_ashr_syscall);
    RUN_TEST(test_fx_mul_syscall);
    RUN_TEST(test_text_num_syscall);
    RUN_TEST(test_spr_set_get);
    RUN_TEST(test_spr_vis);
    return UNITY_END();
}
