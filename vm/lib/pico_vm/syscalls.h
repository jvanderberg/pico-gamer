#pragma once
#include <cstdint>

struct VMState;
struct Framebuffer;
struct SpriteTable;
struct WallTable;

enum Sys : uint8_t {
    SYS_CLEAR      = 0x00,
    SYS_PIXEL      = 0x01,
    SYS_LINE       = 0x02,
    SYS_RECT       = 0x03,
    SYS_SPRITE     = 0x04,
    SYS_BLIT       = 0x05,
    SYS_YIELD      = 0x06,
    SYS_TILESET    = 0x07,
    SYS_TILEMAP    = 0x08,
    SYS_SCROLL     = 0x09,
    SYS_SPRITE_OVER= 0x0A,

    SYS_INPUT      = 0x10,

    SYS_RAND       = 0x20,
    SYS_TIME       = 0x21,
    SYS_SIN        = 0x22,
    SYS_COS        = 0x23,
    SYS_TEXT_SM    = 0x24,
    SYS_TEXT_LG    = 0x25,
    SYS_TEXT_NUM   = 0x26,
    SYS_ASHR       = 0x27,
    SYS_FX_MUL     = 0x28,

    SYS_SPR_SET    = 0x40,
    SYS_SPR_POS    = 0x41,
    SYS_SPR_VEL    = 0x42,
    SYS_SPR_GET    = 0x43,
    SYS_SPR_OFF    = 0x44,
    SYS_SPR_EDGE   = 0x45,
    SYS_SPR_WALL   = 0x46,
    SYS_SPR_COLL   = 0x47,
    SYS_WALL_SET   = 0x48,
    SYS_WALL_OFF   = 0x49,
    SYS_SPR_HIT    = 0x4A,
    SYS_SPR_GROUP  = 0x4B,
    SYS_SPR_ON_HIT = 0x4C,
    SYS_SPR_ROT    = 0x4D,
    SYS_SPR_GETROT = 0x4E,
    SYS_SPR_VIS    = 0x4F,
};

struct SyscallContext {
    Framebuffer*  fb;
    SpriteTable*  sprites;
    WallTable*    walls;
    uint16_t      inputBits;
    bool          yieldRequested;
    uint16_t      elapsed_ms;     // controllable by test harness
    uint16_t      rngState;       // xorshift16 state
};

SyscallContext createSyscallContext(Framebuffer* fb, SpriteTable* sprites, WallTable* walls);

// The syscall handler function (matches SyscallHandler signature via wrapper)
void handleSyscall(uint8_t id, VMState& vm, void* ctx);

// Deterministic xorshift16 PRNG
uint16_t xorshift16(uint16_t& state);
