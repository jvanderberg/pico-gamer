#pragma once
#include <cstdint>

struct Framebuffer;
struct VMState;
using SyscallHandler = void (*)(uint8_t id, VMState& vm, void* ctx);

static const int WORLD_DEFAULT_W = 128;
static const int WORLD_DEFAULT_H = 64;
static const int MAX_SPRITES = 32;
static const int MAX_WALLS   = 48;
static const int VEL_DIVISOR = 64;
static const int TARGET_FPS  = 60;
static const int CALLBACK_CYCLE_BUDGET = 5000;

// Fixed-point scale: 8 fractional bits (24.8)
static const int FP_SHIFT = 8;
static const int FP_SCALE = (1 << FP_SHIFT); // 256

struct Sprite {
    bool     active;
    uint16_t addr;
    uint8_t  width, height;
    int32_t  x_fp, y_fp;     // 24.8 fixed-point position
    int16_t  vx, vy;         // velocity (VM units, /64 for px/frame)
    uint8_t  flags;           // bit 0=flipX, bit 1=flipY, bit 2=vector
    uint8_t  edge;            // 0=none, 1=wrap, 2=bounce, 3=destroy, 4=stop
    uint8_t  wallMode;
    uint8_t  spriteMode;
    uint8_t  hitFlags;        // bit 0=border, bit 1=wall, bit 2=sprite
    uint8_t  hitIndex;
    uint8_t  collGroup;
    uint8_t  collMask;
    uint16_t hitCallback;
    bool     visible;
    int32_t  angle_fp;        // 24.8 fixed-point angle (integer part 0-255)
    int16_t  rotSpeed;        // angular velocity (same units as vx/vy)
    // Animation state
    uint16_t animAddr;        // base address of first animation frame
    uint8_t  animFrames;      // number of animation frames (0 = no animation)
    uint8_t  animRate;        // game frames per animation step
    uint8_t  animTick;        // current tick counter
    uint8_t  animCurrent;     // current animation frame index
};

struct Wall {
    bool     active;
    int16_t  x, y;
    int16_t  width, height;
};

struct SpriteTable {
    Sprite sprites[MAX_SPRITES];
};

struct WallTable {
    Wall walls[MAX_WALLS];
};

// Tile map system
static const int MAX_TILE_TYPES = 32;
static const int TILE_SIZE = 8;       // 8x8 pixels per tile
static const int TILE_BYTES = 8;      // 8 bytes per 8x8 1-bit tile
static const uint8_t TILE_SOLID = 1;
static const uint8_t TILE_ANIM  = 2;

struct TileMap {
    uint16_t tilesetAddr;              // address in VM memory of first tile bitmap
    uint8_t  tileCount;                // number of tile types
    uint16_t mapAddr;                  // address in VM memory of map data (w*h bytes)
    uint8_t  mapW, mapH;              // map dimensions in tiles
    uint8_t  props[MAX_TILE_TYPES];   // per-tile-index property flags
    bool     active;                   // is tilemap loaded?
    uint16_t frameCount;               // for animated tiles
};

TileMap createTileMap();
void resetTileMap(TileMap& tm);

// Draw visible tiles to framebuffer (camera-aware)
void drawTileMap(const TileMap& tm, const uint8_t* mem, Framebuffer& fb,
                 int16_t cam_x, int16_t cam_y);

// Resolve sprite-tile collisions (replaces wall collision when tilemap active)
void resolveTileCollisions(SpriteTable& table, const TileMap& tm, const uint8_t* mem);

// Advance sprite animations
void updateSpriteAnimations(SpriteTable& table);

// Viewport / camera for worlds larger than the screen
struct Viewport {
    int16_t  world_w, world_h;   // world dimensions in pixels (default: 128, 64)
    int32_t  cam_x_fp, cam_y_fp; // camera top-left in 24.8 fixed-point
    uint8_t  mode;               // 0=none, 1=follow sprite, 2=manual
    uint8_t  followSlot;         // sprite slot to follow (mode=1)
    bool     hudMode;            // when true, drawing syscalls skip camera offset
};

Viewport createViewport();
void resetViewport(Viewport& vp);

SpriteTable createSpriteTable();
void resetSpriteTable(SpriteTable& table);
WallTable createWallTable();
void resetWallTable(WallTable& table);

// Run all 4 update phases. scale_fp is the time-scale factor in 24.8 fixed-point.
// At normal speed (one frame at 60fps): scale_fp = FP_SCALE (256).
void updateSprites(SpriteTable& table, WallTable& walls, int32_t scale_fp, uint8_t* mem,
                   int16_t world_w = WORLD_DEFAULT_W, int16_t world_h = WORLD_DEFAULT_H);

// Update viewport camera position (call after updateSprites, before drawing).
void updateViewport(Viewport& vp, const SpriteTable& table);

// Run hit callbacks for sprites that have collided.
void runHitCallbacks(SpriteTable& table, VMState& vm, SyscallHandler handler, void* ctx);

// Draw all active, visible sprites to the framebuffer.
void drawSprites(const SpriteTable& table, const uint8_t* mem, Framebuffer& fb,
                 int16_t cam_x = 0, int16_t cam_y = 0);

// Helper: get pixel position from fixed-point
inline int16_t fpToPixel(int32_t fp) { return (int16_t)(fp >> FP_SHIFT); }
inline int32_t pixelToFp(int16_t px) { return ((int32_t)px) << FP_SHIFT; }
