#include "sprites.h"
#include "display.h"
#include "sin_table.h"
#include "vm.h"
#include <cstring>
#include <cstdlib>

SpriteTable createSpriteTable() {
    SpriteTable table;
    resetSpriteTable(table);
    return table;
}

void resetSpriteTable(SpriteTable& table) {
    for (int i = 0; i < MAX_SPRITES; i++) {
        Sprite& s = table.sprites[i];
        s.active = false;
        s.addr = 0;
        s.width = 8;
        s.height = 8;
        s.x_fp = 0;
        s.y_fp = 0;
        s.vx = 0;
        s.vy = 0;
        s.flags = 0;
        s.edge = 0;
        s.wallMode = 0;
        s.spriteMode = 0;
        s.hitFlags = 0;
        s.hitIndex = 0;
        s.collGroup = 0xFF;
        s.collMask = 0xFF;
        s.hitCallback = 0;
        s.visible = true;
        s.angle_fp = 0;
        s.rotSpeed = 0;
    }
}

WallTable createWallTable() {
    WallTable table;
    resetWallTable(table);
    return table;
}

void resetWallTable(WallTable& table) {
    for (int i = 0; i < MAX_WALLS; i++) {
        Wall& w = table.walls[i];
        w.active = false;
        w.x = 0;
        w.y = 0;
        w.width = 0;
        w.height = 0;
    }
}

// --- AABB overlap test ---

