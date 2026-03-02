#include "syscalls.h"
#include "vm.h"
#include "display.h"
#include "font.h"
#include "sprites.h"
#include "particles.h"
#include "sin_table.h"
#include "memory.h"
#include <cstdio>
#include <cstring>

SyscallContext createSyscallContext(Framebuffer* fb, SpriteTable* sprites, WallTable* walls,
                                   ParticleTable* particles) {
    SyscallContext ctx;
    ctx.fb = fb;
    ctx.sprites = sprites;
    ctx.walls = walls;
    ctx.particles = particles;
    ctx.audio.count = 0;
    ctx.inputBits = 0;
    ctx.yieldRequested = false;
    ctx.elapsed_ms = 0;
    ctx.rngState = 1; // non-zero seed
    return ctx;
}

uint16_t xorshift16(uint16_t& state) {
    state ^= state << 7;
    state ^= state >> 9;
    state ^= state << 8;
    return state;
}

// Read null-terminated string from VM memory
static void readString(const uint8_t* mem, uint16_t addr, char* out, int maxLen) {
    int i = 0;
    for (; i < maxLen - 1; i++) {
        uint8_t ch = mem[(addr + i) & 0xFFFF];
        if (ch == 0) break;
        out[i] = (char)ch;
    }
    out[i] = '\0';
}

