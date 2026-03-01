#pragma once
#include <cstdint>

struct Framebuffer;
struct VMState;
using SyscallHandler = void (*)(uint8_t id, VMState& vm, void* ctx);

static const int MAX_SPRITES = 32;
static const int MAX_WALLS   = 16;
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

SpriteTable createSpriteTable();
void resetSpriteTable(SpriteTable& table);
WallTable createWallTable();
void resetWallTable(WallTable& table);

// Run all 4 update phases. scale_fp is the time-scale factor in 24.8 fixed-point.
// At normal speed (one frame at 60fps): scale_fp = FP_SCALE (256).
void updateSprites(SpriteTable& table, WallTable& walls, int32_t scale_fp, uint8_t* mem);

// Run hit callbacks for sprites that have collided.
void runHitCallbacks(SpriteTable& table, VMState& vm, SyscallHandler handler, void* ctx);

// Draw all active, visible sprites to the framebuffer.
void drawSprites(const SpriteTable& table, const uint8_t* mem, Framebuffer& fb);

// Helper: get pixel position from fixed-point
inline int16_t fpToPixel(int32_t fp) { return (int16_t)(fp >> FP_SHIFT); }
inline int32_t pixelToFp(int16_t px) { return ((int32_t)px) << FP_SHIFT; }
