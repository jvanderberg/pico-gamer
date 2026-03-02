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

// --- Vector sprite collision tests ---

// Encode a 4.4 fixed-point value: integer * 16
static uint8_t enc44(int val) {
    int16_t fp = (int16_t)(val * 16);
    return (uint8_t)(fp & 0xFF);
}

// Helper: set up a vector sprite with a single horizontal line segment
// The line goes from (-halfW, 0) to (+halfW, 0) in local coords
static void setupVectorSprite(int slot, int x, int y, int w, int h,
                              int halfW, uint16_t addr, int angle) {
    Sprite& s = sprites.sprites[slot];
    s.active = true;
    s.visible = true;
    s.x_fp = pixelToFp(x);
    s.y_fp = pixelToFp(y);
    s.width = w;
    s.height = h;
    s.vx = 0;
    s.vy = 0;
    s.edge = 0;
    s.flags = 4; // vector sprite
    s.addr = addr;
    s.angle_fp = (int32_t)angle << FP_SHIFT;
    s.spriteMode = 1; // detect
    s.collGroup = 0xFF;
    s.collMask = 0xFF;

    // Write vector data: 1 segment, horizontal line from (-halfW,0) to (+halfW,0)
    mem[addr] = 1; // segment count
    mem[addr + 1] = enc44(-halfW); // x1
    mem[addr + 2] = enc44(0);      // y1
    mem[addr + 3] = enc44(halfW);  // x2
    mem[addr + 4] = enc44(0);      // y2
}

void test_vector_sprites_overlapping_collide(void) {
    // Two vector sprites at the same position should collide
    setupVectorSprite(0, 30, 30, 16, 16, 4, 0x200, 0);
    setupVectorSprite(1, 30, 30, 16, 16, 4, 0x300, 0);

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_TRUE(sprites.sprites[0].hitFlags & 4);
    TEST_ASSERT_TRUE(sprites.sprites[1].hitFlags & 4);
}

void test_vector_sprites_apart_no_collide(void) {
    // Two vector sprites far apart should not collide
    setupVectorSprite(0, 10, 10, 16, 16, 4, 0x200, 0);
    setupVectorSprite(1, 80, 10, 16, 16, 4, 0x300, 0);

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_EQUAL_UINT8(0, sprites.sprites[0].hitFlags & 4);
    TEST_ASSERT_EQUAL_UINT8(0, sprites.sprites[1].hitFlags & 4);
}

void test_vector_sprites_aabb_overlap_but_pixels_miss(void) {
    // Two vector sprites whose AABBs overlap but actual lines don't touch.
    // Sprite 0: horizontal line at y=30, sprite 1: horizontal line at y=40
    // AABBs overlap (both 16x16 sprites close together) but lines are offset.
    setupVectorSprite(0, 20, 22, 16, 16, 4, 0x200, 0);
    setupVectorSprite(1, 20, 36, 16, 16, 4, 0x300, 0);
    // AABBs: sprite 0 covers y=22..38, sprite 1 covers y=36..52
    // Lines: sprite 0 line at y=30 (center), sprite 1 line at y=44 (center)
    // AABBs overlap in y=36..38, but no line pixels there

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_EQUAL_UINT8(0, sprites.sprites[0].hitFlags & 4);
    TEST_ASSERT_EQUAL_UINT8(0, sprites.sprites[1].hitFlags & 4);
}

void test_vector_sprites_rotated_collide(void) {
    // Two vector sprites at same position, one rotated 90 degrees (angle=64)
    // Sprite 0: horizontal line, sprite 1: vertical line (rotated 90 deg)
    // They should cross at the center and collide
    setupVectorSprite(0, 30, 30, 16, 16, 4, 0x200, 0);
    setupVectorSprite(1, 30, 30, 16, 16, 4, 0x300, 64);

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_TRUE(sprites.sprites[0].hitFlags & 4);
    TEST_ASSERT_TRUE(sprites.sprites[1].hitFlags & 4);
}

void test_vector_vs_bitmap_collision(void) {
    // Vector sprite overlapping a bitmap sprite should collide.
    // Use 8x8 vector so its center line at y=14 overlaps the bitmap at y=10..17.
    setupVectorSprite(0, 10, 10, 8, 8, 3, 0x200, 0);

    // Set up bitmap sprite at overlapping position
    Sprite& b = sprites.sprites[1];
    b.active = true;
    b.visible = true;
    b.x_fp = pixelToFp(10);
    b.y_fp = pixelToFp(10);
    b.width = 8;
    b.height = 8;
    b.flags = 0; // bitmap
    b.addr = 0x400;
    b.spriteMode = 1;
    b.collGroup = 0xFF;
    b.collMask = 0xFF;
    // Fill bitmap with all-set pixels
    for (int i = 0; i < 8; i++) mem[0x400 + i] = 0xFF;

    updateSprites(sprites, walls, FP_SCALE, mem);
    TEST_ASSERT_TRUE(sprites.sprites[0].hitFlags & 4);
    TEST_ASSERT_TRUE(sprites.sprites[1].hitFlags & 4);
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
    RUN_TEST(test_vector_sprites_overlapping_collide);
    RUN_TEST(test_vector_sprites_apart_no_collide);
    RUN_TEST(test_vector_sprites_aabb_overlap_but_pixels_miss);
    RUN_TEST(test_vector_sprites_rotated_collide);
    RUN_TEST(test_vector_vs_bitmap_collision);
    return UNITY_END();
}
