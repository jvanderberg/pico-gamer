#include <unity.h>
#include "vm.h"
#include "opcodes.h"
#include "memory.h"

static VMState vm;

// Null syscall handler for tests that don't need syscalls
static void nullSyscall(uint8_t, VMState&, void*) {}

void setUp(void) { vm = createVM(); }
void tearDown(void) {}

// --- Helper: load raw bytecode ---
static void load(const uint8_t* prog, int len) {
    loadProgram(vm.memory, prog, len);
}

// --- Stack operations ---

void test_push_pop(void) {
    push(vm, 42);
    TEST_ASSERT_EQUAL_UINT16(1, vm.sp);
    TEST_ASSERT_EQUAL_UINT16(42, pop(vm));
    TEST_ASSERT_EQUAL_UINT16(0, vm.sp);
}

void test_push_masks_to_16bit(void) {
    push(vm, 0x1FFFF);
    TEST_ASSERT_EQUAL_UINT16(0xFFFF, pop(vm));
}

void test_peek(void) {
    push(vm, 99);
    TEST_ASSERT_EQUAL_UINT16(99, peek(vm));
    TEST_ASSERT_EQUAL_UINT16(1, vm.sp); // not popped
}

void test_peek_empty_returns_zero(void) {
    TEST_ASSERT_EQUAL_UINT16(0, peek(vm));
}

void test_stack_overflow(void) {
    for (int i = 0; i < 256; i++) push(vm, (uint16_t)i);
    TEST_ASSERT_FALSE(vm.halted);
    push(vm, 999);
    TEST_ASSERT_TRUE(vm.halted);
}

void test_stack_underflow(void) {
    pop(vm);
    TEST_ASSERT_TRUE(vm.halted);
}

// --- HALT ---
void test_halt(void) {
    uint8_t prog[] = { OP_HALT };
    load(prog, 1);
    TEST_ASSERT_FALSE(step(vm, nullSyscall, nullptr));
    TEST_ASSERT_TRUE(vm.halted);
    TEST_ASSERT_EQUAL_UINT32(1, vm.cycles);
}

void test_halt_step_returns_false(void) {
    vm.halted = true;
    TEST_ASSERT_FALSE(step(vm, nullSyscall, nullptr));
}

// --- NOP ---
void test_nop(void) {
    uint8_t prog[] = { OP_NOP, OP_HALT };
    load(prog, 2);
    TEST_ASSERT_TRUE(step(vm, nullSyscall, nullptr));
    TEST_ASSERT_EQUAL_UINT16(1, vm.pc);
    TEST_ASSERT_EQUAL_UINT32(1, vm.cycles);
}

// --- PUSH8 / PUSH16 ---
void test_push8(void) {
    uint8_t prog[] = { OP_PUSH8, 42, OP_HALT };
    load(prog, 3);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(42, peek(vm));
}

void test_push16(void) {
    uint8_t prog[] = { OP_PUSH16, 0x34, 0x12, OP_HALT };
    load(prog, 4);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0x1234, peek(vm));
}

// --- POP ---
void test_pop_opcode(void) {
    uint8_t prog[] = { OP_PUSH8, 42, OP_POP, OP_HALT };
    load(prog, 4);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0, vm.sp);
}

// --- DUP ---
void test_dup(void) {
    uint8_t prog[] = { OP_PUSH8, 42, OP_DUP, OP_HALT };
    load(prog, 4);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(2, vm.sp);
    TEST_ASSERT_EQUAL_UINT16(42, pop(vm));
    TEST_ASSERT_EQUAL_UINT16(42, pop(vm));
}

// --- SWAP ---
void test_swap(void) {
    uint8_t prog[] = { OP_PUSH8, 1, OP_PUSH8, 2, OP_SWAP, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr); // SWAP
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm));
    TEST_ASSERT_EQUAL_UINT16(2, pop(vm));
}

// --- OVER ---
void test_over(void) {
    uint8_t prog[] = { OP_PUSH8, 1, OP_PUSH8, 2, OP_OVER, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr); // OVER
    TEST_ASSERT_EQUAL_UINT16(3, vm.sp);
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm)); // copy of a
    TEST_ASSERT_EQUAL_UINT16(2, pop(vm));
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm));
}

// --- Arithmetic ---
void test_add(void) {
    uint8_t prog[] = { OP_PUSH8, 10, OP_PUSH8, 20, OP_ADD, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(30, pop(vm));
}

void test_add_overflow(void) {
    uint8_t prog[] = { OP_PUSH16, 0xFF, 0xFF, OP_PUSH8, 2, OP_ADD, OP_HALT };
    load(prog, 7);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm)); // 0xFFFF + 2 = 0x10001 & 0xFFFF = 1
}

