#include "display.h"
#include "sin_table.h"
#include <cstdlib>

Framebuffer createFramebuffer() {
    Framebuffer fb;
    memset(fb.buf, 0, sizeof(fb.buf));
    fb.back = 0;
    return fb;
}

void clearFB(Framebuffer& fb) {
    memset(fb.buf[fb.back], 0, FB_BYTES);
}

static inline int getPixelRaw(const uint8_t* data, int x, int y) {
    if (x < 0 || x >= SCREEN_W || y < 0 || y >= SCREEN_H) return 0;
    int bitIndex = y * SCREEN_W + x;
    int byteIndex = bitIndex >> 3;
    int bitOffset = 7 - (bitIndex & 7);
    return (data[byteIndex] >> bitOffset) & 1;
}

int getPixel(const Framebuffer& fb, int x, int y) {
    return getPixelRaw(fb.buf[fb.back], x, y);
}

int getPixelFront(const Framebuffer& fb, int x, int y) {
    return getPixelRaw(fb.buf[fb.back ^ 1], x, y);
}

void setPixel(Framebuffer& fb, int x, int y, int color) {
    if (x < 0 || x >= SCREEN_W || y < 0 || y >= SCREEN_H) return;
    int bitIndex = y * SCREEN_W + x;
    int byteIndex = bitIndex >> 3;
    int bitOffset = 7 - (bitIndex & 7);
    if (color) {
        fb.buf[fb.back][byteIndex] |= (1 << bitOffset);
    } else {
        fb.buf[fb.back][byteIndex] &= ~(1 << bitOffset);
    }
}

