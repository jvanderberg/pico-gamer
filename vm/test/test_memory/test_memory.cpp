#include <unity.h>
#include "memory.h"

static uint8_t mem[65536];

void setUp(void) { memset(mem, 0, sizeof(mem)); }
void tearDown(void) {}

void test_readU8_returns_zero_on_empty(void) {
    TEST_ASSERT_EQUAL_UINT8(0, readU8(mem, 0));
    TEST_ASSERT_EQUAL_UINT8(0, readU8(mem, 0x1234));
}

void test_writeU8_readU8(void) {
    writeU8(mem, 0x0100, 0x42);
    TEST_ASSERT_EQUAL_UINT8(0x42, readU8(mem, 0x0100));
}

void test_writeU8_masks_value(void) {
    writeU8(mem, 0, 0x1FF); // should store 0xFF
    TEST_ASSERT_EQUAL_UINT8(0xFF, readU8(mem, 0));
}

void test_readU16_little_endian(void) {
    mem[0x10] = 0x34;
    mem[0x11] = 0x12;
    TEST_ASSERT_EQUAL_UINT16(0x1234, readU16(mem, 0x10));
}

void test_writeU16_little_endian(void) {
    writeU16(mem, 0x20, 0xABCD);
    TEST_ASSERT_EQUAL_UINT8(0xCD, mem[0x20]);
    TEST_ASSERT_EQUAL_UINT8(0xAB, mem[0x21]);
}

void test_readU16_writeU16_roundtrip(void) {
    writeU16(mem, 0x50, 0xDEAD);
    TEST_ASSERT_EQUAL_UINT16(0xDEAD, readU16(mem, 0x50));
}

void test_address_wrapping(void) {
    writeU8(mem, 0xFFFF, 0x42);
    TEST_ASSERT_EQUAL_UINT8(0x42, readU8(mem, 0xFFFF));
    TEST_ASSERT_EQUAL_UINT8(0x42, mem[0xFFFF]);
}

void test_readU16_wraps_at_boundary(void) {
    // Write at 0xFFFF: low byte at 0xFFFF, high byte at 0x0000
    mem[0xFFFF] = 0x34;
    mem[0x0000] = 0x12;
    TEST_ASSERT_EQUAL_UINT16(0x1234, readU16(mem, 0xFFFF));
}

void test_writeU16_wraps_at_boundary(void) {
    writeU16(mem, 0xFFFF, 0xABCD);
    TEST_ASSERT_EQUAL_UINT8(0xCD, mem[0xFFFF]);
    TEST_ASSERT_EQUAL_UINT8(0xAB, mem[0x0000]);
}

void test_loadProgram(void) {
    uint8_t prog[] = {0x02, 0x42, 0x00}; // PUSH8 0x42, HALT
    loadProgram(mem, prog, sizeof(prog));
    TEST_ASSERT_EQUAL_UINT8(0x02, mem[0]);
    TEST_ASSERT_EQUAL_UINT8(0x42, mem[1]);
    TEST_ASSERT_EQUAL_UINT8(0x00, mem[2]);
}

void test_loadProgram_with_base_addr(void) {
    uint8_t prog[] = {0xAA, 0xBB};
    loadProgram(mem, prog, sizeof(prog), 0x100);
    TEST_ASSERT_EQUAL_UINT8(0xAA, mem[0x100]);
    TEST_ASSERT_EQUAL_UINT8(0xBB, mem[0x101]);
    TEST_ASSERT_EQUAL_UINT8(0x00, mem[0x00]); // base area untouched
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_readU8_returns_zero_on_empty);
    RUN_TEST(test_writeU8_readU8);
    RUN_TEST(test_writeU8_masks_value);
    RUN_TEST(test_readU16_little_endian);
    RUN_TEST(test_writeU16_little_endian);
    RUN_TEST(test_readU16_writeU16_roundtrip);
    RUN_TEST(test_address_wrapping);
    RUN_TEST(test_readU16_wraps_at_boundary);
    RUN_TEST(test_writeU16_wraps_at_boundary);
    RUN_TEST(test_loadProgram);
    RUN_TEST(test_loadProgram_with_base_addr);
    return UNITY_END();
}
