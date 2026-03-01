#include <unity.h>
#include "sprites.h"
#include "display.h"
#include "vm.h"

static SpriteTable sprites;
static WallTable walls;
static Framebuffer fb;
static uint8_t mem[65536];

void setUp(void) {
    sprites = createSpriteTable();
    walls = createWallTable();
    fb = createFramebuffer();
    memset(mem, 0, sizeof(mem));
}
void tearDown(void) {}

// Helper: set up a simple sprite
static void setupSprite(int slot, int x, int y, int w, int h, int16_t vx, int16_t vy, uint8_t edge) {
    Sprite& s = sprites.sprites[slot];
    s.active = true;
    s.visible = true;
    s.x_fp = pixelToFp(x);
    s.y_fp = pixelToFp(y);
    s.width = w;
    s.height = h;
    s.vx = vx;
    s.vy = vy;
    s.edge = edge;
    s.addr = 0x100;
    // Put a simple 8x8 all-set bitmap at addr 0x100
    for (int i = 0; i < 8; i++) mem[0x100 + i] = 0xFF;
}

void test_velocity_integration(void) {
    setupSprite(0, 10, 20, 8, 8, 64, 0, 0); // vx=64 = 1 px/frame
    updateSprites(sprites, walls, FP_SCALE, mem);
    // After one frame at 60fps: x should move by vx/64 = 1 pixel
    int16_t px = fpToPixel(sprites.sprites[0].x_fp);
    TEST_ASSERT_EQUAL_INT16(11, px);
}

void test_velocity_sub_pixel(void) {
    setupSprite(0, 10, 20, 8, 8, 32, 0, 0); // vx=32 = 0.5 px/frame
    updateSprites(sprites, walls, FP_SCALE, mem);
    // After 1 frame: x_fp should have moved but pixel position may still be 10
    int16_t px1 = fpToPixel(sprites.sprites[0].x_fp);
    TEST_ASSERT_EQUAL_INT16(10, px1); // 10.5 truncates to 10

    updateSprites(sprites, walls, FP_SCALE, mem);
    int16_t px2 = fpToPixel(sprites.sprites[0].x_fp);
    TEST_ASSERT_EQUAL_INT16(11, px2); // 11.0
}

void test_edge_wrap(void) {
    setupSprite(0, 127, 0, 1, 1, 64, 0, 1); // edge=wrap, moving right
    updateSprites(sprites, walls, FP_SCALE, mem);
    int16_t px = fpToPixel(sprites.sprites[0].x_fp);
    TEST_ASSERT_TRUE(px >= 0 && px < 128);
}

void test_edge_bounce(void) {
    setupSprite(0, 120, 0, 8, 8, 64, 0, 2); // edge=bounce, near right edge
    // Move to the edge
    for (int i = 0; i < 5; i++) {
        updateSprites(sprites, walls, FP_SCALE, mem);
    }
    // Velocity should have reversed
    TEST_ASSERT_TRUE(sprites.sprites[0].vx < 0);
    TEST_ASSERT_TRUE(sprites.sprites[0].hitFlags & 1);
}

void test_edge_destroy(void) {
    setupSprite(0, 127, 0, 1, 1, 64, 0, 3); // edge=destroy
    // Move off screen
    for (int i = 0; i < 5; i++) {
        updateSprites(sprites, walls, FP_SCALE, mem);
    }
    TEST_ASSERT_FALSE(sprites.sprites[0].active);
}

void test_edge_stop(void) {
    setupSprite(0, 120, 0, 8, 8, 64, 0, 4); // edge=stop
    for (int i = 0; i < 20; i++) {
        updateSprites(sprites, walls, FP_SCALE, mem);
    }
    TEST_ASSERT_EQUAL_INT16(0, sprites.sprites[0].vx);
    TEST_ASSERT_EQUAL_INT16(120, fpToPixel(sprites.sprites[0].x_fp));
}

void test_wall_collision_bounce(void) {
    setupSprite(0, 5, 5, 8, 8, 64, 0, 0);
    sprites.sprites[0].wallMode = 2; // bounce
    walls.walls[0].active = true;
    walls.walls[0].x = 12; walls.walls[0].y = 0;
    walls.walls[0].width = 10; walls.walls[0].height = 20;

    // Move sprite into wall — track hit across frames (flags reset each frame)
    bool hitWall = false;
    for (int i = 0; i < 5; i++) {
        updateSprites(sprites, walls, FP_SCALE, mem);
        if (sprites.sprites[0].hitFlags & 2) hitWall = true;
    }
    TEST_ASSERT_TRUE(hitWall);
    // Velocity should have reversed (bounced)
    TEST_ASSERT_TRUE(sprites.sprites[0].vx < 0);
}