void drawLine(Framebuffer& fb, int x0, int y0, int x1, int y1, int color) {
    int dx = abs(x1 - x0);
    int dy = -abs(y1 - y0);
    int sx = (x0 < x1) ? 1 : -1;
    int sy = (y0 < y1) ? 1 : -1;
    int err = dx + dy;

    for (;;) {
        setPixel(fb, x0, y0, color);
        if (x0 == x1 && y0 == y1) break;
        int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

void drawRect(Framebuffer& fb, int x, int y, int w, int h, int color) {
    for (int row = y; row < y + h; row++) {
        for (int col = x; col < x + w; col++) {
            setPixel(fb, col, row, color);
        }
    }
}

void drawSprite(Framebuffer& fb, const uint8_t* spriteData, int x, int y, uint8_t flags, int width, int height) {
    bool flipX = (flags & 1) != 0;
    bool flipY = (flags & 2) != 0;
    int bytesPerRow = (width + 7) / 8;
    for (int row = 0; row < height; row++) {
        int srcRow = flipY ? (height - 1 - row) : row;
        for (int col = 0; col < width; col++) {
            int srcCol = flipX ? (width - 1 - col) : col;
            int byteIdx = srcRow * bytesPerRow + (srcCol >> 3);
            int bitOff = 7 - (srcCol & 7);
            int bit = (spriteData[byteIdx] >> bitOff) & 1;
            if (bit) {
                setPixel(fb, x + col, y + row, 1);
            }
        }
    }
}

void drawSpriteRotated(Framebuffer& fb, const uint8_t* spriteData, int x, int y, uint8_t flags, int width, int height, int angle) {
    // Fast path: no rotation
    if ((angle & 0xFF) == 0) {
        drawSprite(fb, spriteData, x, y, flags, width, height);
        return;
    }

    bool flipX = (flags & 1) != 0;
    bool flipY = (flags & 2) != 0;
    int bytesPerRow = (width + 7) / 8;

    int cx = ((width - 1) * 256) >> 1;
    int cy = ((height - 1) * 256) >> 1;

    int sinA = sin256(angle);
    int cosA = cos256(angle);

    // Compute rotated bounding box
    int halfW = (width * 256) >> 1;
    int halfH = (height * 256) >> 1;
    int minDx = 0x7FFFFFFF, maxDx = -0x7FFFFFFF;
    int minDy = 0x7FFFFFFF, maxDy = -0x7FFFFFFF;

    int corners_x[2] = { -halfW, halfW };
    int corners_y[2] = { -halfH, halfH };
    for (int ci = 0; ci < 2; ci++) {
        for (int cj = 0; cj < 2; cj++) {
            int ox = corners_x[ci];
            int oy = corners_y[cj];
            int dx = (ox * cosA - oy * sinA) >> 8;
            int dy = (ox * sinA + oy * cosA) >> 8;
            if (dx < minDx) minDx = dx;
            if (dx > maxDx) maxDx = dx;
            if (dy < minDy) minDy = dy;
            if (dy > maxDy) maxDy = dy;
        }
    }

    // dstCx, dstCy in pixel coords (matching JS: x + (width-1)/2)
    // We use fixed-point for precision here
    int dstCx_256 = x * 256 + ((width - 1) * 256) / 2;
    int dstCy_256 = y * 256 + ((height - 1) * 256) / 2;

    // Scan range in pixel coordinates
    int startX = (dstCx_256 + minDx) >> 8;
    if ((dstCx_256 + minDx) < 0 && ((dstCx_256 + minDx) & 0xFF)) startX--;
    int endX   = ((dstCx_256 + maxDx) + 255) >> 8;
    int startY = (dstCx_256 + minDy) < 0 ? (dstCy_256 + minDy - 255) >> 8 : (dstCy_256 + minDy) >> 8;
    int endY   = ((dstCy_256 + maxDy) + 255) >> 8;

    // Recalculate more carefully, matching JS Math.floor/Math.ceil
    // JS: dstCx = x + (width-1)/2.0  (floating point)
    // JS: startX = Math.floor(dstCx + minDx/256)
    // JS: endX = Math.ceil(dstCx + maxDx/256)
    // We need to match this precisely.
    // dstCx*256 = x*256 + (width-1)*128
    // startX = floor((dstCx*256 + minDx) / 256)
    // endX = ceil((dstCx*256 + maxDx) / 256)

    auto floorDiv256 = [](int v) -> int {
        if (v >= 0) return v >> 8;
        return -(((-v) + 255) >> 8);
    };
    auto ceilDiv256 = [](int v) -> int {
        if (v >= 0) return (v + 255) >> 8;
        return -((-v) >> 8);
    };

    startX = floorDiv256(dstCx_256 + minDx);
    endX   = ceilDiv256(dstCx_256 + maxDx);
    startY = floorDiv256(dstCy_256 + minDy);
    endY   = ceilDiv256(dstCy_256 + maxDy);

    for (int dy = startY; dy <= endY; dy++) {
        for (int dx = startX; dx <= endX; dx++) {
            int offX = (dx * 256 - dstCx_256);
            int offY = (dy * 256 - dstCy_256);

            int srcX256 = (offX * cosA + offY * sinA + cx * 256) >> 8;
            int srcY256 = (-offX * sinA + offY * cosA + cy * 256) >> 8;

            int srcX = (srcX256 + 128) >> 8;
            int srcY = (srcY256 + 128) >> 8;

            if (srcX < 0 || srcX >= width || srcY < 0 || srcY >= height) continue;

            int sampX = flipX ? (width - 1 - srcX) : srcX;
            int sampY = flipY ? (height - 1 - srcY) : srcY;

            int byteIdx = sampY * bytesPerRow + (sampX >> 3);
            int bitOff = 7 - (sampX & 7);
            int bit = (spriteData[byteIdx] >> bitOff) & 1;
            if (bit) {
                setPixel(fb, dx, dy, 1);
            }
        }
    }
}

void blit(Framebuffer& fb, const uint8_t* srcData, int x, int y, int w, int h) {
    int bytesPerRow = (w + 7) / 8;
    for (int row = 0; row < h; row++) {
        for (int col = 0; col < w; col++) {
            int byteIdx = row * bytesPerRow + (col >> 3);
            int bitOff = 7 - (col & 7);
            int bit = (srcData[byteIdx] >> bitOff) & 1;
            if (bit) {
                setPixel(fb, x + col, y + row, 1);
            }
        }
    }
}

void swapBuffers(Framebuffer& fb) {
    fb.back ^= 1;
}