void handleSyscall(uint8_t id, VMState& vm, void* ctxPtr) {
    SyscallContext& ctx = *(SyscallContext*)ctxPtr;

    switch (id) {
        case SYS_CLEAR:
            clearFB(*ctx.fb);
            break;

        case SYS_PIXEL: {
            uint16_t color = pop(vm);
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            setPixel(*ctx.fb, (int)x, (int)y, (int)color);
            break;
        }

        case SYS_LINE: {
            uint16_t x1 = pop(vm);
            uint16_t y1 = pop(vm);
            uint16_t x0 = pop(vm);
            uint16_t y0 = pop(vm);
            drawLine(*ctx.fb, (int)x0, (int)y0, (int)x1, (int)y1);
            break;
        }

        case SYS_RECT: {
            uint16_t h = pop(vm);
            uint16_t w = pop(vm);
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            drawRect(*ctx.fb, (int)x, (int)y, (int)w, (int)h);
            break;
        }

        case SYS_SPRITE: {
            uint16_t flags = pop(vm);
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            uint16_t height = pop(vm);
            uint16_t width = pop(vm);
            uint16_t addr = pop(vm);
            drawSprite(*ctx.fb, vm.memory + addr, (int)x, (int)y, (uint8_t)flags, (int)width, (int)height);
            break;
        }

        case SYS_BLIT: {
            uint16_t h = pop(vm);
            uint16_t w = pop(vm);
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            uint16_t srcAddr = pop(vm);
            blit(*ctx.fb, vm.memory + srcAddr, (int)x, (int)y, (int)w, (int)h);
            break;
        }

        case SYS_YIELD:
            ctx.yieldRequested = true;
            break;

        case SYS_TILESET:
        case SYS_TILEMAP:
        case SYS_SCROLL:
        case SYS_SPRITE_OVER:
            pop(vm);
            break;

        case SYS_INPUT:
            push(vm, ctx.inputBits);
            break;

        case SYS_RAND:
            push(vm, xorshift16(ctx.rngState));
            break;

        case SYS_TIME:
            push(vm, ctx.elapsed_ms);
            break;

        case SYS_SIN: {
            uint16_t angle = pop(vm) & 0xFF;
            push(vm, SIN_TABLE[angle]);
            break;
        }

        case SYS_COS: {
            uint16_t angle = pop(vm) & 0xFF;
            push(vm, SIN_TABLE[(angle + 64) & 0xFF]);
            break;
        }

        case SYS_TEXT_SM: {
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            uint16_t strAddr = pop(vm);
            char str[256];
            readString(vm.memory, strAddr, str, sizeof(str));
            drawText(*ctx.fb, str, (int)x, (int)y, FONT_SM, 3, 5, 4);
            break;
        }

        case SYS_TEXT_LG: {
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            uint16_t strAddr = pop(vm);
            char str[256];
            readString(vm.memory, strAddr, str, sizeof(str));
            drawText(*ctx.fb, str, (int)x, (int)y, FONT_LG, 5, 7, 6);
            break;
        }

        case SYS_TEXT_NUM: {
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            uint16_t value = pop(vm);
            char str[16];
            snprintf(str, sizeof(str), "%u", value);
            drawText(*ctx.fb, str, (int)x, (int)y, FONT_SM, 3, 5, 4);
            break;
        }

        case SYS_ASHR: {
            uint16_t bits = pop(vm);
            int16_t value = toSigned(pop(vm));
            push(vm, (uint16_t)((value >> bits) & 0xFFFF));
            break;
        }

        case SYS_FX_MUL: {
            uint16_t q = pop(vm);
            int16_t b = toSigned(pop(vm));
            int16_t a = toSigned(pop(vm));
            int32_t result = (int32_t)a * b;
            // Truncate toward zero (not floor) so small negative values decay to 0
            int32_t shifted = result >= 0 ? (result >> q) : -((-result) >> q);
            push(vm, (uint16_t)(shifted & 0xFFFF));
            break;
        }

        // --- Sprite engine syscalls ---

        case SYS_SPR_SET: {
            uint16_t edge   = pop(vm);
            int16_t  vy     = toSigned(pop(vm));
            int16_t  vx     = toSigned(pop(vm));
            uint16_t flags  = pop(vm);
            uint16_t y      = pop(vm);
            uint16_t x      = pop(vm);
            uint16_t height = pop(vm);
            uint16_t width  = pop(vm);
            uint16_t addr   = pop(vm);
            uint16_t slot   = pop(vm);
            if (slot < MAX_SPRITES) {
                Sprite& spr = ctx.sprites->sprites[slot];
                spr.active = true;
                spr.visible = true;
                spr.addr = addr;
                spr.width = (uint8_t)width;
                spr.height = (uint8_t)height;
                spr.x_fp = pixelToFp((int16_t)x);
                spr.y_fp = pixelToFp((int16_t)y);
                spr.vx = vx;
                spr.vy = vy;
                spr.flags = (uint8_t)flags;
                spr.edge = (uint8_t)edge;
            }
            break;
        }

        case SYS_SPR_POS: {
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                Sprite& spr = ctx.sprites->sprites[slot];
                spr.x_fp = pixelToFp((int16_t)x);
                spr.y_fp = pixelToFp((int16_t)y);
            }
            break;
        }

        case SYS_SPR_VEL: {
            int16_t vy = toSigned(pop(vm));
            int16_t vx = toSigned(pop(vm));
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                Sprite& spr = ctx.sprites->sprites[slot];
                spr.vx = vx;
                spr.vy = vy;
            }
            break;
        }

        case SYS_SPR_GET: {
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES && ctx.sprites->sprites[slot].active) {
                Sprite& spr = ctx.sprites->sprites[slot];
                push(vm, (uint16_t)(fpToPixel(spr.x_fp) & 0xFFFF));
                push(vm, (uint16_t)(fpToPixel(spr.y_fp) & 0xFFFF));
            } else {
                push(vm, 0);
                push(vm, 0);
            }
            break;
        }

        case SYS_SPR_OFF: {
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                ctx.sprites->sprites[slot].active = false;
            }
            break;
        }

        case SYS_SPR_EDGE: {
            uint16_t edge = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                ctx.sprites->sprites[slot].edge = (uint8_t)edge;
            }
            break;
        }

        case SYS_SPR_WALL: {
            uint16_t wallMode = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                ctx.sprites->sprites[slot].wallMode = (uint8_t)wallMode;
            }
            break;
        }

        case SYS_SPR_COLL: {
            uint16_t spriteMode = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                ctx.sprites->sprites[slot].spriteMode = (uint8_t)spriteMode;
            }
            break;
        }

        case SYS_WALL_SET: {
            uint16_t h = pop(vm);
            uint16_t w = pop(vm);
            uint16_t y = pop(vm);
            uint16_t x = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_WALLS) {
                Wall& wall = ctx.walls->walls[slot];
                wall.active = true;
                wall.x = (int16_t)x;
                wall.y = (int16_t)y;
                wall.width = (int16_t)w;
                wall.height = (int16_t)h;
            }
            break;
        }

        case SYS_WALL_OFF: {
            uint16_t slot = pop(vm);
            if (slot < MAX_WALLS) {
                ctx.walls->walls[slot].active = false;
            }
            break;
        }

        case SYS_SPR_HIT: {
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                Sprite& spr = ctx.sprites->sprites[slot];
                push(vm, (uint16_t)((spr.hitIndex << 8) | spr.hitFlags));
            } else {
                push(vm, 0);
            }
            break;
        }

        case SYS_SPR_GROUP: {
            uint16_t mask = pop(vm);
            uint16_t group = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                ctx.sprites->sprites[slot].collGroup = (uint8_t)(group & 0xFF);
                ctx.sprites->sprites[slot].collMask = (uint8_t)(mask & 0xFF);
            }
            break;
        }

        case SYS_SPR_ON_HIT: {
            uint16_t addr = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                ctx.sprites->sprites[slot].hitCallback = addr;
            }
            break;
        }

        case SYS_SPR_ROT: {
            int16_t rotSpeed = toSigned(pop(vm));
            uint16_t angle = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                ctx.sprites->sprites[slot].angle_fp = ((int32_t)(angle & 0xFF)) << FP_SHIFT;
                ctx.sprites->sprites[slot].rotSpeed = rotSpeed;
            }
            break;
        }

        case SYS_SPR_GETROT: {
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES && ctx.sprites->sprites[slot].active) {
                push(vm, (uint16_t)((ctx.sprites->sprites[slot].angle_fp >> FP_SHIFT) & 0xFF));
            } else {
                push(vm, 0);
            }
            break;
        }

        case SYS_SPR_VIS: {
            uint16_t visible = pop(vm);
            uint16_t slot = pop(vm);
            if (slot < MAX_SPRITES) {
                ctx.sprites->sprites[slot].visible = (visible != 0);
            }
            break;
        }

        // --- Particle syscalls ---

        case SYS_PFX_SET: {
            uint16_t flags  = pop(vm);
            int16_t  grav   = toSigned(pop(vm));
            uint16_t dir    = pop(vm);
            uint16_t spread = pop(vm);
            uint16_t life   = pop(vm);
            uint16_t speed  = pop(vm);
            uint16_t slot   = pop(vm);
            if (ctx.particles && slot < MAX_EMITTERS) {
                Emitter& e = ctx.particles->emitters[slot];
                e.speed     = (uint8_t)speed;
                e.life      = (uint8_t)life;
                e.spread    = (uint8_t)spread;
                e.direction = (uint8_t)dir;
                e.gravity   = (int8_t)grav;
                e.flags     = (uint8_t)flags;
            }
            break;
        }

        case SYS_PFX_POS: {
            uint16_t y    = pop(vm);
            uint16_t x    = pop(vm);
            uint16_t slot = pop(vm);
            if (ctx.particles && slot < MAX_EMITTERS) {
                ctx.particles->emitters[slot].x_fp = (int16_t)((int16_t)x << 8);
                ctx.particles->emitters[slot].y_fp = (int16_t)((int16_t)y << 8);
            }
            break;
        }

        case SYS_PFX_BURST: {
            uint16_t count = pop(vm);
            uint16_t slot  = pop(vm);
            if (ctx.particles) {
                burstParticles(*ctx.particles, (int)slot, (int)count, ctx.rngState);
            }
            break;
        }

        case SYS_PFX_ON: {
            uint16_t rate = pop(vm);
            uint16_t slot = pop(vm);
            if (ctx.particles && slot < MAX_EMITTERS) {
                Emitter& e = ctx.particles->emitters[slot];
                e.rate = (uint8_t)rate;
                if (rate > 0) {
                    e.flags |= EMITTER_ACTIVE;
                } else {
                    e.flags &= ~EMITTER_ACTIVE;
                }
            }
            break;
        }

        case SYS_PFX_CLEAR: {
            uint16_t slot = pop(vm);
            if (ctx.particles) {
                clearParticles(*ctx.particles, (int)slot);
            }
            break;
        }

        // --- Audio syscalls ---

        case SYS_VOICE: {
            // [voice, waveform, freq_hz, pulse_width]
            uint16_t pw   = pop(vm);
            uint16_t freq = pop(vm);
            uint16_t wave = pop(vm);
            uint16_t voice = pop(vm);
            if (ctx.audio.count < AUDIO_CMD_MAX) {
                AudioCmd& cmd = ctx.audio.cmds[ctx.audio.count++];
                cmd.id = SYS_VOICE;
                cmd.argCount = 4;
                cmd.args[0] = voice; cmd.args[1] = wave;
                cmd.args[2] = freq;  cmd.args[3] = pw;
            }
            break;
        }

        case SYS_ENVELOPE: {
            // [voice, attack, decay, sustain, release]
            uint16_t r = pop(vm);
            uint16_t s = pop(vm);
            uint16_t d = pop(vm);
            uint16_t a = pop(vm);
            uint16_t voice = pop(vm);
            if (ctx.audio.count < AUDIO_CMD_MAX) {
                AudioCmd& cmd = ctx.audio.cmds[ctx.audio.count++];
                cmd.id = SYS_ENVELOPE;
                cmd.argCount = 5;
                cmd.args[0] = voice; cmd.args[1] = a;
                cmd.args[2] = d;     cmd.args[3] = s;
                cmd.args[4] = r;
            }
            break;
        }

        case SYS_NOTE_OFF: {
            uint16_t voice = pop(vm);
            if (ctx.audio.count < AUDIO_CMD_MAX) {
                AudioCmd& cmd = ctx.audio.cmds[ctx.audio.count++];
                cmd.id = SYS_NOTE_OFF;
                cmd.argCount = 1;
                cmd.args[0] = voice;
            }
            break;
        }

        case SYS_FILTER: {
            // [cutoff, resonance, mode, routing]
            uint16_t routing = pop(vm);
            uint16_t mode    = pop(vm);
            uint16_t reso    = pop(vm);
            uint16_t cutoff  = pop(vm);
            if (ctx.audio.count < AUDIO_CMD_MAX) {
                AudioCmd& cmd = ctx.audio.cmds[ctx.audio.count++];
                cmd.id = SYS_FILTER;
                cmd.argCount = 4;
                cmd.args[0] = cutoff;  cmd.args[1] = reso;
                cmd.args[2] = mode;    cmd.args[3] = routing;
            }
            break;
        }

        case SYS_VOLUME: {
            uint16_t vol = pop(vm);
            if (ctx.audio.count < AUDIO_CMD_MAX) {
                AudioCmd& cmd = ctx.audio.cmds[ctx.audio.count++];
                cmd.id = SYS_VOLUME;
                cmd.argCount = 1;
                cmd.args[0] = vol;
            }
            break;
        }

        case SYS_TONE: {
            uint16_t dur  = pop(vm);
            uint16_t freq = pop(vm);
            if (ctx.audio.count < AUDIO_CMD_MAX) {
                AudioCmd& cmd = ctx.audio.cmds[ctx.audio.count++];
                cmd.id = SYS_TONE;
                cmd.argCount = 2;
                cmd.args[0] = freq; cmd.args[1] = dur;
            }
            break;
        }

        case SYS_SFX: {
            uint16_t effectId = pop(vm);
            if (ctx.audio.count < AUDIO_CMD_MAX) {
                AudioCmd& cmd = ctx.audio.cmds[ctx.audio.count++];
                cmd.id = SYS_SFX;
                cmd.argCount = 1;
                cmd.args[0] = effectId;
            }
            break;
        }

        default:
            // Unknown syscall — ignore
            break;
    }
}