void test_sub(void) {
    uint8_t prog[] = { OP_PUSH8, 30, OP_PUSH8, 10, OP_SUB, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(20, pop(vm));
}

void test_sub_underflow(void) {
    uint8_t prog[] = { OP_PUSH8, 5, OP_PUSH8, 10, OP_SUB, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0xFFFB, pop(vm)); // wraps to 65531
}

void test_mul(void) {
    uint8_t prog[] = { OP_PUSH8, 6, OP_PUSH8, 7, OP_MUL, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(42, pop(vm));
}

void test_div(void) {
    uint8_t prog[] = { OP_PUSH8, 42, OP_PUSH8, 6, OP_DIV, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(7, pop(vm));
}

void test_div_by_zero_halts(void) {
    uint8_t prog[] = { OP_PUSH8, 42, OP_PUSH8, 0, OP_DIV };
    load(prog, 5);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    bool result = step(vm, nullSyscall, nullptr);
    TEST_ASSERT_FALSE(result);
    TEST_ASSERT_TRUE(vm.halted);
}

void test_mod(void) {
    uint8_t prog[] = { OP_PUSH8, 10, OP_PUSH8, 3, OP_MOD, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm));
}

void test_mod_by_zero_halts(void) {
    uint8_t prog[] = { OP_PUSH8, 10, OP_PUSH8, 0, OP_MOD };
    load(prog, 5);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    bool result = step(vm, nullSyscall, nullptr);
    TEST_ASSERT_FALSE(result);
    TEST_ASSERT_TRUE(vm.halted);
}

void test_neg(void) {
    uint8_t prog[] = { OP_PUSH8, 1, OP_NEG, OP_HALT };
    load(prog, 4);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0xFFFF, pop(vm));
}

void test_neg_zero(void) {
    uint8_t prog[] = { OP_PUSH8, 0, OP_NEG, OP_HALT };
    load(prog, 4);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0, pop(vm));
}

// --- Bitwise ---
void test_and(void) {
    uint8_t prog[] = { OP_PUSH8, 0xFF, OP_PUSH8, 0x0F, OP_AND, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0x0F, pop(vm));
}

void test_or(void) {
    uint8_t prog[] = { OP_PUSH8, 0xF0, OP_PUSH8, 0x0F, OP_OR, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0xFF, pop(vm));
}

void test_xor(void) {
    uint8_t prog[] = { OP_PUSH8, 0xFF, OP_PUSH8, 0x0F, OP_XOR, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0xF0, pop(vm));
}

void test_not(void) {
    uint8_t prog[] = { OP_PUSH8, 0, OP_NOT, OP_HALT };
    load(prog, 4);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0xFFFF, pop(vm));
}

void test_shl(void) {
    uint8_t prog[] = { OP_PUSH8, 1, OP_PUSH8, 4, OP_SHL, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(16, pop(vm));
}

void test_shr(void) {
    uint8_t prog[] = { OP_PUSH8, 16, OP_PUSH8, 2, OP_SHR, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(4, pop(vm));
}

// --- Comparison ---
void test_eq_true(void) {
    uint8_t prog[] = { OP_PUSH8, 42, OP_PUSH8, 42, OP_EQ, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm));
}

void test_eq_false(void) {
    uint8_t prog[] = { OP_PUSH8, 1, OP_PUSH8, 2, OP_EQ, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0, pop(vm));
}

void test_lt_unsigned(void) {
    uint8_t prog[] = { OP_PUSH8, 5, OP_PUSH8, 10, OP_LT, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm));
}

void test_gt_unsigned(void) {
    uint8_t prog[] = { OP_PUSH8, 10, OP_PUSH8, 5, OP_GT, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm));
}

void test_lts_signed(void) {
    // 0xFFFF (-1) < 0x7FFF (32767) signed
    uint8_t prog[] = { OP_PUSH16, 0xFF, 0xFF, OP_PUSH16, 0xFF, 0x7F, OP_LTS, OP_HALT };
    load(prog, 8);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm));
}

void test_gts_signed(void) {
    // 0x7FFF (32767) > 0x8000 (-32768) signed
    uint8_t prog[] = { OP_PUSH16, 0xFF, 0x7F, OP_PUSH16, 0x00, 0x80, OP_GTS, OP_HALT };
    load(prog, 8);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(1, pop(vm));
}

