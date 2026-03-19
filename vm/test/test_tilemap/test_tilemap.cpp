#include <unity.h>
#include "sprites.h"
#include "display.h"
#include "vm.h"
#include "syscalls.h"
#include "runtime.h"
#include "assembler.h"
#include "memory.h"
#include "particles.h"
#include <cstring>
#include <cstdio>

// Shared state for all tests
static SpriteTable sprites;
static WallTable walls;
static Framebuffer fb;
static TileMap tilemap;
static Viewport viewport;
static ParticleTable particles;
static SyscallContext ctx;
static VMState vm;
static uint8_t mem[65536];

// 8x8 solid white tile (all pixels set)
static const uint8_t SOLID_TILE[8] = {
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF
};
// 8x8 dot tile (center pixel)
static const uint8_t DOT_TILE[8] = {
    0x00, 0x00, 0x00, 0x18, 0x18, 0x00, 0x00, 0x00
};
// 8x8 empty tile
static const uint8_t EMPTY_TILE[8] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

void setUp(void) {
    sprites = createSpriteTable();
    walls = createWallTable();
    fb = createFramebuffer();
    tilemap = createTileMap();
    viewport = createViewport();
    particles = createParticleTable();
    vm = createVM();
    memset(mem, 0, sizeof(mem));
    ctx = createSyscallContext(&fb, &sprites, &walls, &particles);
    ctx.viewport = &viewport;
    ctx.tilemap = &tilemap;
}
void tearDown(void) {}

// =====================================================================
// Helper: build a small tilemap in VM memory, like a game's init_maze
// =====================================================================

// Tileset address and map address in VM memory
static const uint16_t TILESET_ADDR = 0x1000;
static const uint16_t MAP_ADDR     = 0x2000;

// Load tileset: tile 0 = empty, tile 1 = wall, tile 2 = dot
static void loadTileset(uint8_t* m) {
    memcpy(m + TILESET_ADDR + 0 * TILE_BYTES, EMPTY_TILE, TILE_BYTES);
    memcpy(m + TILESET_ADDR + 1 * TILE_BYTES, SOLID_TILE, TILE_BYTES);
    memcpy(m + TILESET_ADDR + 2 * TILE_BYTES, DOT_TILE,   TILE_BYTES);
}

// Build a 4x4 map: walls around the border, dots inside
//   1 1 1 1
//   1 2 2 1
//   1 2 2 1
//   1 1 1 1
static void loadMap4x4(uint8_t* m) {
    uint8_t map[16] = {
        1, 1, 1, 1,
        1, 2, 2, 1,
        1, 2, 2, 1,
        1, 1, 1, 1,
    };
    memcpy(m + MAP_ADDR, map, 16);
}

// Configure tilemap struct to use the loaded data
static void setupTilemap4x4() {
    loadTileset(mem);
    loadMap4x4(mem);
    tilemap.tilesetAddr = TILESET_ADDR;
    tilemap.tileCount = 3;
    tilemap.mapAddr = MAP_ADDR;
    tilemap.mapW = 4;
    tilemap.mapH = 4;
    tilemap.active = true;
    tilemap.frameCount = 0;
    memset(tilemap.props, 0, sizeof(tilemap.props));
    tilemap.props[1] = TILE_SOLID;  // walls block movement
}

// =====================================================================
// TILEMAP TESTS
// =====================================================================

void test_tilemap_draws_tiles_to_framebuffer(void) {
    setupTilemap4x4();
    clearFB(fb);
    drawTileMap(tilemap, mem, fb, 0, 0);
    swapBuffers(fb);

    // Wall tile at (0,0) should have pixels set (solid white tile)
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 0, 0));
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 7, 7));

    // Dot tile at (1,1) = screen (8,8) should have center pixel set
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 11, 11)); // center of 8x8 at (8,8)

    // Empty area just inside the dot's dead zone
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 8, 8)); // corner of dot tile = empty
}

void test_tilemap_inactive_draws_nothing(void) {
    setupTilemap4x4();
    tilemap.active = false;
    clearFB(fb);
    drawTileMap(tilemap, mem, fb, 0, 0);
    swapBuffers(fb);
    // Nothing should be drawn
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 0, 0));
}

void test_tile_set_and_get(void) {
    // This is how muncher.bas converts empty tiles to dots and eats them
    setupTilemap4x4();
    // Verify initial state
    TEST_ASSERT_EQUAL_UINT8(2, mem[MAP_ADDR + 1 * 4 + 1]); // (1,1) = dot

    // "Eat" the dot — set to empty (like TILE_SET col, row, 0)
    mem[MAP_ADDR + 1 * 4 + 1] = 0;
    TEST_ASSERT_EQUAL_UINT8(0, mem[MAP_ADDR + 1 * 4 + 1]);

    // Draw and verify the eaten tile is gone
    clearFB(fb);
    drawTileMap(tilemap, mem, fb, 0, 0);
    swapBuffers(fb);
    // Dot's center pixel at screen (11,11) should now be empty
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 11, 11));
}

