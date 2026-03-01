import { describe, it, expect } from "vitest";
import {
  createFramebuffer,
  getPixel,
  SCREEN_W,
  SCREEN_H,
} from "../src/display/display.ts";
import { drawText, FONT_SM, FONT_LG } from "../src/display/font.ts";
import { createHarness } from "../src/test-harness.ts";

// ---------------------------------------------------------------------------
// Direct drawText tests
// ---------------------------------------------------------------------------

describe("FONT_SM (3x5)", () => {
  it("renders 'A' with correct pixel pattern", () => {
    const fb = createFramebuffer();
    drawText(fb, "A", 0, 0, FONT_SM, 3, 5, 4);
    // A in 3x5:
    // .#.  row 0
    // #.#  row 1
    // ###  row 2
    // #.#  row 3
    // #.#  row 4
    expect(getPixel(fb, 0, 0)).toBe(0);
    expect(getPixel(fb, 1, 0)).toBe(1);
    expect(getPixel(fb, 2, 0)).toBe(0);

    expect(getPixel(fb, 0, 1)).toBe(1);
    expect(getPixel(fb, 1, 1)).toBe(0);
    expect(getPixel(fb, 2, 1)).toBe(1);

    expect(getPixel(fb, 0, 2)).toBe(1);
    expect(getPixel(fb, 1, 2)).toBe(1);
    expect(getPixel(fb, 2, 2)).toBe(1);

    expect(getPixel(fb, 0, 3)).toBe(1);
    expect(getPixel(fb, 1, 3)).toBe(0);
    expect(getPixel(fb, 2, 3)).toBe(1);
  });

  it("renders '0' with correct pixel pattern", () => {
    const fb = createFramebuffer();
    drawText(fb, "0", 0, 0, FONT_SM, 3, 5, 4);
    // 0 in 3x5:
    // ###  row 0
    // #.#  row 1
    // #.#  row 2
    // #.#  row 3
    // ###  row 4
    expect(getPixel(fb, 0, 0)).toBe(1);
    expect(getPixel(fb, 1, 0)).toBe(1);
    expect(getPixel(fb, 2, 0)).toBe(1);

    expect(getPixel(fb, 1, 1)).toBe(0); // hollow center
    expect(getPixel(fb, 1, 2)).toBe(0);
    expect(getPixel(fb, 1, 3)).toBe(0);

    expect(getPixel(fb, 0, 4)).toBe(1);
    expect(getPixel(fb, 1, 4)).toBe(1);
    expect(getPixel(fb, 2, 4)).toBe(1);
  });

  it("advances characters by 4px", () => {
    const fb = createFramebuffer();
    drawText(fb, "AB", 0, 0, FONT_SM, 3, 5, 4);
    // 'A' at x=0, 'B' at x=4
    // B row 0: ##. → pixels at (4,0) and (5,0) on, (6,0) off
    expect(getPixel(fb, 4, 0)).toBe(1);
    expect(getPixel(fb, 5, 0)).toBe(1);
    expect(getPixel(fb, 6, 0)).toBe(0);
  });

  it("space advances without setting pixels", () => {
    const fb = createFramebuffer();
    drawText(fb, " A", 0, 0, FONT_SM, 3, 5, 4);
    // Space at x=0 (blank), 'A' at x=4
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        expect(getPixel(fb, col, row)).toBe(0);
      }
    }
    // 'A' top center at (5, 0)
    expect(getPixel(fb, 5, 0)).toBe(1);
  });

  it("unsupported characters render as blank", () => {
    const fb = createFramebuffer();
    drawText(fb, "~", 0, 0, FONT_SM, 3, 5, 4);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        expect(getPixel(fb, col, row)).toBe(0);
      }
    }
  });
});

describe("FONT_LG (5x7)", () => {
  it("renders 'A' with correct pixel pattern", () => {
    const fb = createFramebuffer();
    drawText(fb, "A", 0, 0, FONT_LG, 5, 7, 6);
    // A in 5x7:
    // ..#..  row 0
    // .#.#.  row 1
    // #...#  row 2
    // #...#  row 3
    // #####  row 4
    // #...#  row 5
    // #...#  row 6
    expect(getPixel(fb, 2, 0)).toBe(1); // top peak
    expect(getPixel(fb, 0, 0)).toBe(0);
    expect(getPixel(fb, 4, 0)).toBe(0);

    expect(getPixel(fb, 1, 1)).toBe(1); // row 1 left
    expect(getPixel(fb, 3, 1)).toBe(1); // row 1 right
    expect(getPixel(fb, 2, 1)).toBe(0); // row 1 center gap

    // row 4 all on
    for (let col = 0; col < 5; col++) {
      expect(getPixel(fb, col, 4)).toBe(1);
    }
  });

  it("renders '1' correctly", () => {
    const fb = createFramebuffer();
    drawText(fb, "1", 0, 0, FONT_LG, 5, 7, 6);
    // 1 in 5x7:
    // ..#..  row 0
    // .##..  row 1
    // ..#..  rows 2-5
    // .###.  row 6
    expect(getPixel(fb, 2, 0)).toBe(1);
    expect(getPixel(fb, 1, 1)).toBe(1);
    expect(getPixel(fb, 2, 1)).toBe(1);
    expect(getPixel(fb, 2, 3)).toBe(1);
    expect(getPixel(fb, 0, 3)).toBe(0); // stem only 1px wide
  });

  it("advances characters by 6px", () => {
    const fb = createFramebuffer();
    drawText(fb, "HI", 0, 0, FONT_LG, 5, 7, 6);
    // 'H' at x=0, 'I' at x=6
    // I row 0: .###. → pixel at (7,0) on
    expect(getPixel(fb, 7, 0)).toBe(1);
    expect(getPixel(fb, 8, 0)).toBe(1);
    expect(getPixel(fb, 6, 0)).toBe(0); // I starts with .###.
  });
});

