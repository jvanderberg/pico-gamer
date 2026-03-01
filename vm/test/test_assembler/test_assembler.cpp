#include <unity.h>
#include "assembler.h"
#include "opcodes.h"

void setUp(void) {}
void tearDown(void) {}

void test_simple_halt(void) {
    AssemblerResult r = assemble("HALT");
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_UINT16(1, r.length);
    TEST_ASSERT_EQUAL_UINT8(OP_HALT, r.bytecode[0]);
}

void test_push8(void) {
    AssemblerResult r = assemble("PUSH8 42");
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_UINT16(2, r.length);
    TEST_ASSERT_EQUAL_UINT8(OP_PUSH8, r.bytecode[0]);
    TEST_ASSERT_EQUAL_UINT8(42, r.bytecode[1]);
}

void test_push16_little_endian(void) {
    AssemblerResult r = assemble("PUSH16 0x1234");
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_UINT16(3, r.length);
    TEST_ASSERT_EQUAL_UINT8(OP_PUSH16, r.bytecode[0]);
    TEST_ASSERT_EQUAL_UINT8(0x34, r.bytecode[1]); // lo
    TEST_ASSERT_EQUAL_UINT8(0x12, r.bytecode[2]); // hi
}

void test_label_resolution(void) {
    AssemblerResult r = assemble(
        "JMP target\n"
        "NOP\n"
        "target:\n"
        "HALT\n"
    );
    TEST_ASSERT_FALSE(r.error);
    // JMP (3 bytes) + NOP (1 byte) = 4 bytes before target
    TEST_ASSERT_EQUAL_UINT8(OP_JMP, r.bytecode[0]);
    TEST_ASSERT_EQUAL_UINT8(4, r.bytecode[1]);  // lo of target addr
    TEST_ASSERT_EQUAL_UINT8(0, r.bytecode[2]);  // hi
    TEST_ASSERT_EQUAL_UINT8(OP_NOP, r.bytecode[3]);
    TEST_ASSERT_EQUAL_UINT8(OP_HALT, r.bytecode[4]);
}

void test_data_directive(void) {
    AssemblerResult r = assemble(
        "mydata:\n"
        ".data 0xFF, 0x00, 128\n"
        "HALT\n"
    );
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_UINT8(0xFF, r.bytecode[0]);
    TEST_ASSERT_EQUAL_UINT8(0x00, r.bytecode[1]);
    TEST_ASSERT_EQUAL_UINT8(128, r.bytecode[2]);
    TEST_ASSERT_EQUAL_UINT8(OP_HALT, r.bytecode[3]);
}

void test_org_directive(void) {
    AssemblerResult r = assemble(
        "PUSH8 1\n"
        ".org 0x10\n"
        "HALT\n"
    );
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_UINT8(OP_PUSH8, r.bytecode[0]);
    TEST_ASSERT_EQUAL_UINT8(1, r.bytecode[1]);
    // Bytes 2-15 should be zero padding
    for (int i = 2; i < 0x10; i++) {
        TEST_ASSERT_EQUAL_UINT8(0, r.bytecode[i]);
    }
    TEST_ASSERT_EQUAL_UINT8(OP_HALT, r.bytecode[0x10]);
}

void test_comments(void) {
    AssemblerResult r = assemble(
        "; this is a comment\n"
        "PUSH8 42 ; inline comment\n"
        "HALT\n"
    );
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_UINT16(3, r.length);
    TEST_ASSERT_EQUAL_UINT8(OP_PUSH8, r.bytecode[0]);
    TEST_ASSERT_EQUAL_UINT8(42, r.bytecode[1]);
}

void test_case_insensitive_mnemonics(void) {
    AssemblerResult r = assemble("halt");
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_UINT8(OP_HALT, r.bytecode[0]);
}

void test_syscall(void) {
    AssemblerResult r = assemble("SYSCALL 6");
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_UINT16(2, r.length);
    TEST_ASSERT_EQUAL_UINT8(OP_SYSCALL, r.bytecode[0]);
    TEST_ASSERT_EQUAL_UINT8(6, r.bytecode[1]);
}

void test_error_duplicate_label(void) {
    AssemblerResult r = assemble(
        "foo:\n"
        "NOP\n"
        "foo:\n"
        "HALT\n"
    );
    TEST_ASSERT_TRUE(r.error);
    TEST_ASSERT_EQUAL_INT(3, r.errorLine);
}

void test_error_unknown_mnemonic(void) {
    AssemblerResult r = assemble("FOOBAR");
    TEST_ASSERT_TRUE(r.error);
    TEST_ASSERT_EQUAL_INT(1, r.errorLine);
}

void test_error_missing_operand(void) {
    AssemblerResult r = assemble("PUSH8");
    TEST_ASSERT_TRUE(r.error);
}

void test_error_undefined_label(void) {
    AssemblerResult r = assemble("JMP undefined_label");
    TEST_ASSERT_TRUE(r.error);
}

void test_findLabel(void) {
    AssemblerResult r = assemble(
        "start:\n"
        "NOP\n"
        "end:\n"
        "HALT\n"
    );
    TEST_ASSERT_FALSE(r.error);
    TEST_ASSERT_EQUAL_INT32(0, findLabel(r, "start"));
    TEST_ASSERT_EQUAL_INT32(1, findLabel(r, "end"));
    TEST_ASSERT_EQUAL_INT32(-1, findLabel(r, "nonexistent"));
}

void test_all_opcodes_assemble(void) {
    AssemblerResult r = assemble(
        "HALT\n"
        "NOP\n"
        "PUSH8 0\n"
        "PUSH16 0\n"
        "POP\n"
        "DUP\n"
        "SWAP\n"
        "OVER\n"
        "ADD\n"
        "SUB\n"
        "MUL\n"
        "DIV\n"
        "MOD\n"
        "NEG\n"
        "AND\n"
        "OR\n"
        "XOR\n"
        "NOT\n"
        "SHL\n"
        "SHR\n"
        "EQ\n"
        "LT\n"
        "GT\n"
        "LTS\n"
        "GTS\n"
        "JMP 0\n"
        "JZ 0\n"
        "JNZ 0\n"
        "CALL 0\n"
        "RET\n"
        "LOAD 0\n"
        "STORE 0\n"
        "LOAD8 0\n"
        "STORE8 0\n"
        "LOAD_IDX\n"
        "STORE_IDX\n"
        "LOAD8_IDX\n"
        "STORE8_IDX\n"
        "SYSCALL 0\n"
    );
    TEST_ASSERT_FALSE(r.error);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_simple_halt);
    RUN_TEST(test_push8);
    RUN_TEST(test_push16_little_endian);
    RUN_TEST(test_label_resolution);
    RUN_TEST(test_data_directive);
    RUN_TEST(test_org_directive);
    RUN_TEST(test_comments);
    RUN_TEST(test_case_insensitive_mnemonics);
    RUN_TEST(test_syscall);
    RUN_TEST(test_error_duplicate_label);
    RUN_TEST(test_error_unknown_mnemonic);
    RUN_TEST(test_error_missing_operand);
    RUN_TEST(test_error_undefined_label);
    RUN_TEST(test_findLabel);
    RUN_TEST(test_all_opcodes_assemble);
    return UNITY_END();
}