void test_tile_collision_stops_sprite(void) {
    // A sprite moving right into a wall tile should be stopped
    // This is the core of Pac-Man maze navigation
    setupTilemap4x4();

    // Place sprite at tile (1,1) = pixel (8,8), moving right toward wall at (3,1)
    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.visible = true;
    spr.width = 8;
    spr.height = 8;
    spr.x_fp = pixelToFp(8);  // tile (1,1)
    spr.y_fp = pixelToFp(8);
    spr.vx = 64;  // 1 px/frame right
    spr.vy = 0;
    spr.wallMode = 4; // STOP on tile collision
    spr.addr = 0x100;
    for (int i = 0; i < 8; i++) mem[0x100 + i] = 0xFF;

    // Run enough frames for the sprite to reach the wall at pixel x=24 (tile col 3)
    // Sprite starts at x=8, wall at x=24, distance=16px at 1px/frame
    for (int frame = 0; frame < 20; frame++) {
        updateSprites(sprites, walls, FP_SCALE, mem,
                      tilemap.mapW * TILE_SIZE, tilemap.mapH * TILE_SIZE);
        resolveTileCollisions(sprites, tilemap, mem);
    }

    int16_t finalX = fpToPixel(spr.x_fp);
    // Sprite should be stopped at or before the wall (x < 24)
    TEST_ASSERT_TRUE(finalX < 24);
    TEST_ASSERT_TRUE(spr.active); // still alive
    // Velocity should be zeroed by STOP mode
    TEST_ASSERT_EQUAL_INT16(0, spr.vx);
}

void test_tile_collision_detect_mode(void) {
    // COLL_DETECT mode: sprite detects tile collision but isn't pushed back
    // Used for eating dots in muncher
    setupTilemap4x4();

    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.visible = true;
    spr.width = 8;
    spr.height = 8;
    spr.x_fp = pixelToFp(8);
    spr.y_fp = pixelToFp(8);
    spr.vx = 64;
    spr.vy = 0;
    spr.wallMode = 1; // DETECT only
    spr.addr = 0x100;
    for (int i = 0; i < 8; i++) mem[0x100 + i] = 0xFF;

    // Run one frame
    updateSprites(sprites, walls, FP_SCALE, mem,
                  tilemap.mapW * TILE_SIZE, tilemap.mapH * TILE_SIZE);
    resolveTileCollisions(sprites, tilemap, mem);

    // Sprite should have moved (not stopped)
    int16_t px = fpToPixel(spr.x_fp);
    TEST_ASSERT_EQUAL_INT16(9, px);
}

void test_tile_prop_flags(void) {
    // Verify that only TILE_SOLID tiles cause collisions
    setupTilemap4x4();
    // Tile 2 (dot) is NOT solid — sprite should pass through
    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.visible = true;
    spr.width = 8;
    spr.height = 8;
    spr.x_fp = pixelToFp(8);  // start on dot tile (1,1)
    spr.y_fp = pixelToFp(8);
    spr.vx = 64;
    spr.vy = 0;
    spr.wallMode = 4; // STOP
    spr.addr = 0x100;
    for (int i = 0; i < 8; i++) mem[0x100 + i] = 0xFF;

    // Move one frame right — should be fine since dot isn't solid
    updateSprites(sprites, walls, FP_SCALE, mem,
                  tilemap.mapW * TILE_SIZE, tilemap.mapH * TILE_SIZE);
    resolveTileCollisions(sprites, tilemap, mem);

    int16_t px = fpToPixel(spr.x_fp);
    TEST_ASSERT_EQUAL_INT16(9, px); // moved successfully
}

void test_animated_tile_alternates(void) {
    // TILE_ANIM flag makes tile alternate with next index
    // Used for power pellets in muncher (blinks)
    setupTilemap4x4();
    tilemap.props[2] = TILE_ANIM; // dot tile animates

    // Place an alternate tile bitmap at index 3
    uint8_t altTile[8] = { 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00 };
    memcpy(mem + TILESET_ADDR + 3 * TILE_BYTES, altTile, TILE_BYTES);
    tilemap.tileCount = 4;

    // Frame count 0: animPhase = (0 & 16) != 0 = false → show original
    tilemap.frameCount = 0;
    clearFB(fb);
    drawTileMap(tilemap, mem, fb, 0, 0);
    swapBuffers(fb);
    // Dot center at tile (1,1) → screen (11,11) should be set
    int original = getPixelFront(fb, 11, 11);
    TEST_ASSERT_EQUAL_INT(1, original);

    // Frame count 17: animPhase = (17 & 16) != 0 = true → show alternate
    tilemap.frameCount = 17;
    clearFB(fb);
    drawTileMap(tilemap, mem, fb, 0, 0);
    swapBuffers(fb);
    // Alt tile has stripe pattern — pixel at (8,8) should be set (first row = 0xFF)
    int alt = getPixelFront(fb, 8, 8);
    TEST_ASSERT_EQUAL_INT(1, alt);
    // But second row of alt tile is 0x00 — pixel at (8,9) should be clear
    int altRow2 = getPixelFront(fb, 8, 9);
    TEST_ASSERT_EQUAL_INT(0, altRow2);
}

void test_tilemap_camera_scrolls_view(void) {
    // Drawing with camera offset should shift which tiles are visible
    // This is how the viewport scrolls in muncher
    setupTilemap4x4();
    clearFB(fb);
    drawTileMap(tilemap, mem, fb, 8, 0); // cam_x=8: scroll right by one tile
    swapBuffers(fb);

    // Tile (1,0) = wall should now appear at screen x=0
    // Wall tile is all-white, so pixel (0,0) should be set
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 0, 0));
}

