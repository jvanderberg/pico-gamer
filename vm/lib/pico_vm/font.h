#pragma once
#include <cstdint>

struct Framebuffer; // forward decl

// 3x5 bitmap font — 1 byte per row, top 3 bits used, 5 bytes per glyph.
// Covers printable ASCII 32-126 (95 entries). Unsupported chars are blank.
extern const uint8_t FONT_SM[95 * 5];

// 5x7 bitmap font — 1 byte per row, top 5 bits used, 7 bytes per glyph.
extern const uint8_t FONT_LG[95 * 7];

void drawText(Framebuffer& fb, const char* str, int x, int y,
              const uint8_t* fontData, int glyphW, int glyphH, int advance);