void test_sprite_collision_detect(void) {
    setupSprite(0, 10, 10, 8, 8, 0, 0, 0);
    setupSprite(1, 15, 10, 8, 8, 0, 0, 0);
    sprites.sprites[0].spriteMode = 1; // detect
    sprites.sprites[1].spriteMode = 1;

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_TRUE(sprites.sprites[0].hitFlags & 4);
    TEST_ASSERT_TRUE(sprites.sprites[1].hitFlags & 4);
}

void test_collision_group_filter(void) {
    setupSprite(0, 10, 10, 8, 8, 0, 0, 0);
    setupSprite(1, 15, 10, 8, 8, 0, 0, 0);
    sprites.sprites[0].spriteMode = 1;
    sprites.sprites[1].spriteMode = 1;
    // Set groups so they don't collide
    sprites.sprites[0].collGroup = 1;
    sprites.sprites[0].collMask = 1;
    sprites.sprites[1].collGroup = 2;
    sprites.sprites[1].collMask = 2;

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_EQUAL_UINT8(0, sprites.sprites[0].hitFlags & 4);
}

void test_hit_flags_cleared_each_frame(void) {
    setupSprite(0, 10, 10, 8, 8, 0, 0, 0);
    setupSprite(1, 15, 10, 8, 8, 0, 0, 0);
    sprites.sprites[0].spriteMode = 1;
    sprites.sprites[1].spriteMode = 1;

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_TRUE(sprites.sprites[0].hitFlags & 4);

    // Move sprites apart
    sprites.sprites[1].x_fp = pixelToFp(100);
    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_EQUAL_UINT8(0, sprites.sprites[0].hitFlags);
}

void test_sprite_destroy_on_collision(void) {
    setupSprite(0, 10, 10, 8, 8, 0, 0, 0);
    setupSprite(1, 15, 10, 8, 8, 0, 0, 0);
    sprites.sprites[0].spriteMode = 3; // destroy
    sprites.sprites[1].spriteMode = 1;

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_FALSE(sprites.sprites[0].active);
    TEST_ASSERT_TRUE(sprites.sprites[1].active);
}

void test_draw_sprites(void) {
    setupSprite(0, 10, 10, 8, 1, 0, 0, 0);
    mem[0x100] = 0xFF; // full row
    drawSprites(sprites, mem, fb);
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 10, 10));
    TEST_ASSERT_EQUAL_INT(1, getPixel(fb, 17, 10));
}

void test_invisible_sprite_not_drawn(void) {
    setupSprite(0, 10, 10, 8, 1, 0, 0, 0);
    mem[0x100] = 0xFF;
    sprites.sprites[0].visible = false;
    drawSprites(sprites, mem, fb);
    TEST_ASSERT_EQUAL_INT(0, getPixel(fb, 10, 10));
}

void test_rotation(void) {
    setupSprite(0, 10, 10, 8, 8, 0, 0, 0);
    sprites.sprites[0].rotSpeed = 64; // 1 step per frame
    updateSprites(sprites, walls, FP_SCALE, mem);
    int angle = (int)(sprites.sprites[0].angle_fp >> FP_SHIFT);
    TEST_ASSERT_EQUAL_INT(1, angle); // should have rotated
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_velocity_integration);
    RUN_TEST(test_velocity_sub_pixel);
    RUN_TEST(test_edge_wrap);
    RUN_TEST(test_edge_bounce);
    RUN_TEST(test_edge_destroy);
    RUN_TEST(test_edge_stop);
    RUN_TEST(test_wall_collision_bounce);
    RUN_TEST(test_sprite_collision_detect);
    RUN_TEST(test_collision_group_filter);
    RUN_TEST(test_hit_flags_cleared_each_frame);
    RUN_TEST(test_sprite_destroy_on_collision);
    RUN_TEST(test_draw_sprites);
    RUN_TEST(test_invisible_sprite_not_drawn);
    RUN_TEST(test_rotation);
    return UNITY_END();
}