void test_tilemap_memory_wraps_at_64k(void) {
    // Tilemap near end of memory should wrap addresses safely
    uint16_t nearEnd = 0xFFF0;
    tilemap.tilesetAddr = TILESET_ADDR;
    tilemap.tileCount = 3;
    tilemap.mapAddr = nearEnd;
    tilemap.mapW = 2;
    tilemap.mapH = 2;
    tilemap.active = true;
    loadTileset(mem);
    // Place tiles at wrapped addresses
    mem[nearEnd]     = 1; // wall
    mem[nearEnd + 1] = 0; // empty
    mem[(nearEnd + 2) & 0xFFFF] = 0;
    mem[(nearEnd + 3) & 0xFFFF] = 1;

    clearFB(fb);
    // Should not crash or read OOB
    drawTileMap(tilemap, mem, fb, 0, 0);
    swapBuffers(fb);
    // Top-left tile is wall, should have pixels
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 0, 0));
}

// =====================================================================
// CAMERA / VIEWPORT TESTS
// =====================================================================

void test_camera_follow_sprite(void) {
    // Camera follows pacman around a world larger than the screen
    setupTilemap4x4();
    viewport.world_w = tilemap.mapW * TILE_SIZE; // 32
    viewport.world_h = tilemap.mapH * TILE_SIZE; // 32
    viewport.mode = 1; // follow
    viewport.followSlot = 0;

    // Place sprite at world center
    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.visible = true;
    spr.width = 8;
    spr.height = 8;
    spr.x_fp = pixelToFp(16);
    spr.y_fp = pixelToFp(16);

    updateViewport(viewport, sprites);

    // Camera should center on sprite
    // cam_x = sprite_center_x - SCREEN_W/2 = 20 - 64 = negative → clamped to 0
    // (world is only 32px wide, much smaller than 128px screen)
    int16_t camX = fpToPixel(viewport.cam_x_fp);
    int16_t camY = fpToPixel(viewport.cam_y_fp);
    TEST_ASSERT_EQUAL_INT16(0, camX);
    TEST_ASSERT_EQUAL_INT16(0, camY);
}

void test_camera_follow_in_large_world(void) {
    // Like muncher: 128x136 world, camera follows player
    viewport.world_w = 128;
    viewport.world_h = 136;
    viewport.mode = 1;
    viewport.followSlot = 0;

    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.width = 8;
    spr.height = 8;
    // Place sprite at y=88 (near bottom of 136px world)
    spr.x_fp = pixelToFp(56);
    spr.y_fp = pixelToFp(88);

    updateViewport(viewport, sprites);

    int16_t camX = fpToPixel(viewport.cam_x_fp);
    int16_t camY = fpToPixel(viewport.cam_y_fp);

    // X: sprite center=60, cam=60-64=-4 → clamped to 0 (world_w == SCREEN_W)
    TEST_ASSERT_EQUAL_INT16(0, camX);
    // Y: sprite center=92, cam=92-32=60, max_y=136-64=72 → 60 (within bounds)
    TEST_ASSERT_EQUAL_INT16(60, camY);
}

void test_camera_clamps_to_world_bounds(void) {
    viewport.world_w = 256;
    viewport.world_h = 128;
    viewport.mode = 1;
    viewport.followSlot = 0;

    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.width = 8;
    spr.height = 8;
    spr.x_fp = pixelToFp(250); // near right edge
    spr.y_fp = pixelToFp(120); // near bottom edge

    updateViewport(viewport, sprites);

    int16_t camX = fpToPixel(viewport.cam_x_fp);
    int16_t camY = fpToPixel(viewport.cam_y_fp);

    // max cam_x = 256 - 128 = 128
    TEST_ASSERT_TRUE(camX <= 128);
    TEST_ASSERT_TRUE(camX >= 0);
    // max cam_y = 128 - 64 = 64
    TEST_ASSERT_TRUE(camY <= 64);
    TEST_ASSERT_TRUE(camY >= 0);
}

void test_camera_manual_mode(void) {
    viewport.world_w = 256;
    viewport.world_h = 128;
    viewport.mode = 2; // manual

    viewport.cam_x_fp = pixelToFp(50);
    viewport.cam_y_fp = pixelToFp(30);

    updateViewport(viewport, sprites);

    // Manual mode doesn't change camera position (just clamps)
    TEST_ASSERT_EQUAL_INT16(50, fpToPixel(viewport.cam_x_fp));
    TEST_ASSERT_EQUAL_INT16(30, fpToPixel(viewport.cam_y_fp));
}

