#include <unity.h>
#include <cstdio>
#include "runtime.h"
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

static void loadAsm(const char* source) {
    AssemblerResult r = assemble(source);
    if (r.error) {
        char msg[256];
        snprintf(msg, sizeof(msg), "Asm error line %d: %s", r.errorLine, r.errorMsg);
        TEST_FAIL_MESSAGE(msg);
        return;
    }
    resetVM(vm);
    resetSpriteTable(sprites);
    resetWallTable(walls);
    ctx.yieldRequested = false;
    loadProgram(vm.memory, r.bytecode, r.length);
}

static void frame(void) {
    execGameFrame(vm, fb, ctx, sprites, walls);
}

static void frames(int n) {
    for (int i = 0; i < n; i++) frame();
}

// --- Variable assignment via assembly ---

void test_store_load_roundtrip(void) {
    loadAsm(
        "PUSH8 42\n"
        "STORE 0xC100\n"
        "HALT\n"
    );
    frame();
    TEST_ASSERT_EQUAL_UINT16(42, readU16(vm.memory, 0xC100));
}

void test_arithmetic_expression(void) {
    // Compute 3 + 4 * 2 = 11 (must do mul first)
    loadAsm(
        "PUSH8 4\n"
        "PUSH8 2\n"
        "MUL\n"
        "PUSH8 3\n"
        "SWAP\n"
        "ADD\n"
        "STORE 0xC100\n"
        "HALT\n"
    );
    frame();
    TEST_ASSERT_EQUAL_UINT16(11, readU16(vm.memory, 0xC100));
}

void test_loop_with_counter(void) {
    // Count from 0 to 4 in a loop
    loadAsm(
        "PUSH8 0\n"       // counter = 0
        "STORE 0xC100\n"
        "loop:\n"
        "LOAD 0xC100\n"
        "PUSH8 1\n"
        "ADD\n"
        "DUP\n"
        "STORE 0xC100\n"
        "PUSH8 5\n"
        "LT\n"
        "JNZ loop\n"
        "HALT\n"
    );
    frame();
    TEST_ASSERT_EQUAL_UINT16(5, readU16(vm.memory, 0xC100));
}

void test_subroutine(void) {
    loadAsm(
        "PUSH8 0\n"
        "STORE 0xC100\n"
        "CALL inc\n"
        "CALL inc\n"
        "CALL inc\n"
        "HALT\n"
        "inc:\n"
        "LOAD 0xC100\n"
        "PUSH8 1\n"
        "ADD\n"
        "STORE 0xC100\n"
        "RET\n"
    );
    frame();
    TEST_ASSERT_EQUAL_UINT16(3, readU16(vm.memory, 0xC100));
}

void test_rect_draws_pixels(void) {
    loadAsm(
        "PUSH8 10\n"   // x
        "PUSH8 10\n"   // y
        "PUSH8 4\n"    // w
        "PUSH8 4\n"    // h
        "SYSCALL 3\n"  // RECT
        "SYSCALL 6\n"  // YIELD
        "HALT\n"
    );
    frame();
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 10, 10));
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 13, 13));
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 9, 9));
}

void test_pixel_draws(void) {
    loadAsm(
        "PUSH8 50\n"
        "PUSH8 30\n"
        "PUSH8 1\n"
        "SYSCALL 1\n"  // PIXEL
        "SYSCALL 6\n"  // YIELD
        "HALT\n"
    );
    frame();
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 50, 30));
}

void test_text_num_draws(void) {
    loadAsm(
        "PUSH8 42\n"
        "PUSH8 0\n"
        "PUSH8 0\n"
        "SYSCALL 38\n" // TEXT_NUM
        "SYSCALL 6\n"
        "HALT\n"
    );
    frame();
    // Check that some pixels were drawn for "42"
    bool anySet = false;
    for (int y = 0; y < 5; y++)
        for (int x = 0; x < 12; x++)
            if (getPixelFront(fb, x, y)) anySet = true;
    TEST_ASSERT_TRUE(anySet);
}

void test_sprite_engine_basic(void) {
    loadAsm(
        "PUSH8 0\n"     // slot
        "PUSH16 0 1\n"  // addr = 0x100
        "PUSH8 8\n"     // width
        "PUSH8 1\n"     // height
        "PUSH8 10\n"    // x
        "PUSH8 20\n"    // y
        "PUSH8 0\n"     // flags
        "PUSH8 0\n"     // vx
        "PUSH8 0\n"     // vy
        "PUSH8 0\n"     // edge
        "SYSCALL 64\n"  // SPR_SET
        "SYSCALL 6\n"   // YIELD
        "HALT\n"
    );
    // Place sprite data at 0x100 AFTER loadAsm (which resets memory)
    vm.memory[0x100] = 0xFF;
    frame();
    // Sprite should be drawn at (10, 20)
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 10, 20));
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 17, 20));
}

void test_clear_then_yield(void) {
    loadAsm(
        "PUSH8 10\n"
        "PUSH8 10\n"
        "PUSH8 4\n"
        "PUSH8 4\n"
        "SYSCALL 3\n"  // RECT
        "SYSCALL 0\n"  // CLEAR
        "SYSCALL 6\n"  // YIELD
        "HALT\n"
    );
    frame();
    // After CLEAR, framebuffer should be empty
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 10, 10));
}

void test_two_frames(void) {
    loadAsm(
        "PUSH8 10\n"
        "PUSH8 10\n"
        "PUSH8 4\n"
        "PUSH8 4\n"
        "SYSCALL 3\n"  // RECT at (10,10) 4x4
        "SYSCALL 6\n"  // YIELD (frame 1)
        "PUSH8 50\n"
        "PUSH8 50\n"
        "PUSH8 4\n"
        "PUSH8 4\n"
        "SYSCALL 3\n"  // RECT at (50,50) 4x4
        "SYSCALL 6\n"  // YIELD (frame 2)
        "HALT\n"
    );
    frame(); // frame 1
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 10, 10));
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 50, 50));

    frame(); // frame 2
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 10, 10)); // cleared
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 50, 50));
}

void test_signed_arithmetic(void) {
    // 10 - 15 = -5 = 0xFFFB
    loadAsm(
        "PUSH8 10\n"
        "PUSH8 15\n"
        "SUB\n"
        "STORE 0xC100\n"
        "HALT\n"
    );
    frame();
    TEST_ASSERT_EQUAL_UINT16(0xFFFB, readU16(vm.memory, 0xC100));
}

void test_signed_comparison(void) {
    // -5 (0xFFFB) < 0 using LTS
    loadAsm(
        "PUSH16 0xFB 0xFF\n"  // 0xFFFB (-5)
        "PUSH8 0\n"
        "LTS\n"
        "STORE 0xC100\n"
        "HALT\n"
    );
    frame();
    TEST_ASSERT_EQUAL_UINT16(1, readU16(vm.memory, 0xC100));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_store_load_roundtrip);
    RUN_TEST(test_arithmetic_expression);
    RUN_TEST(test_loop_with_counter);
    RUN_TEST(test_subroutine);
    RUN_TEST(test_rect_draws_pixels);
    RUN_TEST(test_pixel_draws);
    RUN_TEST(test_text_num_draws);
    RUN_TEST(test_sprite_engine_basic);
    RUN_TEST(test_clear_then_yield);
    RUN_TEST(test_two_frames);
    RUN_TEST(test_signed_arithmetic);
    RUN_TEST(test_signed_comparison);
    return UNITY_END();
}
