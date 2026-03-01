#include <unity.h>
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
        TEST_FAIL_MESSAGE(r.errorMsg);
        return;
    }
    resetVM(vm);
    resetSpriteTable(sprites);
    resetWallTable(walls);
    ctx.yieldRequested = false;
    loadProgram(vm.memory, r.bytecode, r.length);
}

void test_halt_returns_false(void) {
    loadAsm("HALT");
    bool running = execGameFrame(vm, fb, ctx, sprites, walls);
    TEST_ASSERT_FALSE(running);
    TEST_ASSERT_TRUE(vm.halted);
}

void test_yield_stops_frame(void) {
    loadAsm(
        "PUSH8 1\n"
        "SYSCALL 6\n"  // YIELD
        "PUSH8 2\n"
        "HALT\n"
    );
    bool running = execGameFrame(vm, fb, ctx, sprites, walls);
    TEST_ASSERT_TRUE(running);
    TEST_ASSERT_FALSE(vm.halted);
    // Stack should have 1 from before YIELD (2 not pushed yet)
    TEST_ASSERT_EQUAL_UINT16(1, vm.sp);
}

void test_yield_resumes_next_frame(void) {
    loadAsm(
        "SYSCALL 6\n"  // YIELD
        "HALT\n"
    );
    bool r1 = execGameFrame(vm, fb, ctx, sprites, walls);
    TEST_ASSERT_TRUE(r1);
    bool r2 = execGameFrame(vm, fb, ctx, sprites, walls);
    TEST_ASSERT_FALSE(r2); // HALT on second frame
}

void test_double_buffer_swap_on_frame(void) {
    loadAsm(
        "PUSH8 50\n"
        "PUSH8 30\n"
        "PUSH8 1\n"
        "SYSCALL 1\n"  // PIXEL(50, 30, 1)
        "SYSCALL 6\n"  // YIELD
        "HALT\n"
    );
    execGameFrame(vm, fb, ctx, sprites, walls);
    // After frame, back was swapped to front. Read from front.
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 50, 30));
}

void test_frame_clears_back_buffer(void) {
    // Draw something in frame 1
    loadAsm(
        "PUSH8 50\n"
        "PUSH8 30\n"
        "PUSH8 1\n"
        "SYSCALL 1\n"  // PIXEL
        "SYSCALL 6\n"  // YIELD
        "SYSCALL 6\n"  // YIELD (frame 2: no drawing)
        "HALT\n"
    );
    execGameFrame(vm, fb, ctx, sprites, walls); // frame 1: draws pixel
    execGameFrame(vm, fb, ctx, sprites, walls); // frame 2: clears, no draw
    // Front buffer (frame 2 output) should be clean
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 50, 30));
}

void test_cycle_budget(void) {
    // A tight loop with no YIELD — should stop at cycle budget
    loadAsm(
        "loop:\n"
        "NOP\n"
        "JMP loop\n"
    );
    bool running = execGameFrame(vm, fb, ctx, sprites, walls);
    TEST_ASSERT_TRUE(running); // VM not halted, just out of cycles
    TEST_ASSERT_FALSE(vm.halted);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_halt_returns_false);
    RUN_TEST(test_yield_stops_frame);
    RUN_TEST(test_yield_resumes_next_frame);
    RUN_TEST(test_double_buffer_swap_on_frame);
    RUN_TEST(test_frame_clears_back_buffer);
    RUN_TEST(test_cycle_budget);
    return UNITY_END();
}