void test_hud_mode_bypasses_camera(void) {
    // When HUD mode is on, drawing syscalls should ignore camera offset
    // This is how muncher draws the score at fixed screen positions
    viewport.world_w = 256;
    viewport.world_h = 128;
    viewport.cam_x_fp = pixelToFp(100); // camera scrolled far right
    viewport.cam_y_fp = pixelToFp(0);

    // With HUD off, getCamOffset returns the camera position
    viewport.hudMode = false;
    // We can test this through the syscall mechanism
    // Set up VM to draw a pixel at (1,1) — should be offset by camera
    vm = createVM();
    const char* asmSrc =
        "PUSH8 1\n"  // x
        "PUSH8 1\n"  // y
        "PUSH8 1\n"  // color
        "SYSCALL 1\n" // PIXEL
        "SYSCALL 6\n" // YIELD
        "HALT\n";
    AssemblerResult r = assemble(asmSrc);
    TEST_ASSERT_FALSE(r.error);
    loadProgram(vm.memory, r.bytecode, r.length);
    // Copy tileset/map to vm.memory too
    memcpy(vm.memory + TILESET_ADDR, mem + TILESET_ADDR, 3 * TILE_BYTES);

    ctx = createSyscallContext(&fb, &sprites, &walls, &particles);
    ctx.viewport = &viewport;

    execGameFrame(vm, fb, ctx, sprites, walls);
    // Pixel at screen (1,1) should NOT be set (camera offset moved it off screen)
    TEST_ASSERT_EQUAL_INT(0, getPixelFront(fb, 1, 1));

    // Now with HUD mode ON
    viewport.hudMode = true;
    resetVM(vm);
    loadProgram(vm.memory, r.bytecode, r.length);
    ctx.yieldRequested = false;
    execGameFrame(vm, fb, ctx, sprites, walls);
    // Pixel at screen (1,1) SHOULD be set (HUD ignores camera)
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 1, 1));
}

// =====================================================================
// SPRITE ANIMATION TESTS
// =====================================================================

void test_sprite_animation_advances_frames(void) {
    // Like pacman's mouth animation: cycles through frames at a set rate
    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.visible = true;
    spr.width = 8;
    spr.height = 8;
    spr.x_fp = pixelToFp(10);
    spr.y_fp = pixelToFp(10);

    // Place 3 animation frames at address 0x200 (each 8 bytes for 8x8 sprite)
    spr.animAddr = 0x200;
    spr.animFrames = 3;
    spr.animRate = 4; // advance every 4 game frames
    spr.animTick = 0;
    spr.animCurrent = 0;
    spr.addr = 0x200; // starts at frame 0

    // Frame data
    for (int f = 0; f < 3; f++) {
        for (int i = 0; i < 8; i++) {
            mem[0x200 + f * 8 + i] = (uint8_t)(f + 1); // distinct patterns
        }
    }

    // After 3 ticks, still on frame 0
    for (int i = 0; i < 3; i++) updateSpriteAnimations(sprites);
    TEST_ASSERT_EQUAL_UINT8(0, spr.animCurrent);
    TEST_ASSERT_EQUAL_UINT16(0x200, spr.addr);

    // After 4th tick, advances to frame 1
    updateSpriteAnimations(sprites);
    TEST_ASSERT_EQUAL_UINT8(1, spr.animCurrent);
    TEST_ASSERT_EQUAL_UINT16(0x208, spr.addr); // 0x200 + 1*8

    // After 4 more ticks, frame 2
    for (int i = 0; i < 4; i++) updateSpriteAnimations(sprites);
    TEST_ASSERT_EQUAL_UINT8(2, spr.animCurrent);
    TEST_ASSERT_EQUAL_UINT16(0x210, spr.addr); // 0x200 + 2*8

    // After 4 more ticks, wraps back to frame 0
    for (int i = 0; i < 4; i++) updateSpriteAnimations(sprites);
    TEST_ASSERT_EQUAL_UINT8(0, spr.animCurrent);
    TEST_ASSERT_EQUAL_UINT16(0x200, spr.addr);
}

void test_sprite_animation_single_frame_no_advance(void) {
    // animFrames <= 1 should not animate
    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.animAddr = 0x200;
    spr.animFrames = 1;
    spr.animRate = 4;
    spr.animTick = 0;
    spr.animCurrent = 0;
    spr.addr = 0x200;

    for (int i = 0; i < 20; i++) updateSpriteAnimations(sprites);
    TEST_ASSERT_EQUAL_UINT8(0, spr.animCurrent);
    TEST_ASSERT_EQUAL_UINT16(0x200, spr.addr);
}

void test_spr_img_changes_bitmap(void) {
    // SPR_IMG is how muncher swaps pacman's directional bitmaps
    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.addr = 0x100;

    // Simulate SPR_IMG syscall: just sets addr
    spr.addr = 0x300;
    TEST_ASSERT_EQUAL_UINT16(0x300, spr.addr);

    // Verify it draws from the new address
    spr.width = 8;
    spr.height = 8;
    spr.x_fp = pixelToFp(0);
    spr.y_fp = pixelToFp(0);
    spr.visible = true;
    spr.flags = 0;
    spr.angle_fp = 0;
    // Put distinct pattern at 0x300
    for (int i = 0; i < 8; i++) mem[0x300 + i] = 0x81; // corners only

    clearFB(fb);
    drawSprites(sprites, mem, fb, 0, 0);
    swapBuffers(fb);
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 0, 0)); // MSB of 0x81
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 7, 0)); // LSB of 0x81
}

