#pragma once
#include <cstdint>

struct VMState;
struct Framebuffer;
struct SpriteTable;
struct WallTable;
struct ParticleTable;

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
    SYS_TILE_PROP  = 0x09,
    SYS_TILE_SET   = 0x0A,
    SYS_TILE_GET   = 0x0B,

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
    SYS_SPR_IMG    = 0x55,
    SYS_SPR_ANIM   = 0x56,
    SYS_SPR_DIR    = 0x57,

    SYS_VOICE      = 0x30,
    SYS_ENVELOPE   = 0x31,
    SYS_NOTE_OFF   = 0x32,
    SYS_FILTER     = 0x33,
    SYS_VOLUME     = 0x34,
    SYS_TONE       = 0x35,
    SYS_SFX        = 0x36,
    SYS_VFILTER    = 0x37,
    SYS_NOTE       = 0x38,
    SYS_VDRIVE     = 0x39,
    SYS_MPLAY      = 0x3A,
    SYS_MSTOP      = 0x3B,

    SYS_PFX_SET    = 0x50,
    SYS_PFX_POS    = 0x51,
    SYS_PFX_BURST  = 0x52,
    SYS_PFX_ON     = 0x53,
    SYS_PFX_CLEAR  = 0x54,

    SYS_CAM_WORLD  = 0x60,
    SYS_CAM_MODE   = 0x61,
    SYS_CAM_POS    = 0x62,
    SYS_CAM_GET    = 0x63,
    SYS_CAM_HUD    = 0x64,
};

// Audio command ring buffer
static constexpr int AUDIO_CMD_MAX = 32;
static constexpr int AUDIO_CMD_MAX_ARGS = 5;

struct AudioCmd {
    uint8_t  id;
    uint16_t args[AUDIO_CMD_MAX_ARGS];
    uint8_t  argCount;
};

struct AudioCmdBuffer {
    AudioCmd cmds[AUDIO_CMD_MAX];
    int count;
};

struct Viewport;

struct TileMap;

struct SyscallContext {
    Framebuffer*   fb;
    SpriteTable*   sprites;
    WallTable*     walls;
    ParticleTable* particles;
    Viewport*      viewport;
    TileMap*       tilemap;
    AudioCmdBuffer audio;
    uint16_t       inputBits;
    bool           yieldRequested;
    uint16_t       elapsed_ms;     // controllable by test harness
    uint16_t       rngState;       // xorshift16 state
};

SyscallContext createSyscallContext(Framebuffer* fb, SpriteTable* sprites, WallTable* walls,
                                   ParticleTable* particles = nullptr);

// The syscall handler function (matches SyscallHandler signature via wrapper)
void handleSyscall(uint8_t id, VMState& vm, void* ctx);

// Deterministic xorshift16 PRNG
uint16_t xorshift16(uint16_t& state);
