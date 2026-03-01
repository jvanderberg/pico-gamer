#include <unity.h>
#include "font.h"
#include "display.h"

static Framebuffer fb;

void setUp(void) { fb = createFramebuffer(); }
void tearDown(void) {}

void test_font_sm_A_pattern(void) {
    // 'A' in FONT_SM (3x5): offset = (65-32)*5 = 165
    // Row data: 0x40, 0xA0, 0xE0, 0xA0, 0xA0
    // Row 0: 0x40 = 010 -> pixel at col 1
    // Row 1: 0xA0 = 101 -> pixels at col 0, 2
    // Row 2: 0xE0 = 111 -> pixels at col 0, 1, 2
    // Row 3: 0xA0 = 101 -> pixels at col 0, 2
    // Row 4: 0xA0 = 101 -> pixels at col 0, 2
    drawText(fb, "A", 0, 0, FONT_SM, 3, 5, 4);
    // Row 0
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 0, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 1, 0));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 2, 0));
    // Row 1
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 0, 1));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 1, 1));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 2, 1));
    // Row 2
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 0, 2));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 1, 2));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 2, 2));
}

void test_font_lg_A_pattern(void) {
    // 'A' in FONT_LG (5x7): offset = (65-32)*7 = 231
    // Row 0: 0x20 = 00100 -> pixel at col 2
    // Row 1: 0x50 = 01010 -> pixels at col 1, 3
    drawText(fb, "A", 0, 0, FONT_LG, 5, 7, 6);
    // Row 0: 0x20 = 00100
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 0, 0));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 1, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 2, 0));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 3, 0));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 4, 0));
    // Row 1: 0x50 = 01010
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 0, 1));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 1, 1));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 2, 1));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 3, 1));
}

void test_character_advance_sm(void) {
    drawText(fb, "AB", 0, 0, FONT_SM, 3, 5, 4);
    // 'A' starts at x=0, 'B' starts at x=4 (advance=4)
    // B row 0: 0xC0 = 110 -> pixels at col 0, 1
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 4, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 5, 0));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 6, 0));
}

void test_space_is_blank(void) {
    drawText(fb, " ", 0, 0, FONT_SM, 3, 5, 4);
    // Space should have no pixels set
    for (int y = 0; y < 5; y++) {
        for (int x = 0; x < 3; x++) {
            TEST_ASSERT_EQUAL_INT(0, getPixel(fb, x, y));
        }
    }
}

void test_text_at_offset(void) {
    drawText(fb, "A", 50, 30, FONT_SM, 3, 5, 4);
    // Row 0 of 'A' at (50, 30): pixel at col 1 -> (51, 30)
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 51, 30));
}

void test_digit_0_sm(void) {
    drawText(fb, "0", 0, 0, FONT_SM, 3, 5, 4);
    // '0' = 0xE0, 0xA0, 0xA0, 0xA0, 0xE0
    // Row 0: 0xE0 = 111
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 0, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 1, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 2, 0));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_font_sm_A_pattern);
    RUN_TEST(test_font_lg_A_pattern);
    RUN_TEST(test_character_advance_sm);
    RUN_TEST(test_space_is_blank);
    RUN_TEST(test_text_at_offset);
    RUN_TEST(test_digit_0_sm);
    return UNITY_END();
}