void test_spr_dir_sets_cardinal_velocity(void) {
    // SPR_DIR is how muncher sets ghost movement direction
    Sprite& spr = sprites.sprites[0];
    spr.active = true;
    spr.width = 8;
    spr.height = 8;
    spr.x_fp = pixelToFp(56);
    spr.y_fp = pixelToFp(56);

    // Test all 4 directions via syscall
    // dir=0 (RIGHT): vx=speed, vy=0
    spr.vx = 0; spr.vy = 0;
    // Simulate SYS_SPR_DIR: dir=0, speed=32
    int16_t speed = 32;
    switch (0 & 3) {
        case 0: spr.vx = speed;  spr.vy = 0;      break;
        case 1: spr.vx = 0;      spr.vy = speed;  break;
        case 2: spr.vx = -speed; spr.vy = 0;      break;
        case 3: spr.vx = 0;      spr.vy = -speed; break;
    }
    TEST_ASSERT_EQUAL_INT16(32, spr.vx);
    TEST_ASSERT_EQUAL_INT16(0, spr.vy);

    // dir=2 (LEFT): vx=-speed, vy=0
    switch (2 & 3) {
        case 0: spr.vx = speed;  spr.vy = 0;      break;
        case 1: spr.vx = 0;      spr.vy = speed;  break;
        case 2: spr.vx = -speed; spr.vy = 0;      break;
        case 3: spr.vx = 0;      spr.vy = -speed; break;
    }
    TEST_ASSERT_EQUAL_INT16(-32, spr.vx);
    TEST_ASSERT_EQUAL_INT16(0, spr.vy);

    // dir=3 (UP): vx=0, vy=-speed
    switch (3 & 3) {
        case 0: spr.vx = speed;  spr.vy = 0;      break;
        case 1: spr.vx = 0;      spr.vy = speed;  break;
        case 2: spr.vx = -speed; spr.vy = 0;      break;
        case 3: spr.vx = 0;      spr.vy = -speed; break;
    }
    TEST_ASSERT_EQUAL_INT16(0, spr.vx);
    TEST_ASSERT_EQUAL_INT16(-32, spr.vy);
}

// =====================================================================
// SYSCALL-DRIVEN INTEGRATION TESTS
// Run actual bytecode to exercise the tilemap/camera/animation syscalls
// end-to-end, as a game would use them.
// =====================================================================

static void loadAsm(const char* source) {
    AssemblerResult r = assemble(source);
    if (r.error) {
        TEST_FAIL_MESSAGE(r.errorMsg);
        return;
    }
    resetVM(vm);
    resetSpriteTable(sprites);
    resetWallTable(walls);
    resetTileMap(tilemap);
    resetViewport(viewport);
    ctx = createSyscallContext(&fb, &sprites, &walls, &particles);
    ctx.viewport = &viewport;
    ctx.tilemap = &tilemap;
    ctx.yieldRequested = false;
    loadProgram(vm.memory, r.bytecode, r.length);
}

void test_syscall_tileset_tilemap_tile_prop(void) {
    // Simulate what init_maze does: TILESET, TILEMAP, TILE_PROP
    // Place tile data in VM memory first
    uint16_t tileAddr = 0x500;
    uint8_t solidTile[8] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
    uint8_t emptyTile[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };

    char asmBuf[1024];
    snprintf(asmBuf, sizeof(asmBuf),
        // TILESET(addr, count=2)
        "PUSH16 %u\n"   // addr
        "PUSH8 2\n"     // count
        "SYSCALL 7\n"   // SYS_TILESET

        // TILEMAP(addr, w=4, h=3)
        "PUSH16 %u\n"   // map addr
        "PUSH8 4\n"     // width
        "PUSH8 3\n"     // height
        "SYSCALL 8\n"   // SYS_TILEMAP

        // TILE_PROP(1, TILE_SOLID)
        "PUSH8 1\n"     // tileIdx
        "PUSH8 1\n"     // flags = TILE_SOLID
        "SYSCALL 9\n"   // SYS_TILE_PROP

        "SYSCALL 6\n"   // YIELD
        "HALT\n",
        tileAddr, (unsigned)(tileAddr + 2 * TILE_BYTES));

    loadAsm(asmBuf);

    // Place tile data in VM memory
    memcpy(vm.memory + tileAddr, emptyTile, 8);
    memcpy(vm.memory + tileAddr + 8, solidTile, 8);

    // Place map data: top row walls, rest empty
    uint16_t mapAddr = tileAddr + 2 * TILE_BYTES;
    for (int i = 0; i < 4; i++) vm.memory[mapAddr + i] = 1; // row 0: walls
    for (int i = 4; i < 12; i++) vm.memory[mapAddr + i] = 0; // rows 1-2: empty

    execGameFrame(vm, fb, ctx, sprites, walls);

    // Verify tilemap was configured
    TEST_ASSERT_TRUE(tilemap.active);
    TEST_ASSERT_EQUAL_UINT8(4, tilemap.mapW);
    TEST_ASSERT_EQUAL_UINT8(3, tilemap.mapH);
    TEST_ASSERT_EQUAL_UINT8(2, tilemap.tileCount);
    TEST_ASSERT_EQUAL_UINT8(1, tilemap.props[1]); // TILE_SOLID

    // Verify viewport world size was set by TILEMAP
    TEST_ASSERT_EQUAL_INT16(32, viewport.world_w);  // 4 * 8
    TEST_ASSERT_EQUAL_INT16(24, viewport.world_h);   // 3 * 8
}