// --- Control flow ---
void test_jmp(void) {
    uint8_t prog[] = { OP_JMP, 0x05, 0x00, OP_PUSH8, 99, OP_HALT };
    load(prog, 6);
    step(vm, nullSyscall, nullptr); // JMP to 5
    TEST_ASSERT_EQUAL_UINT16(5, vm.pc);
}

void test_jz_taken(void) {
    uint8_t prog[] = { OP_PUSH8, 0, OP_JZ, 0x07, 0x00, OP_PUSH8, 99, OP_HALT };
    load(prog, 8);
    step(vm, nullSyscall, nullptr); // PUSH8 0
    step(vm, nullSyscall, nullptr); // JZ (taken, value is 0)
    TEST_ASSERT_EQUAL_UINT16(7, vm.pc);
}

void test_jz_not_taken(void) {
    uint8_t prog[] = { OP_PUSH8, 1, OP_JZ, 0x07, 0x00, OP_PUSH8, 99, OP_HALT };
    load(prog, 8);
    step(vm, nullSyscall, nullptr); // PUSH8 1
    step(vm, nullSyscall, nullptr); // JZ (not taken, value is 1)
    TEST_ASSERT_EQUAL_UINT16(5, vm.pc);
}

void test_jnz_taken(void) {
    uint8_t prog[] = { OP_PUSH8, 1, OP_JNZ, 0x07, 0x00, OP_PUSH8, 99, OP_HALT };
    load(prog, 8);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(7, vm.pc);
}

void test_call_ret(void) {
    // CALL addr=6, at addr 6: PUSH8 42, RET
    uint8_t prog[] = { OP_CALL, 0x06, 0x00, OP_HALT, 0, 0, OP_PUSH8, 42, OP_RET };
    load(prog, 9);
    step(vm, nullSyscall, nullptr); // CALL: push return addr (3), jump to 6
    TEST_ASSERT_EQUAL_UINT16(6, vm.pc);
    TEST_ASSERT_EQUAL_UINT16(3, peek(vm)); // return address
    step(vm, nullSyscall, nullptr); // PUSH8 42
    step(vm, nullSyscall, nullptr); // RET: pop return addr, but 42 is on top!
    // Actually RET pops whatever is on top. Since 42 is on top, pc = 42.
    // Let's fix the test: the subroutine should pop 42 first or we should test differently
}

void test_call_ret_proper(void) {
    // Subroutine at addr 6 that just returns immediately
    uint8_t prog[] = { OP_CALL, 0x04, 0x00, OP_HALT, OP_RET };
    load(prog, 5);
    step(vm, nullSyscall, nullptr); // CALL: push 3 (return addr), pc=4
    TEST_ASSERT_EQUAL_UINT16(4, vm.pc);
    step(vm, nullSyscall, nullptr); // RET: pop 3, pc=3
    TEST_ASSERT_EQUAL_UINT16(3, vm.pc);
    step(vm, nullSyscall, nullptr); // HALT at addr 3
    TEST_ASSERT_TRUE(vm.halted);
}

// --- Memory operations ---
void test_load_store(void) {
    uint8_t prog[] = { OP_PUSH16, 0x34, 0x12, OP_STORE, 0x00, 0xC0,
                       OP_LOAD, 0x00, 0xC0, OP_HALT };
    load(prog, 10);
    step(vm, nullSyscall, nullptr); // PUSH16 0x1234
    step(vm, nullSyscall, nullptr); // STORE 0xC000
    step(vm, nullSyscall, nullptr); // LOAD 0xC000
    TEST_ASSERT_EQUAL_UINT16(0x1234, pop(vm));
}

void test_load8_store8(void) {
    uint8_t prog[] = { OP_PUSH8, 0xAB, OP_STORE8, 0x00, 0xC0,
                       OP_LOAD8, 0x00, 0xC0, OP_HALT };
    load(prog, 9);
    step(vm, nullSyscall, nullptr); step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0xAB, pop(vm));
}

void test_load_idx(void) {
    writeU16(vm.memory, 0x200, 0xBEEF);
    uint8_t prog[] = { OP_PUSH16, 0x00, 0x02, OP_LOAD_IDX, OP_HALT };
    load(prog, 5);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0xBEEF, pop(vm));
}