static bool aabbOverlap(int32_t ax, int32_t ay, int32_t aw, int32_t ah,
                         int32_t bx, int32_t by, int32_t bw, int32_t bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// --- Collision response ---

static void applyCollisionMode(int mode, Sprite& spr,
                                int32_t overlapLeft, int32_t overlapRight,
                                int32_t overlapTop, int32_t overlapBottom) {
    if (mode == 1) return; // detect-only

    int32_t minX = (overlapLeft < overlapRight) ? overlapLeft : overlapRight;
    int32_t minY = (overlapTop < overlapBottom) ? overlapTop : overlapBottom;

    if (minX < minY) {
        // Resolve on X axis
        if (overlapLeft < overlapRight) {
            spr.x_fp -= overlapLeft;
        } else {
            spr.x_fp += overlapRight;
        }
        switch (mode) {
            case 2: spr.vx = -spr.vx; break;    // bounce
            case 3: spr.active = false; break;    // destroy
            case 4: spr.vx = 0; break;           // stop
        }
    } else {
        // Resolve on Y axis
        if (overlapTop < overlapBottom) {
            spr.y_fp -= overlapTop;
        } else {
            spr.y_fp += overlapBottom;
        }
        switch (mode) {
            case 2: spr.vy = -spr.vy; break;
            case 3: spr.active = false; break;
            case 4: spr.vy = 0; break;
        }
    }
}

// --- Edge behavior ---

static void applyEdgeBehavior(Sprite& spr) {
    int32_t sw = SCREEN_W << FP_SHIFT;
    int32_t sh = SCREEN_H << FP_SHIFT;

    switch (spr.edge) {
        case 1: { // wrap
            int32_t wfp = sw;
            int32_t hfp = sh;
            spr.x_fp = ((spr.x_fp % wfp) + wfp) % wfp;
            spr.y_fp = ((spr.y_fp % hfp) + hfp) % hfp;
            break;
        }

        case 2: { // bounce
            int32_t maxX = (SCREEN_W - spr.width) << FP_SHIFT;
            int32_t maxY = (SCREEN_H - spr.height) << FP_SHIFT;
            if (spr.x_fp <= 0) {
                spr.x_fp = 0;
                spr.vx = (spr.vx < 0) ? -spr.vx : spr.vx;
                spr.hitFlags |= 1;
            } else if (spr.x_fp >= maxX) {
                spr.x_fp = maxX;
                spr.vx = (spr.vx > 0) ? -spr.vx : spr.vx;
                spr.hitFlags |= 1;
            }
            if (spr.y_fp <= 0) {
                spr.y_fp = 0;
                spr.vy = (spr.vy < 0) ? -spr.vy : spr.vy;
                spr.hitFlags |= 1;
            } else if (spr.y_fp >= maxY) {
                spr.y_fp = maxY;
                spr.vy = (spr.vy > 0) ? -spr.vy : spr.vy;
                spr.hitFlags |= 1;
            }
            break;
        }

        case 3: { // destroy — when fully off-screen
            int32_t nw = -((int32_t)spr.width << FP_SHIFT);
            int32_t nh = -((int32_t)spr.height << FP_SHIFT);
            if (spr.x_fp <= nw || spr.x_fp >= sw ||
                spr.y_fp <= nh || spr.y_fp >= sh) {
                spr.active = false;
                spr.hitFlags |= 1;
            }
            break;
        }

        case 4: { // stop
            int32_t maxX = (SCREEN_W - spr.width) << FP_SHIFT;
            int32_t maxY = (SCREEN_H - spr.height) << FP_SHIFT;
            if (spr.x_fp <= 0) { spr.x_fp = 0; spr.vx = 0; spr.hitFlags |= 1; }
            else if (spr.x_fp >= maxX) { spr.x_fp = maxX; spr.vx = 0; spr.hitFlags |= 1; }
            if (spr.y_fp <= 0) { spr.y_fp = 0; spr.vy = 0; spr.hitFlags |= 1; }
            else if (spr.y_fp >= maxY) { spr.y_fp = maxY; spr.vy = 0; spr.hitFlags |= 1; }
            break;
        }
    }
}

// --- Bounding box for rotated sprite ---

struct BBox { int32_t x, y, w, h; };

static BBox sprBBox(const Sprite& spr) {
    int angle = (int)((spr.angle_fp >> FP_SHIFT) & 0xFF);
    int32_t px = spr.x_fp >> FP_SHIFT;
    int32_t py = spr.y_fp >> FP_SHIFT;

    if (angle == 0) {
        return { px, py, spr.width, spr.height };
    }

    // Center in sub-pixel coords
    int32_t cx256 = px * 256 + ((spr.width - 1) * 256) / 2;
    int32_t cy256 = py * 256 + ((spr.height - 1) * 256) / 2;
    int32_t hw = (spr.width * 256) >> 1;
    int32_t hh = (spr.height * 256) >> 1;
    int sinA = sin256(angle);
    int cosA = cos256(angle);

    int32_t minX = 0x7FFFFFFF, maxX = -0x7FFFFFFF;
    int32_t minY = 0x7FFFFFFF, maxY = -0x7FFFFFFF;
    int corners_x[2] = { (int)-hw, (int)hw };
    int corners_y[2] = { (int)-hh, (int)hh };
    for (int ci = 0; ci < 2; ci++) {
        for (int cj = 0; cj < 2; cj++) {
            // JS divides by 256*256 to get pixel offset from center
            int32_t dx256 = (int32_t)corners_x[ci] * cosA - (int32_t)corners_y[cj] * sinA;
            int32_t dy256 = (int32_t)corners_x[ci] * sinA + (int32_t)corners_y[cj] * cosA;
            // dx256 is scaled by 256*256; convert to pixel*256 by dividing by 256
            int32_t worldX = cx256 + (dx256 / 256);
            int32_t worldY = cy256 + (dy256 / 256);
            if (worldX < minX) minX = worldX;
            if (worldX > maxX) maxX = worldX;
            if (worldY < minY) minY = worldY;
            if (worldY > maxY) maxY = worldY;
        }
    }

    auto floorDiv256 = [](int32_t v) -> int32_t {
        if (v >= 0) return v >> 8;
        return -(((-v) + 255) >> 8);
    };
    auto ceilDiv256 = [](int32_t v) -> int32_t {
        if (v >= 0) return (v + 255) >> 8;
        return -((-v) >> 8);
    };

    int32_t bx = floorDiv256(minX);
    int32_t by = floorDiv256(minY);
    return { bx, by, ceilDiv256(maxX) - bx, ceilDiv256(maxY) - by };
}

// --- Vector sprite helpers ---

static int16_t decode44(uint8_t byte) {
    int8_t s = (byte >= 128) ? (int8_t)(byte - 256) : (int8_t)byte;
    return (int16_t)(s * 16);
}

// --- Pixel-perfect collision helpers ---

static bool spriteHasPixelAt(const Sprite& spr, const uint8_t* mem, int wx, int wy) {
    int angle = (int)((spr.angle_fp >> FP_SHIFT) & 0xFF);
    int bytesPerRow = (spr.width + 7) / 8;
    int32_t px = spr.x_fp >> FP_SHIFT;
    int32_t py = spr.y_fp >> FP_SHIFT;
    int srcX, srcY;

    if (angle == 0) {
        srcX = wx - (int)px;
        srcY = wy - (int)py;
    } else {
        int32_t cx256 = px * 256 + ((spr.width - 1) * 256) / 2;
        int32_t cy256 = py * 256 + ((spr.height - 1) * 256) / 2;
        int32_t offX = wx * 256 - cx256;
        int32_t offY = wy * 256 - cy256;
        int cosA = cos256(angle);
        int sinA = sin256(angle);
        int32_t sx = ((spr.width - 1) * 256) >> 1;
        int32_t sy = ((spr.height - 1) * 256) >> 1;
        int32_t srcX256 = ((int32_t)(offX * cosA + offY * sinA) + sx * 256) >> 8;
        int32_t srcY256 = ((int32_t)(-offX * sinA + offY * cosA) + sy * 256) >> 8;
        srcX = (int)((srcX256 + 128) >> 8);
        srcY = (int)((srcY256 + 128) >> 8);
    }

    if (srcX < 0 || srcX >= spr.width || srcY < 0 || srcY >= spr.height) return false;

    int byteIdx = srcY * bytesPerRow + (srcX >> 3);
    int bitOff = 7 - (srcX & 7);
    return ((mem[spr.addr + byteIdx] >> bitOff) & 1) != 0;
}

// --- Vector sprite collision rasterization ---

static const int VEC_BUF_SIZE = 128;  // 4.4 endpoints cap sprites at ~23x23 rotated
static uint8_t vecBufA[VEC_BUF_SIZE];
static uint8_t vecBufB[VEC_BUF_SIZE];

// Bresenham's line drawing into a packed-bit buffer (with clipping)
static void drawLineToBuffer(uint8_t* buf, int bufW, int bufH,
                             int x0, int y0, int x1, int y1) {
    int dx = abs(x1 - x0);
    int dy = -abs(y1 - y0);
    int sx = (x0 < x1) ? 1 : -1;
    int sy = (y0 < y1) ? 1 : -1;
    int err = dx + dy;
    int bytesPerRow = (bufW + 7) / 8;

    for (;;) {
        if (x0 >= 0 && x0 < bufW && y0 >= 0 && y0 < bufH) {
            int byteIdx = y0 * bytesPerRow + (x0 >> 3);
            int bitOff = 7 - (x0 & 7);
            buf[byteIdx] |= (1 << bitOff);
        }
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

// Rasterize vector sprite lines into scratch buffer using BBox local coords.
// Returns false if the BBox exceeds the scratch buffer size.
static bool rasterizeVectorSprite(const Sprite& spr, const uint8_t* mem,
                                  uint8_t* buf, const BBox& bb) {
    int bytesPerRow = (bb.w + 7) / 8;
    int bufBytes = bytesPerRow * bb.h;
    if (bufBytes <= 0 || bufBytes > VEC_BUF_SIZE) return false;
    memset(buf, 0, bufBytes);

    uint8_t n = mem[spr.addr];
    int angle = (int)((spr.angle_fp >> FP_SHIFT) & 0xFF);
    int cosA = cos256(angle);
    int sinA = sin256(angle);
    int cx = (int)(spr.x_fp >> FP_SHIFT) + (spr.width >> 1);
    int cy = (int)(spr.y_fp >> FP_SHIFT) + (spr.height >> 1);

    for (int i = 0; i < n; i++) {
        int base = spr.addr + 1 + i * 4;
        int16_t rx1 = decode44(mem[base]);
        int16_t ry1 = decode44(mem[base + 1]);
        int16_t rx2 = decode44(mem[base + 2]);
        int16_t ry2 = decode44(mem[base + 3]);

        int sx1 = cx + ((rx1 * cosA - ry1 * sinA) >> 16);
        int sy1 = cy + ((rx1 * sinA + ry1 * cosA) >> 16);
        int sx2 = cx + ((rx2 * cosA - ry2 * sinA) >> 16);
        int sy2 = cy + ((rx2 * sinA + ry2 * cosA) >> 16);

        drawLineToBuffer(buf, bb.w, bb.h,
                         sx1 - (int)bb.x, sy1 - (int)bb.y,
                         sx2 - (int)bb.x, sy2 - (int)bb.y);
    }

    // Scanline fill: for each row, fill between leftmost and rightmost outline
    // pixel. This makes collision test the filled shape, not just the wireframe.
    for (int row = 0; row < bb.h; row++) {
        int rowOff = row * bytesPerRow;
        int minX = -1, maxX = -1;
        for (int col = 0; col < bb.w; col++) {
            int byteIdx = rowOff + (col >> 3);
            int bitOff = 7 - (col & 7);
            if ((buf[byteIdx] >> bitOff) & 1) {
                if (minX < 0) minX = col;
                maxX = col;
            }
        }
        if (minX >= 0 && maxX > minX) {
            for (int col = minX; col <= maxX; col++) {
                int byteIdx = rowOff + (col >> 3);
                int bitOff = 7 - (col & 7);
                buf[byteIdx] |= (1 << bitOff);
            }
        }
    }

    return true;
}

// Direct bit lookup in rasterized buffer (rotation already baked in)
static bool bufHasPixelAt(const uint8_t* buf, int w, int h, int lx, int ly) {
    if (lx < 0 || lx >= w || ly < 0 || ly >= h) return false;
    int bytesPerRow = (w + 7) / 8;
    int byteIdx = ly * bytesPerRow + (lx >> 3);
    int bitOff = 7 - (lx & 7);
    return ((buf[byteIdx] >> bitOff) & 1) != 0;
}

static bool pixelOverlap(const Sprite& a, const Sprite& b, const uint8_t* mem) {
    BBox ba = sprBBox(a);
    BBox bb = sprBBox(b);

    int32_t ix0 = (ba.x > bb.x) ? ba.x : bb.x;
    int32_t iy0 = (ba.y > bb.y) ? ba.y : bb.y;
    int32_t ix1 = ((ba.x + ba.w) < (bb.x + bb.w)) ? (ba.x + ba.w) : (bb.x + bb.w);
    int32_t iy1 = ((ba.y + ba.h) < (bb.y + bb.h)) ? (ba.y + ba.h) : (bb.y + bb.h);

    if (ix0 >= ix1 || iy0 >= iy1) return false;

    bool aVec = (a.flags & 4) != 0;
    bool bVec = (b.flags & 4) != 0;

    // Rasterize vector sprites to scratch buffers.
    // If buffer overflows (huge sprite), conservatively assume collision.
    if (aVec && !rasterizeVectorSprite(a, mem, vecBufA, ba)) return true;
    if (bVec && !rasterizeVectorSprite(b, mem, vecBufB, bb)) return true;

    for (int32_t py = iy0; py < iy1; py++) {
        for (int32_t px = ix0; px < ix1; px++) {
            bool aHit;
            if (aVec) {
                aHit = bufHasPixelAt(vecBufA, ba.w, ba.h,
                                     (int)(px - ba.x), (int)(py - ba.y));
            } else {
                aHit = spriteHasPixelAt(a, mem, (int)px, (int)py);
            }
            if (!aHit) continue;

            bool bHit;
            if (bVec) {
                bHit = bufHasPixelAt(vecBufB, bb.w, bb.h,
                                     (int)(px - bb.x), (int)(py - bb.y));
            } else {
                bHit = spriteHasPixelAt(b, mem, (int)px, (int)py);
            }
            if (bHit) return true;
        }
    }
    return false;
}

static void drawVectorSprite(Framebuffer& fb, const Sprite& spr, const uint8_t* mem) {
    uint8_t n = mem[spr.addr];
    int angle = (int)((spr.angle_fp >> FP_SHIFT) & 0xFF);
    int cosA = cos256(angle);
    int sinA = sin256(angle);
    int cx = (int)(spr.x_fp >> FP_SHIFT) + (spr.width >> 1);
    int cy = (int)(spr.y_fp >> FP_SHIFT) + (spr.height >> 1);

    for (int i = 0; i < n; i++) {
        int base = spr.addr + 1 + i * 4;
        int16_t rx1 = decode44(mem[base]);
        int16_t ry1 = decode44(mem[base + 1]);
        int16_t rx2 = decode44(mem[base + 2]);
        int16_t ry2 = decode44(mem[base + 3]);

        int sx1 = cx + ((rx1 * cosA - ry1 * sinA) >> 16);
        int sy1 = cy + ((rx1 * sinA + ry1 * cosA) >> 16);
        int sx2 = cx + ((rx2 * cosA - ry2 * sinA) >> 16);
        int sy2 = cy + ((rx2 * sinA + ry2 * cosA) >> 16);

        drawLine(fb, sx1, sy1, sx2, sy2);
    }
}

// --- Main update function ---

void updateSprites(SpriteTable& table, WallTable& walls, int32_t scale_fp, uint8_t* mem) {
    // scale_fp is the time-scale factor in 24.8 fixed-point.
    // At normal speed (one frame at 60fps): scale_fp = FP_SCALE (256) = 1.0x
    // The caller (runtime) computes: scale = dt * TARGET_FPS in 24.8

    // Phase 1: Clear hit state, apply velocity
    for (int i = 0; i < MAX_SPRITES; i++) {
        Sprite& spr = table.sprites[i];
        if (!spr.active) continue;
        spr.hitFlags = 0;
        spr.hitIndex = 0;

        // x_fp += (vx / VEL_DIVISOR) * scale
        spr.x_fp += ((int32_t)spr.vx * scale_fp) / VEL_DIVISOR;
        spr.y_fp += ((int32_t)spr.vy * scale_fp) / VEL_DIVISOR;

        // Rotation: angle_fp += (rotSpeed / VEL_DIVISOR) * scale
        spr.angle_fp += ((int32_t)spr.rotSpeed * scale_fp) / VEL_DIVISOR;
        // Normalize angle to 0-255 range (in fixed-point: 0 to 255<<8)
        int32_t fullCircle = 256 << FP_SHIFT;
        spr.angle_fp = ((spr.angle_fp % fullCircle) + fullCircle) % fullCircle;
    }

    // Phase 2: Wall collisions
    for (int i = 0; i < MAX_SPRITES; i++) {
        Sprite& spr = table.sprites[i];
        if (!spr.active || spr.wallMode == 0) continue;

        int32_t sx = spr.x_fp >> FP_SHIFT;
        int32_t sy = spr.y_fp >> FP_SHIFT;

        for (int wi = 0; wi < MAX_WALLS; wi++) {
            Wall& wall = walls.walls[wi];
            if (!wall.active) continue;

            if (!aabbOverlap(sx, sy, spr.width, spr.height,
                             wall.x, wall.y, wall.width, wall.height)) continue;

            // Compute overlaps in fixed-point for accurate correction
            int32_t wallX_fp = (int32_t)wall.x << FP_SHIFT;
            int32_t wallY_fp = (int32_t)wall.y << FP_SHIFT;
            int32_t wallW_fp = (int32_t)wall.width << FP_SHIFT;
            int32_t wallH_fp = (int32_t)wall.height << FP_SHIFT;
            int32_t sprW_fp = (int32_t)spr.width << FP_SHIFT;
            int32_t sprH_fp = (int32_t)spr.height << FP_SHIFT;

            int32_t overlapLeft  = (spr.x_fp + sprW_fp) - wallX_fp;
            int32_t overlapRight = (wallX_fp + wallW_fp) - spr.x_fp;
            int32_t overlapTop   = (spr.y_fp + sprH_fp) - wallY_fp;
            int32_t overlapBottom= (wallY_fp + wallH_fp) - spr.y_fp;

            applyCollisionMode(spr.wallMode, spr, overlapLeft, overlapRight, overlapTop, overlapBottom);
            spr.hitFlags |= 2;
            spr.hitIndex = (uint8_t)wi;
            if (!spr.active) break;

            // Recompute pixel position after correction
            sx = spr.x_fp >> FP_SHIFT;
            sy = spr.y_fp >> FP_SHIFT;
        }
    }

    // Phase 3: Sprite-sprite collisions
    for (int i = 0; i < MAX_SPRITES; i++) {
        Sprite& a = table.sprites[i];
        if (!a.active) continue;

        for (int j = i + 1; j < MAX_SPRITES; j++) {
            Sprite& b = table.sprites[j];
            if (!b.active) continue;
            if (a.spriteMode == 0 && b.spriteMode == 0) continue;
            if (!(a.collGroup & b.collMask) && !(b.collGroup & a.collMask)) continue;

            int32_t ax = a.x_fp >> FP_SHIFT;
            int32_t ay = a.y_fp >> FP_SHIFT;
            int32_t bx = b.x_fp >> FP_SHIFT;
            int32_t by = b.y_fp >> FP_SHIFT;

            bool aRot = ((a.angle_fp >> FP_SHIFT) & 0xFF) != 0;
            bool bRot = ((b.angle_fp >> FP_SHIFT) & 0xFF) != 0;
            bool aVec = (a.flags & 4) != 0;
            bool bVec = (b.flags & 4) != 0;

            if (aRot || bRot || aVec || bVec) {
                BBox ba = sprBBox(a);
                BBox bb = sprBBox(b);
                if (!aabbOverlap(ba.x, ba.y, ba.w, ba.h, bb.x, bb.y, bb.w, bb.h)) continue;
                if (mem && !pixelOverlap(a, b, mem)) continue;
            } else {
                if (!aabbOverlap(ax, ay, a.width, a.height,
                                 bx, by, b.width, b.height)) continue;
            }

            // Compute overlaps in fixed-point
            int32_t aW_fp = (int32_t)a.width << FP_SHIFT;
            int32_t aH_fp = (int32_t)a.height << FP_SHIFT;
            int32_t bW_fp = (int32_t)b.width << FP_SHIFT;
            int32_t bH_fp = (int32_t)b.height << FP_SHIFT;

            int32_t overlapLeft  = (a.x_fp + aW_fp) - b.x_fp;
            int32_t overlapRight = (b.x_fp + bW_fp) - a.x_fp;
            int32_t overlapTop   = (a.y_fp + aH_fp) - b.y_fp;
            int32_t overlapBottom= (b.y_fp + bH_fp) - a.y_fp;

            if (a.spriteMode != 0) {
                applyCollisionMode(a.spriteMode, a, overlapLeft, overlapRight, overlapTop, overlapBottom);
                a.hitFlags |= 4;
                a.hitIndex = (uint8_t)j;
            }
            if (b.spriteMode != 0) {
                applyCollisionMode(b.spriteMode, b, overlapRight, overlapLeft, overlapBottom, overlapTop);
                b.hitFlags |= 4;
                b.hitIndex = (uint8_t)i;
            }
        }
    }

    // Phase 4: Screen edge behavior
    for (int i = 0; i < MAX_SPRITES; i++) {
        Sprite& spr = table.sprites[i];
        if (!spr.active) continue;
        applyEdgeBehavior(spr);
    }
}

void runHitCallbacks(SpriteTable& table, VMState& vm, SyscallHandler handler, void* ctx) {
    uint16_t savedPC = vm.pc;
    for (int i = 0; i < MAX_SPRITES; i++) {
        Sprite& spr = table.sprites[i];
        if (spr.hitFlags == 0 || spr.hitCallback == 0) continue;

        push(vm, (uint16_t)i);
        push(vm, savedPC);
        vm.pc = spr.hitCallback;

        int budget = CALLBACK_CYCLE_BUDGET;
        while (budget > 0 && vm.pc != savedPC && !vm.halted) {
            step(vm, handler, ctx);
            budget--;
        }
        if (budget == 0 && vm.pc != savedPC) {
            vm.pc = savedPC;
        }
    }
}

void drawSprites(const SpriteTable& table, const uint8_t* mem, Framebuffer& fb) {
    for (int i = 0; i < MAX_SPRITES; i++) {
        const Sprite& spr = table.sprites[i];
        if (!spr.active || !spr.visible) continue;

        if (spr.flags & 4) {
            drawVectorSprite(fb, spr, mem);
            continue;
        }

        // Use sprite data directly from memory (no copy needed)
        int px = (int)(spr.x_fp >> FP_SHIFT);
        int py = (int)(spr.y_fp >> FP_SHIFT);
        int angle = (int)((spr.angle_fp >> FP_SHIFT) & 0xFF);

        drawSpriteRotated(fb, mem + spr.addr, px, py, spr.flags, spr.width, spr.height, angle);
    }
}