void test_syscall_tile_set_and_get(void) {
    // Set up a tilemap, then use TILE_SET and TILE_GET syscalls
    setupTilemap4x4();
    // Copy tileset and map into vm.memory
    memcpy(vm.memory + TILESET_ADDR, mem + TILESET_ADDR, 3 * TILE_BYTES);
    memcpy(vm.memory + MAP_ADDR, mem + MAP_ADDR, 16);

    // Reconfigure tilemap to use vm.memory addresses
    tilemap.tilesetAddr = TILESET_ADDR;
    tilemap.mapAddr = MAP_ADDR;

    char asmBuf[512];
    snprintf(asmBuf, sizeof(asmBuf),
        // TILE_GET(col=1, row=1) — should return 2 (dot)
        "PUSH8 1\n"     // col
        "PUSH8 1\n"     // row
        "SYSCALL 11\n"  // SYS_TILE_GET → pushes result

        // TILE_SET(col=1, row=1, tileIdx=0) — eat the dot
        "PUSH8 1\n"     // col
        "PUSH8 1\n"     // row
        "PUSH8 0\n"     // tileIdx = empty
        "SYSCALL 10\n"  // SYS_TILE_SET

        // TILE_GET(col=1, row=1) again — should now return 0
        "PUSH8 1\n"     // col
        "PUSH8 1\n"     // row
        "SYSCALL 11\n"  // SYS_TILE_GET → pushes result

        "HALT\n");

    loadAsm(asmBuf);
    // loadAsm resets tilemap — re-configure it and reload map data
    tilemap.tilesetAddr = TILESET_ADDR;
    tilemap.mapAddr = MAP_ADDR;
    tilemap.mapW = 4;
    tilemap.mapH = 4;
    tilemap.active = true;
    memcpy(vm.memory + TILESET_ADDR, mem + TILESET_ADDR, 3 * TILE_BYTES);
    memcpy(vm.memory + MAP_ADDR, mem + MAP_ADDR, 16);

    execGameFrame(vm, fb, ctx, sprites, walls);

    // Stack should have: [2, 0] (first get=2, second get=0)
    TEST_ASSERT_EQUAL_UINT16(2, vm.sp);
    // Top of stack is the second TILE_GET result
    TEST_ASSERT_EQUAL_UINT16(0, vm.stack[1]); // eaten → 0
    TEST_ASSERT_EQUAL_UINT16(2, vm.stack[0]); // original → 2 (dot)
}

void test_syscall_spr_dir(void) {
    // SPR_DIR sets velocity by direction, like ghost movement
    char asmBuf[512];
    snprintf(asmBuf, sizeof(asmBuf),
        // Set up sprite first
        "PUSH8 0\n"     // slot
        "PUSH16 256\n"  // addr
        "PUSH8 8\n"     // width
        "PUSH8 8\n"     // height
        "PUSH8 10\n"    // x
        "PUSH8 10\n"    // y
        "PUSH8 0\n"     // flags
        "PUSH8 0\n"     // vx
        "PUSH8 0\n"     // vy
        "PUSH8 0\n"     // edge
        "SYSCALL 64\n"  // SYS_SPR_SET

        // SPR_DIR(slot=0, dir=2(left), speed=32)
        "PUSH8 0\n"     // slot
        "PUSH8 2\n"     // dir = LEFT
        "PUSH8 32\n"    // speed
        "SYSCALL 87\n"  // SYS_SPR_DIR (0x57)

        "SYSCALL 6\n"   // YIELD
        "HALT\n");

    loadAsm(asmBuf);
    execGameFrame(vm, fb, ctx, sprites, walls);

    // Sprite should have vx=-32, vy=0 (moving left)
    TEST_ASSERT_EQUAL_INT16(-32, sprites.sprites[0].vx);
    TEST_ASSERT_EQUAL_INT16(0, sprites.sprites[0].vy);
}

void test_syscall_spr_anim(void) {
    // SPR_ANIM sets up animation, then updateSpriteAnimations advances it
    char asmBuf[512];
    snprintf(asmBuf, sizeof(asmBuf),
        // Set up sprite
        "PUSH8 0\n"     // slot
        "PUSH16 256\n"  // addr
        "PUSH8 8\n"     // width
        "PUSH8 8\n"     // height
        "PUSH8 10\n"    // x
        "PUSH8 10\n"    // y
        "PUSH8 0\n"     // flags
        "PUSH8 0\n"     // vx
        "PUSH8 0\n"     // vy
        "PUSH8 0\n"     // edge
        "SYSCALL 64\n"  // SYS_SPR_SET

        // SPR_ANIM(slot=0, addr=0x300, count=4, rate=2)
        "PUSH8 0\n"     // slot
        "PUSH16 768\n"  // addr = 0x300
        "PUSH8 4\n"     // frame count
        "PUSH8 2\n"     // rate
        "SYSCALL 86\n"  // SYS_SPR_ANIM (0x56)

        "SYSCALL 6\n"   // YIELD
        "HALT\n");

    loadAsm(asmBuf);
    execGameFrame(vm, fb, ctx, sprites, walls);

    Sprite& spr = sprites.sprites[0];
    TEST_ASSERT_EQUAL_UINT16(0x300, spr.animAddr);
    TEST_ASSERT_EQUAL_UINT8(4, spr.animFrames);
    TEST_ASSERT_EQUAL_UINT8(2, spr.animRate);
    TEST_ASSERT_EQUAL_UINT8(0, spr.animCurrent);
    // addr should be set to animAddr (first frame)
    TEST_ASSERT_EQUAL_UINT16(0x300, spr.addr);
}