describe("drawText clipping", () => {
  it("clips text that extends past the right edge", () => {
    const fb = createFramebuffer();
    // Draw at x=126 — only 2 columns visible for a 3-wide glyph
    drawText(fb, "A", 126, 0, FONT_SM, 3, 5, 4);
    // Should not crash; pixel at x=128 is silently clipped
    expect(getPixel(fb, 126, 0)).toBe(0); // A row 0 col 0 is off (.#.)
    expect(getPixel(fb, 127, 0)).toBe(1); // A row 0 col 1 is on
    // x=128 would be col 2 — clipped, no crash
  });

  it("clips text that extends past the bottom edge", () => {
    const fb = createFramebuffer();
    drawText(fb, "A", 0, 62, FONT_SM, 3, 5, 4);
    // Only rows 0-1 of the glyph are visible (y=62, y=63)
    expect(getPixel(fb, 1, 62)).toBe(1); // A row 0 center
    expect(getPixel(fb, 0, 63)).toBe(1); // A row 1 left
    // rows 2-4 at y=64+ are clipped
  });

  it("handles negative x (partially off-screen left)", () => {
    const fb = createFramebuffer();
    drawText(fb, "A", -1, 0, FONT_SM, 3, 5, 4);
    // col 0 at x=-1 clipped, col 1 at x=0 visible, col 2 at x=1 visible
    expect(getPixel(fb, 0, 0)).toBe(1); // A row 0: .#. → col 1 at x=0
    expect(getPixel(fb, 1, 0)).toBe(0); // col 2 at x=1 → off
  });
});

// ---------------------------------------------------------------------------
// Syscall integration tests via harness
// ---------------------------------------------------------------------------

describe("TEXT_SM syscall (0x24)", () => {
  it("renders a null-terminated string from VM memory", () => {
    const h = createHarness();
    h.load([
      "JMP start",
      "msg:",
      ".data 0x48, 0x49, 0x00", // "HI\0"
      "start:",
      "  PUSH16 msg",   // strAddr
      "  PUSH8 10",     // x
      "  PUSH8 5",      // y
      "  SYSCALL 0x24",
      "  SYSCALL 0x06",
      "loop:",
      "JMP loop",
    ].join("\n"));
    h.frames(1);

    // 'H' at (10,5): row 0 col 0 is on (#.# pattern)
    expect(h.pixel(10, 5)).toBe(1);
    expect(h.pixel(12, 5)).toBe(1);
    expect(h.pixel(11, 5)).toBe(0);
    // 'I' at (14,5): row 0 is ### → all 3 on
    expect(h.pixel(14, 5)).toBe(1);
    expect(h.pixel(15, 5)).toBe(1);
    expect(h.pixel(16, 5)).toBe(1);
  });

  it("stops at null terminator", () => {
    const h = createHarness();
    h.load([
      "JMP start",
      // "A\0B" — should only render A
      "msg:",
      ".data 0x41, 0x00, 0x42",
      "start:",
      "  PUSH16 msg",
      "  PUSH8 0",
      "  PUSH8 0",
      "  SYSCALL 0x24",
      "  SYSCALL 0x06",
      "loop:",
      "JMP loop",
    ].join("\n"));
    h.frames(1);

    // 'A' rendered at (0,0)
    expect(h.pixel(1, 0)).toBe(1); // A top center
    // 'B' would be at x=4 — should not be rendered
    expect(h.pixel(4, 0)).toBe(0);
    expect(h.pixel(5, 0)).toBe(0);
  });
});

describe("TEXT_LG syscall (0x25)", () => {
  it("renders a null-terminated string with 5x7 font", () => {
    const h = createHarness();
    h.load([
      "JMP start",
      "msg:",
      ".data 0x41, 0x00", // "A\0"
      "start:",
      "  PUSH16 msg",
      "  PUSH8 20",
      "  PUSH8 10",
      "  SYSCALL 0x25",
      "  SYSCALL 0x06",
      "loop:",
      "JMP loop",
    ].join("\n"));
    h.frames(1);

    // 'A' at (20,10) with 5x7 font
    // Row 0: ..#.. → pixel at (22, 10) on
    expect(h.pixel(22, 10)).toBe(1);
    expect(h.pixel(20, 10)).toBe(0);
    // Row 4: ##### → all 5 on
    for (let col = 0; col < 5; col++) {
      expect(h.pixel(20 + col, 14)).toBe(1);
    }
  });
});