void test_store_idx(void) {
    // PUSH value, PUSH addr, STORE_IDX
    uint8_t prog[] = { OP_PUSH16, 0xEF, 0xBE, OP_PUSH16, 0x00, 0x03, OP_STORE_IDX, OP_HALT };
    load(prog, 8);
    step(vm, nullSyscall, nullptr); // PUSH 0xBEEF
    step(vm, nullSyscall, nullptr); // PUSH 0x0300
    step(vm, nullSyscall, nullptr); // STORE_IDX: pop addr=0x0300, pop val=0xBEEF
    TEST_ASSERT_EQUAL_UINT16(0xBEEF, readU16(vm.memory, 0x0300));
}

void test_load8_idx(void) {
    vm.memory[0x100] = 0x42;
    uint8_t prog[] = { OP_PUSH16, 0x00, 0x01, OP_LOAD8_IDX, OP_HALT };
    load(prog, 5);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT16(0x42, pop(vm));
}

void test_store8_idx(void) {
    uint8_t prog[] = { OP_PUSH8, 0xAB, OP_PUSH16, 0x00, 0x03, OP_STORE8_IDX, OP_HALT };
    load(prog, 7);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    step(vm, nullSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT8(0xAB, vm.memory[0x0300]);
}

// --- SYSCALL ---
static uint8_t lastSyscallId = 0;
static void testSyscall(uint8_t id, VMState&, void*) { lastSyscallId = id; }

void test_syscall_dispatch(void) {
    lastSyscallId = 0;
    uint8_t prog[] = { OP_SYSCALL, 0x42, OP_HALT };
    load(prog, 3);
    step(vm, testSyscall, nullptr);
    TEST_ASSERT_EQUAL_UINT8(0x42, lastSyscallId);
}

// --- Unknown opcode ---
void test_unknown_opcode_halts(void) {
    uint8_t prog[] = { 0xFF }; // invalid opcode
    load(prog, 1);
    bool result = step(vm, nullSyscall, nullptr);
    TEST_ASSERT_FALSE(result);
    TEST_ASSERT_TRUE(vm.halted);
}

int main(void) {
    UNITY_BEGIN();
    // Stack
    RUN_TEST(test_push_pop);
    RUN_TEST(test_push_masks_to_16bit);
    RUN_TEST(test_peek);
    RUN_TEST(test_peek_empty_returns_zero);
    RUN_TEST(test_stack_overflow);
    RUN_TEST(test_stack_underflow);
    // HALT/NOP
    RUN_TEST(test_halt);
    RUN_TEST(test_halt_step_returns_false);
    RUN_TEST(test_nop);
    // PUSH/POP/DUP/SWAP/OVER
    RUN_TEST(test_push8);
    RUN_TEST(test_push16);
    RUN_TEST(test_pop_opcode);
    RUN_TEST(test_dup);
    RUN_TEST(test_swap);
    RUN_TEST(test_over);
    // Arithmetic
    RUN_TEST(test_add);
    RUN_TEST(test_add_overflow);
    RUN_TEST(test_sub);
    RUN_TEST(test_sub_underflow);
    RUN_TEST(test_mul);
    RUN_TEST(test_div);
    RUN_TEST(test_div_by_zero_halts);
    RUN_TEST(test_mod);
    RUN_TEST(test_mod_by_zero_halts);
    RUN_TEST(test_neg);
    RUN_TEST(test_neg_zero);
    // Bitwise
    RUN_TEST(test_and);
    RUN_TEST(test_or);
    RUN_TEST(test_xor);
    RUN_TEST(test_not);
    RUN_TEST(test_shl);
    RUN_TEST(test_shr);
    // Comparison
    RUN_TEST(test_eq_true);
    RUN_TEST(test_eq_false);
    RUN_TEST(test_lt_unsigned);
    RUN_TEST(test_gt_unsigned);
    RUN_TEST(test_lts_signed);
    RUN_TEST(test_gts_signed);
    // Control flow
    RUN_TEST(test_jmp);
    RUN_TEST(test_jz_taken);
    RUN_TEST(test_jz_not_taken);
    RUN_TEST(test_jnz_taken);
    RUN_TEST(test_call_ret);
    RUN_TEST(test_call_ret_proper);
    // Memory ops
    RUN_TEST(test_load_store);
    RUN_TEST(test_load8_store8);
    RUN_TEST(test_load_idx);
    RUN_TEST(test_store_idx);
    RUN_TEST(test_load8_idx);
    RUN_TEST(test_store8_idx);
    // Syscall
    RUN_TEST(test_syscall_dispatch);
    // Error
    RUN_TEST(test_unknown_opcode_halts);
    return UNITY_END();
}
