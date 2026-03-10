import { describe, it, expect } from "vitest";
import { compile, isCompileError } from "../src/basic/compiler.ts";
import { createHarness } from "../src/test-harness.ts";
import invadersSource from "../examples/invaders.bas?raw";

async function initGame() {
  const asm = compile(invadersSource);
  if (isCompileError(asm)) throw new Error(`Compile: ${asm.message}`);
  const h = await createHarness();
  h.load(asm);
  h.frames(5);
  return h;
}

describe("invaders", () => {
  it("compiles without errors", () => {
    const asm = compile(invadersSource);
    expect(isCompileError(asm)).toBe(false);
  });

  it("runs 120 frames without crashing", async () => {
    const h = await initGame();
    for (let i = 0; i < 120; i++) {
      h.frame();
    }
    // Should still have pixels on screen
    let pixels = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 128; x++) {
        if (h.pixel(x, y)) pixels++;
      }
    }
    expect(pixels).toBeGreaterThan(20);
  });

  it("draws aliens on screen", async () => {
    const h = await initGame();
    // Check alien area (y=12-46) has pixels
    let alienPixels = 0;
    for (let y = 12; y < 46; y++) {
      for (let x = 0; x < 128; x++) {
        if (h.pixel(x, y)) alienPixels++;
      }
    }
    expect(alienPixels).toBeGreaterThan(50);
  });

  it("draws player cannon at bottom", async () => {
    const h = await initGame();
    // Check player area (y=56-60) has pixels
    let playerPixels = 0;
    for (let y = 56; y < 61; y++) {
      for (let x = 55; x < 75; x++) {
        if (h.pixel(x, y)) playerPixels++;
      }
    }
    expect(playerPixels).toBeGreaterThan(5);
  });

  it("draws HUD text", async () => {
    const h = await initGame();
    // Check score area at top
    let hudPixels = 0;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 50; x++) {
        if (h.pixel(x, y)) hudPixels++;
      }
    }
    expect(hudPixels).toBeGreaterThan(5);
  });

  it("player moves left/right via encoder", async () => {
    const h = await initGame();
    const countPixelsInRange = (xStart: number, xEnd: number) => {
      let count = 0;
      for (let y = 56; y < 61; y++) {
        for (let x = xStart; x < xEnd; x++) {
          if (h.pixel(x, y)) count++;
        }
      }
      return count;
    };

    // Move right via encoder delta (+1 in high byte, ENC_CW bit in low byte)
    h.input.bits = (1 & 0xff) | ((1 & 0xff) << 8); // low=ENC_CW(bit5 not needed for delta), high=+1 delta
    for (let i = 0; i < 20; i++) {
      h.frame();
    }
    h.input.bits = 0;

    // Cannon should have moved right, pixels in right zone
    const rightAfter = countPixelsInRange(80, 110);
    expect(rightAfter).toBeGreaterThan(0);
  });
});
