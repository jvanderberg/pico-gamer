#include "syscalls.h"
#include "vm.h"
#include "display.h"
#include "font.h"
#include "sprites.h"
#include "sin_table.h"
#include "memory.h"
#include <cstdio>
#include <cstring>

SyscallContext createSyscallContext(Framebuffer* fb, SpriteTable* sprites, WallTable* walls) {
    SyscallContext ctx;
    ctx.fb = fb;
    ctx.sprites = sprites;
    ctx.walls = walls;
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
            push(vm, (uint16_t)(((int32_t)a * b) >> q) & 0xFFFF);
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

        default:
            // Audio range: 0x30-0x3F — silent NOPs
            if (id >= 0x30 && id <= 0x3F) {
                break;
            }
            // Unknown syscall — ignore
            break;
    }
}
