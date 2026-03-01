#include <unity.h>
#include "display.h"

static Framebuffer fb;

void setUp(void) { fb = createFramebuffer(); }
void tearDown(void) {}

void test_initial_framebuffer_clear(void) {
    for (int i = 0; i < FB_BYTES; i++) {
        TEST_ASSERT_EQUAL_UINT8(0, fb.buf[fb.back][i]);
    }
}

void test_set_get_pixel(void) {
    setPixel(fb, 10, 20, 1);
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 10, 20));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 11, 20));
}

void test_set_pixel_off(void) {
    setPixel(fb, 5, 5, 1);
    setPixel(fb, 5, 5, 0);
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 5, 5));
}

void test_pixel_clipping(void) {
    setPixel(fb, -1, 0, 1);
    setPixel(fb, 128, 0, 1);
    setPixel(fb, 0, -1, 1);
    setPixel(fb, 0, 64, 1);
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, -1, 0));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 128, 0));
}

void test_clear_fb(void) {
    setPixel(fb, 0, 0, 1);
    setPixel(fb, 127, 63, 1);
    clearFB(fb);
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 0, 0));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 127, 63));
}

void test_draw_line_horizontal(void) {
    drawLine(fb, 10, 5, 20, 5);
    for (int x = 10; x <= 20; x++) {
        TEST_ASSERT_EQUAL_INT(1, getPixel(fb, x, 5));
    }
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 9, 5));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 21, 5));
}

void test_draw_line_vertical(void) {
    drawLine(fb, 5, 10, 5, 20);
    for (int y = 10; y <= 20; y++) {
        TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 5, y));
    }
}

void test_draw_line_single_pixel(void) {
    drawLine(fb, 50, 30, 50, 30);
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 50, 30));
}

void test_draw_rect(void) {
    drawRect(fb, 10, 10, 4, 4);
    // All pixels in rect should be on
    for (int y = 10; y < 14; y++) {
        for (int x = 10; x < 14; x++) {
            TEST_ASSERT_EQUAL_INT(1, getPixel(fb, x, y));
        }
    }
    // Pixels outside should be off
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 9, 10));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 14, 10));
}

void test_draw_sprite_basic(void) {
    // 8x1 sprite: 0b10000000 = 0x80 (one pixel at x=0)
    uint8_t data[] = { 0x80 };
    drawSprite(fb, data, 10, 20, 0, 8, 1);
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 10, 20));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 11, 20));
}

void test_draw_sprite_flipX(void) {
    // 8x1 sprite: 0x80 = pixel at col 0
    uint8_t data[] = { 0x80 };
    drawSprite(fb, data, 0, 0, 1, 8, 1); // flipX
    // Flipped: pixel should be at col 7
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 0, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 7, 0));
}

void test_draw_sprite_flipY(void) {
    // 8x2 sprite: row 0 = 0x80, row 1 = 0x00
    uint8_t data[] = { 0x80, 0x00 };
    drawSprite(fb, data, 0, 0, 2, 8, 2); // flipY
    // Flipped: pixel at row 1, col 0
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 0, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 0, 1));
}

void test_blit(void) {
    // 4x2 bitmap: 0xF0 (4 pixels on), 0x00 (4 pixels off)
    uint8_t data[] = { 0xF0, 0x00 };
    blit(fb, data, 10, 10, 4, 2);
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 10, 10));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 13, 10));
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 10, 11));
}

void test_double_buffer_swap(void) {
    setPixel(fb, 0, 0, 1); // draw to back buffer
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 0, 0)); // back has it
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 0, 0)); // front doesn't

    swapBuffers(fb);
    // Now the old back is the new front
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 0, 0));
    // New back should be clean (it was the old front)
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 0, 0));
}

void test_pixel_at_corners(void) {
    setPixel(fb, 0, 0, 1);
    setPixel(fb, 127, 0, 1);
    setPixel(fb, 0, 63, 1);
    setPixel(fb, 127, 63, 1);
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 0, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 127, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 0, 63));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 127, 63));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_initial_framebuffer_clear);
    RUN_TEST(test_set_get_pixel);
    RUN_TEST(test_set_pixel_off);
    RUN_TEST(test_pixel_clipping);
    RUN_TEST(test_clear_fb);
    RUN_TEST(test_draw_line_horizontal);
    RUN_TEST(test_draw_line_vertical);
    RUN_TEST(test_draw_line_single_pixel);
    RUN_TEST(test_draw_rect);
    RUN_TEST(test_draw_sprite_basic);
    RUN_TEST(test_draw_sprite_flipX);
    RUN_TEST(test_draw_sprite_flipY);
    RUN_TEST(test_blit);
    RUN_TEST(test_double_buffer_swap);
    RUN_TEST(test_pixel_at_corners);
    return UNITY_END();
}
