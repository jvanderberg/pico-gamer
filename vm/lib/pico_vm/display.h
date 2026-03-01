#pragma once
#include <cstdint>
#include <cstring>

static const int SCREEN_W = 128;
static const int SCREEN_H = 64;
static const int FB_BYTES = (SCREEN_W * SCREEN_H) / 8; // 1024

struct Framebuffer {
    uint8_t buf[2][FB_BYTES];
    uint8_t back; // index of draw target (0 or 1)
};

Framebuffer createFramebuffer();
void    clearFB(Framebuffer& fb);
int     getPixel(const Framebuffer& fb, int x, int y);
void    setPixel(Framebuffer& fb, int x, int y, int color);
void    drawLine(Framebuffer& fb, int x0, int y0, int x1, int y1, int color = 1);
void    drawRect(Framebuffer& fb, int x, int y, int w, int h, int color = 1);
void    drawSprite(Framebuffer& fb, const uint8_t* spriteData, int x, int y, uint8_t flags, int width = 8, int height = 8);
void    drawSpriteRotated(Framebuffer& fb, const uint8_t* spriteData, int x, int y, uint8_t flags, int width, int height, int angle);
void    blit(Framebuffer& fb, const uint8_t* srcData, int x, int y, int w, int h);
void    swapBuffers(Framebuffer& fb);

// Read from front buffer (for test assertions and display output)
int     getPixelFront(const Framebuffer& fb, int x, int y);

// Direct access helpers
inline uint8_t* backBuf(Framebuffer& fb) { return fb.buf[fb.back]; }
inline const uint8_t* frontBuf(const Framebuffer& fb) { return fb.buf[fb.back ^ 1]; }