void test_syscall_cam_mode_and_cam_get(void) {
    // CAM_MODE(FOLLOW, slot) + CAM_GET — like muncher's camera setup
    char asmBuf[512];
    snprintf(asmBuf, sizeof(asmBuf),
        // Set up world
        "PUSH16 256\n"  // w
        "PUSH16 128\n"  // h
        "SYSCALL 96\n"  // SYS_CAM_WORLD (0x60)

        // Set up sprite at x=100, y=60
        "PUSH8 0\n"
        "PUSH16 256\n"
        "PUSH8 8\n"
        "PUSH8 8\n"
        "PUSH8 100\n"
        "PUSH8 60\n"
        "PUSH8 0\n"
        "PUSH8 0\n"
        "PUSH8 0\n"
        "PUSH8 0\n"
        "SYSCALL 64\n"  // SYS_SPR_SET

        // CAM_MODE(mode=1, slot=0)
        "PUSH8 1\n"     // mode = follow
        "PUSH8 0\n"     // slot
        "SYSCALL 97\n"  // SYS_CAM_MODE (0x61)

        "SYSCALL 6\n"   // YIELD — triggers viewport update
        // CAM_GET after viewport update
        "SYSCALL 99\n"  // SYS_CAM_GET (0x63)
        "HALT\n");

    loadAsm(asmBuf);
    execGameFrame(vm, fb, ctx, sprites, walls);
    // Second frame to execute CAM_GET
    execGameFrame(vm, fb, ctx, sprites, walls);

    // Camera should have followed the sprite
    // Stack has [cam_x, cam_y] from CAM_GET
    TEST_ASSERT_EQUAL_UINT16(2, vm.sp);
    // sprite center x = 104, cam_x = 104 - 64 = 40
    uint16_t camX = vm.stack[0];
    TEST_ASSERT_EQUAL_UINT16(40, camX);
}

void test_syscall_cam_hud(void) {
    // CAM_HUD toggles HUD mode
    loadAsm(
        "PUSH8 1\n"
        "SYSCALL 100\n"  // SYS_CAM_HUD (0x64), flag=1
        "HALT\n"
    );
    execGameFrame(vm, fb, ctx, sprites, walls);
    TEST_ASSERT_TRUE(viewport.hudMode);

    loadAsm(
        "PUSH8 0\n"
        "SYSCALL 100\n"
        "HALT\n"
    );
    execGameFrame(vm, fb, ctx, sprites, walls);
    TEST_ASSERT_FALSE(viewport.hudMode);
}

void test_pfx_pos_large_coordinates(void) {
    // Verify the int16_t cast fix: emitter positions that fit in 8.8 fixed-point
    // should not be corrupted by the double-cast. 8.8 signed range is -128..127,
    // but unsigned values 0-255 pushed from BASIC are cast to int16_t first.
    // The old code did (int16_t)((int16_t)x << 8) — the inner cast truncates
    // the value before shifting. The fix does ((int16_t)x) << 8.
    // Test with x=100 (fits in int16_t, and 100*256=25600 fits in int16_t).
    loadAsm(
        // PFX_SET(slot=0, speed=10, life=20, spread=128, dir=0, grav=0, flags=0)
        "PUSH8 0\n"     // slot
        "PUSH8 10\n"    // speed
        "PUSH8 20\n"    // life
        "PUSH8 128\n"   // spread
        "PUSH8 0\n"     // dir
        "PUSH8 0\n"     // grav
        "PUSH8 0\n"     // flags
        "SYSCALL 80\n"  // SYS_PFX_SET (0x50)

        // PFX_POS(slot=0, x=100, y=80)
        "PUSH8 0\n"     // slot
        "PUSH16 100\n"  // x
        "PUSH16 80\n"   // y
        "SYSCALL 81\n"  // SYS_PFX_POS (0x51)

        "HALT\n"
    );
    execGameFrame(vm, fb, ctx, sprites, walls);

    // Verify emitter position is correct (not truncated)
    int16_t emX = (int16_t)(particles.emitters[0].x_fp >> 8);
    int16_t emY = (int16_t)(particles.emitters[0].y_fp >> 8);
    TEST_ASSERT_EQUAL_INT16(100, emX);
    TEST_ASSERT_EQUAL_INT16(80, emY);
}

// =====================================================================
// FULL GAME-LIKE INTEGRATION: muncher init sequence
// =====================================================================

void test_muncher_init_sequence(void) {
    // Replicate muncher.bas init_maze + init_sprites + camera setup
    // This tests the entire tilemap pipeline end-to-end

    // 1. Place tile graphics in VM memory
    uint16_t tAddr = 0x500;
    for (int t = 0; t < 7; t++) {
        for (int b = 0; b < 8; b++) {
            vm.memory[tAddr + t * 8 + b] = (t == 1) ? 0xFF : 0x00;
        }
    }

    // 2. Place map data: 4x4 maze
    uint16_t mAddr = 0x600;
    uint8_t map[] = {
        1, 1, 1, 1,
        1, 0, 0, 1,
        1, 0, 0, 1,
        1, 1, 1, 1,
    };
    memcpy(vm.memory + mAddr, map, 16);

    // 3. Run syscalls via VM
    char asmBuf[2048];
    snprintf(asmBuf, sizeof(asmBuf),
        // TILESET
        "PUSH16 %u\n"
        "PUSH8 7\n"
        "SYSCALL 7\n"

        // TILEMAP
        "PUSH16 %u\n"
        "PUSH8 4\n"
        "PUSH8 4\n"
        "SYSCALL 8\n"

        // TILE_PROP(1, SOLID)
        "PUSH8 1\n"
        "PUSH8 1\n"
        "SYSCALL 9\n"

        // Convert empty tiles to dots (tile 2) using TILE_GET/SET
        // Check (1,1): if 0, set to 2
        "PUSH8 1\n" "PUSH8 1\n" "SYSCALL 11\n" // TILE_GET(1,1)
        "JNZ skip1\n"
        "PUSH8 1\n" "PUSH8 1\n" "PUSH8 2\n" "SYSCALL 10\n" // TILE_SET(1,1,2)
        "skip1:\n"

        // Set up pacman sprite at tile (1,1) = pixel (8,8)
        "PUSH8 0\n"     // slot
        "PUSH16 256\n"  // addr (placeholder)
        "PUSH8 8\n"     // width
        "PUSH8 8\n"     // height
        "PUSH8 8\n"     // x
        "PUSH8 8\n"     // y
        "PUSH8 0\n"     // flags
        "PUSH8 0\n"     // vx
        "PUSH8 0\n"     // vy
        "PUSH8 0\n"     // edge
        "SYSCALL 64\n"  // SYS_SPR_SET

        // SPR_WALL(0, STOP)
        "PUSH8 0\n" "PUSH8 4\n" "SYSCALL 70\n"

        // CAM_MODE(FOLLOW, 0)
        "PUSH8 1\n" "PUSH8 0\n" "SYSCALL 97\n"

        "SYSCALL 6\n"
        "HALT\n",
        tAddr, mAddr);

    loadAsm(asmBuf);
    // Restore tile/map data (loadAsm resets vm.memory)
    for (int t = 0; t < 7; t++) {
        for (int b = 0; b < 8; b++) {
            vm.memory[tAddr + t * 8 + b] = (t == 1) ? 0xFF : 0x00;
        }
    }
    memcpy(vm.memory + mAddr, map, 16);

    execGameFrame(vm, fb, ctx, sprites, walls);

    // Verify everything is set up correctly
    TEST_ASSERT_TRUE(tilemap.active);
    TEST_ASSERT_EQUAL_UINT8(1, tilemap.props[1]); // wall is solid
    TEST_ASSERT_TRUE(sprites.sprites[0].active);
    TEST_ASSERT_EQUAL_UINT8(4, sprites.sprites[0].wallMode); // STOP
    TEST_ASSERT_EQUAL_UINT8(1, viewport.mode); // follow

    // The dot was placed
    TEST_ASSERT_EQUAL_UINT8(2, vm.memory[mAddr + 1 * 4 + 1]);

    // Tilemap should have rendered to the front buffer
    // Wall at (0,0) should be visible
    TEST_ASSERT_EQUAL_INT(1, getPixelFront(fb, 0, 0));
}

// =====================================================================

int main(void) {
    UNITY_BEGIN();

    // Tilemap
    RUN_TEST(test_tilemap_draws_tiles_to_framebuffer);
    RUN_TEST(test_tilemap_inactive_draws_nothing);
    RUN_TEST(test_tile_set_and_get);
    RUN_TEST(test_tile_collision_stops_sprite);
    RUN_TEST(test_tile_collision_detect_mode);
    RUN_TEST(test_tile_prop_flags);
    RUN_TEST(test_animated_tile_alternates);
    RUN_TEST(test_tilemap_camera_scrolls_view);
    RUN_TEST(test_tilemap_memory_wraps_at_64k);

    // Camera / Viewport
    RUN_TEST(test_camera_follow_sprite);
    RUN_TEST(test_camera_follow_in_large_world);
    RUN_TEST(test_camera_clamps_to_world_bounds);
    RUN_TEST(test_camera_manual_mode);
    RUN_TEST(test_hud_mode_bypasses_camera);

    // Sprite Animation
    RUN_TEST(test_sprite_animation_advances_frames);
    RUN_TEST(test_sprite_animation_single_frame_no_advance);
    RUN_TEST(test_spr_img_changes_bitmap);
    RUN_TEST(test_spr_dir_sets_cardinal_velocity);

    // Syscall integration
    RUN_TEST(test_syscall_tileset_tilemap_tile_prop);
    RUN_TEST(test_syscall_tile_set_and_get);
    RUN_TEST(test_syscall_spr_dir);
    RUN_TEST(test_syscall_spr_anim);
    RUN_TEST(test_syscall_cam_mode_and_cam_get);
    RUN_TEST(test_syscall_cam_hud);
    RUN_TEST(test_pfx_pos_large_coordinates);

    // Full game-like integration
    RUN_TEST(test_muncher_init_sequence);

    return UNITY_END();
}
