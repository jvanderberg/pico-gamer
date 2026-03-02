import { describe, it, expect } from "vitest";
import { createHarness } from "../src/test-harness.ts";
import asteroidsSource from "../examples/asteroids.asm?raw";

function inputWithEncDelta(delta: number, lowBits = 0): number {
  return (lowBits & 0xff) | ((delta & 0xff) << 8);
}

/** Run the init phase (sprite setup). */
async function initGame() {
  const h = await createHarness();
  h.load(asteroidsSource);
  // Run enough frames for the init code to complete (copy loop + setup)
  h.frames(5);
  return h;
}

describe("asteroids — ship", () => {
  it("ship sprite is active at center after init", async () => {
    const h = await initGame();
    const ship = h.sprites[0]!;
    expect(ship.active).toBe(true);
    expect(Math.round(ship.x)).toBeGreaterThanOrEqual(61);
    expect(Math.round(ship.x)).toBeLessThanOrEqual(63);
    expect(Math.round(ship.y)).toBeGreaterThanOrEqual(29);
    expect(Math.round(ship.y)).toBeLessThanOrEqual(31);
    expect(ship.flags & 4).toBe(4); // vector mode
    expect(ship.width).toBe(7);
    expect(ship.height).toBe(7);
  });

  it("ship angle starts at 0 (bitmap points up, no rotation)", async () => {
    const h = await initGame();
    expect(Math.round(h.sprites[0]!.angle)).toBe(0);
  });

  it("ship renders pixels on the framebuffer", async () => {
    const h = await initGame();
    let pixels = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 128; x++) {
        if (h.pixel(x, y)) pixels++;
      }
    }
    expect(pixels).toBeGreaterThan(10);
  });

  describe("rotation", () => {
    it("ENC_CW rotates clockwise (+9 angle steps)", async () => {
      const h = await initGame();
      h.input.bits = inputWithEncDelta(1, 1 << 5);
      h.frame();
      h.input.bits = 0;
      expect(Math.round(h.sprites[0]!.angle)).toBe(9); // 0 + 9
    });

    it("ENC_CCW rotates counter-clockwise (-9 angle steps)", async () => {
      const h = await initGame();
      h.input.bits = inputWithEncDelta(-1, 1 << 6);
      h.frame();
      h.input.bits = 0;
      expect(Math.round(h.sprites[0]!.angle)).toBe(247); // (0 - 9) & 255 = 247
    });

    it("multiple rotations accumulate", async () => {
      const h = await initGame();
      h.input.bits = inputWithEncDelta(1, 1 << 5);
      h.frame();
      h.frame();
      h.frame();
      h.input.bits = 0;
      // 0 + 9*3 = 27
      expect(Math.round(h.sprites[0]!.angle)).toBe(27);
    });

    it("rotation wraps around 0/255 boundary", async () => {
      const h = await initGame();
      // Rotate CCW to wrap past 0
      h.input.bits = inputWithEncDelta(-1, 1 << 6);
      for (let i = 0; i < 3; i++) h.frame();
      h.input.bits = 0;
      // (0 - 9*3) & 255 = (-27) & 255 = 229
      expect(Math.round(h.sprites[0]!.angle)).toBe(229);
    });
  });

  describe("thrust", () => {
    it("BTN thrusts ship in facing direction (up when angle=0)", async () => {
      const h = await initGame();
      const startY = Math.round(h.sprites[0]!.y);

      h.input.bits = 1 << 4; // BTN
      for (let i = 0; i < 10; i++) h.frame();
      h.input.bits = 0;

      // Ship should have moved upward (y decreased)
      expect(Math.round(h.sprites[0]!.y)).toBeLessThan(startY);
      // X should be approximately unchanged (thrust_angle 192 → cos=0)
      // ±1 tolerance for fixed-point truncation
      expect(Math.abs(Math.round(h.sprites[0]!.x) - 62)).toBeLessThanOrEqual(1);
    });

    it("thrust builds velocity over multiple frames", async () => {
      const h = await initGame();

      h.input.bits = 1 << 4; // BTN
      h.frame();
      const vy1 = h.read16(0xC002);
      for (let i = 0; i < 4; i++) h.frame();
      const vy5 = h.read16(0xC002);
      h.input.bits = 0;

      // Signed comparison: both are negative (large u16), later should be more negative
      const signed1 = vy1 >= 0x8000 ? vy1 - 0x10000 : vy1;
      const signed5 = vy5 >= 0x8000 ? vy5 - 0x10000 : vy5;
      expect(signed5).toBeLessThan(signed1); // more negative = faster upward
    });

    it("thrust in rotated direction changes both vx and vy", async () => {
      const h = await initGame();

      // Rotate CW to angle ~64 (pointing right): 9*7 = 63 ≈ 64
      h.input.bits = inputWithEncDelta(1, 1 << 5);
      for (let i = 0; i < 7; i++) h.frame();
      h.input.bits = 0;

      // Now thrust right
      h.input.bits = 1 << 4; // BTN
      for (let i = 0; i < 10; i++) h.frame();
      h.input.bits = 0;

      // Ship should have moved rightward (x increased)
      expect(Math.round(h.sprites[0]!.x)).toBeGreaterThan(62);
    });
  });

  describe("drag", () => {
    it("velocity decays when not thrusting", async () => {
      const h = await initGame();

      // Build up some velocity
      h.input.bits = 1 << 4; // BTN
      for (let i = 0; i < 10; i++) h.frame();
      h.input.bits = 0;

      const vyAfterThrust = h.read16(0xC002);
      const signedAfterThrust = vyAfterThrust >= 0x8000 ? vyAfterThrust - 0x10000 : vyAfterThrust;

      // Coast for 20 frames
      for (let i = 0; i < 20; i++) h.frame();

      const vyAfterCoast = h.read16(0xC002);
      const signedAfterCoast = vyAfterCoast >= 0x8000 ? vyAfterCoast - 0x10000 : vyAfterCoast;

      // Magnitude should have decreased (closer to 0)
      expect(Math.abs(signedAfterCoast)).toBeLessThan(Math.abs(signedAfterThrust));
    });
  });

  describe("edge wrapping", () => {
    it("ship wraps around screen edges", async () => {
      const h = await initGame();

      // Thrust upward for many frames — should wrap from top to bottom
      h.input.bits = 1 << 4; // BTN
      for (let i = 0; i < 60; i++) h.frame();
      h.input.bits = 0;

      // After 60 frames of upward thrust, ship should have wrapped
      // (exact position depends on acceleration curve, but y should not be < -8)
      const ship = h.sprites[0]!;
      expect(ship.active).toBe(true);
      // Ship's edge mode is wrap, so y should be in [0, 64)
      expect(Math.round(ship.y)).toBeGreaterThanOrEqual(0);
      expect(Math.round(ship.y)).toBeLessThan(64);
    });
  });

  describe("bullets", () => {
    it("ENC_BTN fires a bullet sprite in slot 1", async () => {
      const h = await initGame();
      h.input.bits = 1 << 7; // ENC_BTN
      h.frame();
      h.input.bits = 0;

      const bullet = h.sprites[1]!;
      expect(bullet.active).toBe(true);
      expect(bullet.width).toBe(2);
      expect(bullet.height).toBe(2);
      expect(bullet.edge).toBe(3); // destroy off-screen
    });

    it("bullet moves in ship facing direction (up when angle=0)", async () => {
      const h = await initGame();
      h.input.bits = 1 << 7; // ENC_BTN
      h.frame();
      h.input.bits = 0;

      const bullet = h.sprites[1]!;
      // Ship faces up (angle=0) → bullet should move up (vy < 0)
      expect(bullet.vy).toBeLessThan(0);
      // vx should be ~0 (pointing straight up)
      expect(Math.abs(bullet.vx)).toBeLessThan(5);
    });

    it("bullet starts near ship center", async () => {
      const h = await initGame();
      h.input.bits = 1 << 7;
      h.frame();
      h.input.bits = 0;

      const ship = h.sprites[0]!;
      const bullet = h.sprites[1]!;
      // Bullet should be near ship position (within a few pixels)
      expect(Math.abs(Math.round(bullet.x) - Math.round(ship.x))).toBeLessThan(6);
      expect(Math.abs(Math.round(bullet.y) - Math.round(ship.y))).toBeLessThan(6);
    });

    it("fire cooldown prevents rapid fire", async () => {
      const h = await initGame();
      h.input.bits = 1 << 7;
      h.frame(); // fires bullet in slot 1
      // Slot 1 should be active
      expect(h.sprites[1]!.active).toBe(true);

      // Next frame, still holding fire — should NOT fire another (cooldown)
      h.frame();
      // Slot 2 should still be inactive
      expect(h.sprites[2]!.active).toBe(false);
    });

    it("can fire again after cooldown expires", async () => {
      const h = await initGame();
      h.input.bits = 1 << 7;
      h.frame(); // fires slot 1
      h.input.bits = 0;

      // Wait out cooldown (8 frames)
      for (let i = 0; i < 9; i++) h.frame();

      h.input.bits = 1 << 7;
      h.frame(); // should fire slot 2
      h.input.bits = 0;

      expect(h.sprites[2]!.active).toBe(true);
    });

    it("bullet fired at rotated angle has correct velocity direction", async () => {
      const h = await initGame();

      // Rotate CW to ~90° (angle 64): 9*7=63 ≈ 64
      h.input.bits = inputWithEncDelta(1, 1 << 5);
      for (let i = 0; i < 7; i++) h.frame();
      h.input.bits = 0;

      // Fire
      h.input.bits = 1 << 7;
      h.frame();
      h.input.bits = 0;

      const bullet = h.sprites[1]!;
      // Pointing right → vx should be positive, vy should be ~0
      expect(bullet.vx).toBeGreaterThan(0);
    });

    it("bullets cycle through slots 1-4", async () => {
      const h = await initGame();

      for (let shot = 1; shot <= 4; shot++) {
        h.input.bits = 1 << 7;
        h.frame();
        h.input.bits = 0;
        expect(h.sprites[shot]!.active).toBe(true);
        // Wait out cooldown
        for (let i = 0; i < 9; i++) h.frame();
      }
    });
  });

  describe("asteroids", () => {
    it("wave 1 spawns 4 large asteroids at init", async () => {
      const h = await initGame();
      let count = 0;
      for (let i = 5; i < 32; i++) {
        if (h.sprites[i]!.active) count++;
      }
      expect(count).toBe(4); // wave 1: 3 + 1 = 4
      // All should be vector sprites with wrap
      for (let i = 5; i < 5 + count; i++) {
        expect(h.sprites[i]!.flags & 4).toBe(4);
        expect(h.sprites[i]!.edge).toBe(1); // wrap
      }
    });

    it("asteroids are tracked in size array at 0xC010", async () => {
      const h = await initGame();
      for (let i = 0; i < 4; i++) {
        expect(h.read8(0xC010 + i)).toBe(1); // large
      }
    });

    it("asteroid count is tracked at 0xC007", async () => {
      const h = await initGame();
      expect(h.read8(0xC007)).toBe(4); // wave 1: 3 + 1 = 4
    });

    it("asteroids move and wrap", async () => {
      const h = await initGame();
      const startPositions = [];
      for (let i = 5; i <= 12; i++) {
        startPositions.push({ x: h.sprites[i]!.x, y: h.sprites[i]!.y });
      }
      // Run for a while
      for (let i = 0; i < 30; i++) h.frame();
      // At least some should have moved
      let moved = 0;
      for (let i = 5; i <= 12; i++) {
        const start = startPositions[i - 5]!;
        if (
          Math.abs(h.sprites[i]!.x - start.x) > 1 ||
          Math.abs(h.sprites[i]!.y - start.y) > 1
        ) {
          moved++;
        }
      }
      expect(moved).toBeGreaterThan(0);
    });

    it("bullet destroys asteroid on collision", async () => {
      const h = await initGame();
      const ast = h.sprites[5]!;

      // Deactivate other asteroids and clear their size entries
      for (let i = 6; i < 32; i++) {
        h.sprites[i]!.active = false;
        h.writeMem(0xC010 + (i - 5), 0);
      }
      h.writeMem(0xC007, 1); // only 1 asteroid remaining

      // Write a solid 10x10 bitmap at 0xE000 so pixel-perfect check passes
      const solidAddr = 0xE000;
      for (let row = 0; row < 10; row++) {
        h.writeMem(solidAddr + row * 2, 0xFF);
        h.writeMem(solidAddr + row * 2 + 1, 0xC0);
      }

      // Place a solid block right on the asteroid
      const b = h.sprites[1]!;
      b.active = true;
      b.addr = solidAddr;
      b.x = Math.round(ast.x);
      b.y = Math.round(ast.y);
      b.width = 10;
      b.height = 10;
      b.vx = 0;
      b.vy = 0;
      b.flags = 0;
      b.edge = 0;
      b.collGroup = 4;
      b.collMask = 2;
      b.spriteMode = 3; // destroy on hit

      // Frame 1: collision detected. Frame 2: game code reads hitFlags.
      h.frame();
      h.frame();

      const sizeAfter = h.read8(0xC010); // slot 5 size
      // Large splits into 2 medium — slot 5 cleared (0) or reused (2)
      expect(sizeAfter === 0 || sizeAfter === 2).toBe(true);
    });

    it("large asteroid splits into 2 medium when destroyed", async () => {
      const h = await initGame();
      const ast = h.sprites[5]!;

      // Deactivate other asteroids and clear their size entries
      for (let i = 6; i < 32; i++) {
        h.sprites[i]!.active = false;
        h.writeMem(0xC010 + (i - 5), 0);
      }
      h.writeMem(0xC007, 1); // only 1 asteroid remaining

      const initialCount = h.read8(0xC007); // should be 1

      const solidAddr = 0xE000;
      for (let row = 0; row < 10; row++) {
        h.writeMem(solidAddr + row * 2, 0xFF);
        h.writeMem(solidAddr + row * 2 + 1, 0xC0);
      }

      const b = h.sprites[1]!;
      b.active = true;
      b.addr = solidAddr;
      b.x = Math.round(ast.x);
      b.y = Math.round(ast.y);
      b.width = 10;
      b.height = 10;
      b.vx = 0;
      b.vy = 0;
      b.flags = 0;
      b.edge = 0;
      b.collGroup = 4;
      b.collMask = 2;
      b.spriteMode = 3;

      h.frame();
      h.frame();

      // -1 destroyed + 2 children = net +1
      const newCount = h.read8(0xC007);
      expect(newCount).toBe(initialCount + 1);
    });
  });

  describe("invincibility", () => {
    it("ship becomes invincible after being hit", async () => {
      const h = await initGame();
      const ast = h.sprites[5]!;

      // Position asteroid directly on ship, angle=0 for deterministic overlap
      ast.x = 62;
      ast.y = 30;
      ast.vx = 0;
      ast.vy = 0;
      ast.angle = 0;
      ast.rotSpeed = 0;

      h.frame(); // collision detected by sprite engine
      h.frame(); // game code processes it, sets timer

      expect(h.read8(0xC009)).toBeGreaterThan(0); // invincibility active
    });

    it("ship is not killed again while invincible", async () => {
      const h = await initGame();

      // Manually set invincibility
      h.writeMem(0xC009, 60);

      // Put asteroid right on ship
      h.sprites[5]!.x = 60;
      h.sprites[5]!.y = 28;
      h.sprites[5]!.vx = 0;
      h.sprites[5]!.vy = 0;

      // Run several frames — ship should stay at center, timer should tick down
      const timerBefore = h.read8(0xC009);
      for (let i = 0; i < 10; i++) h.frame();
      const timerAfter = h.read8(0xC009);

      expect(timerAfter).toBeLessThan(timerBefore);
      expect(timerAfter).toBeGreaterThan(0);
      // Ship should still be at center (not reset again)
      // ±1 tolerance for fixed-point truncation
      expect(Math.abs(Math.round(h.sprites[0]!.x) - 62)).toBeLessThanOrEqual(1);
    });

    it("ship flashes during invincibility", async () => {
      const h = await initGame();
      h.writeMem(0xC009, 20); // set invincibility

      // Collect segment counts over several frames
      const segCounts: number[] = [];
      for (let i = 0; i < 16; i++) {
        h.frame();
        segCounts.push(h.read8(h.labels['ship_vecs']));
      }

      // Should have a mix of 0 (hidden) and 3 (visible)
      expect(segCounts).toContain(0);
      expect(segCounts).toContain(3);
    });
  });

  describe("lives, score, waves", () => {
    it("lives start at 3", async () => {
      const h = await initGame();
      expect(h.read8(0xC02B)).toBe(3);
    });

    it("score starts at 0", async () => {
      const h = await initGame();
      expect(h.read16(0xC02C)).toBe(0);
    });

    it("wave starts at 1 after init", async () => {
      const h = await initGame();
      expect(h.read8(0xC02E)).toBe(1);
    });

    it("game_state starts at 0 (playing)", async () => {
      const h = await initGame();
      expect(h.read8(0xC005)).toBe(0);
    });

    it("ship death decrements lives", async () => {
      const h = await initGame();
      const ast = h.sprites[5]!;

      // Position asteroid directly on ship
      ast.x = 62;
      ast.y = 30;
      ast.vx = 0;
      ast.vy = 0;
      ast.angle = 0;
      ast.rotSpeed = 0;

      h.frame(); // collision detected
      h.frame(); // game code processes it

      expect(h.read8(0xC02B)).toBe(2); // 3 → 2
    });

    it("game over state set when lives reach 0", async () => {
      const h = await initGame();
      // Set lives to 1 so next death triggers game over
      h.writeMem(0xC02B, 1);

      const ast = h.sprites[5]!;
      ast.x = 62;
      ast.y = 30;
      ast.vx = 0;
      ast.vy = 0;
      ast.angle = 0;
      ast.rotSpeed = 0;

      h.frame();
      h.frame();

      expect(h.read8(0xC02B)).toBe(0); // lives = 0
      expect(h.read8(0xC005)).toBe(1); // game_state = game_over
    });

    it("score increases on asteroid destruction (100 for large)", async () => {
      const h = await initGame();
      const ast = h.sprites[5]!;

      // Deactivate other asteroids and clear their size entries
      for (let i = 6; i < 32; i++) {
        h.sprites[i]!.active = false;
        h.writeMem(0xC010 + (i - 5), 0);
      }
      h.writeMem(0xC007, 1); // only 1 asteroid remaining

      // Place solid bullet bitmap on asteroid
      const solidAddr = 0xE000;
      for (let row = 0; row < 10; row++) {
        h.writeMem(solidAddr + row * 2, 0xFF);
        h.writeMem(solidAddr + row * 2 + 1, 0xC0);
      }

      const b = h.sprites[1]!;
      b.active = true;
      b.addr = solidAddr;
      b.x = Math.round(ast.x);
      b.y = Math.round(ast.y);
      b.width = 10;
      b.height = 10;
      b.vx = 0;
      b.vy = 0;
      b.flags = 0;
      b.edge = 0;
      b.collGroup = 4;
      b.collMask = 2;
      b.spriteMode = 3;

      h.frame();
      h.frame();

      expect(h.read16(0xC02C)).toBe(100); // large asteroid = 100 points
    });

    it("new wave spawns when asteroid_count reaches 0", async () => {
      const h = await initGame();
      expect(h.read8(0xC02E)).toBe(1); // wave 1

      // Clear all asteroids manually
      for (let i = 5; i < 32; i++) {
        h.sprites[i]!.active = false;
      }
      for (let i = 0; i < 27; i++) {
        h.writeMem(0xC010 + i, 0);
      }
      h.writeMem(0xC007, 0); // asteroid_count = 0

      h.frame(); // should trigger spawn_wave

      expect(h.read8(0xC02E)).toBe(2); // wave incremented to 2
      expect(h.read8(0xC007)).toBe(5); // 3 + 2 = 5 asteroids
    });

    it("HUD draws pixels in score and lives areas", async () => {
      const h = await initGame();
      h.frame(); // run main loop to draw HUD

      // Score "0" at (1,1) via TEXT_SM — check for pixels near top-left
      let scorePixels = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 12; x++) {
          if (h.pixel(x, y)) scorePixels++;
        }
      }
      expect(scorePixels).toBeGreaterThan(0);

      // Lives icons near top-right — check for pixels
      let livesPixels = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 108; x < 128; x++) {
          if (h.pixel(x, y)) livesPixels++;
        }
      }
      expect(livesPixels).toBeGreaterThan(0);
    });
  });

  describe("ship icon", () => {
    it("ship_icon BLIT renders correctly", async () => {
      const h = await initGame();

      // Disable all sprites so we get a clean framebuffer
      for (let i = 0; i < 32; i++) h.sprites[i]!.active = false;

      // Write a small program to BLIT ship_icon at (10, 10)
      // Row-aligned format: each row of 5px = 1 byte (MSB-first, 3 padding bits)
      // ..#.. = 0x20, .#.#. = 0x50, .#.#. = 0x50, #...# = 0x88, ##### = 0xF8
      h.load(`
        JMP start
      ship_icon:
        .data 0x20, 0x50, 0x50, 0x88, 0xF8
      start:
        PUSH16 ship_icon
        PUSH8 10
        PUSH8 10
        PUSH8 5
        PUSH8 5
        SYSCALL 0x05
        SYSCALL 0x06
        HALT
      `);
      h.frames(1);

      // Read back the 5x5 region and build ASCII art
      const rows: string[] = [];
      for (let y = 10; y < 15; y++) {
        let row = "";
        for (let x = 10; x < 15; x++) {
          row += h.pixel(x, y) ? "#" : ".";
        }
        rows.push(row);
      }

      // Print for visual inspection
      const art = rows.join("\n");
      console.log("Ship icon:\n" + art);

      // Should match the ship triangle: nose up, flat base
      expect(rows[0]).toBe("..#..");  // nose
      expect(rows[1]).toBe(".#.#.");  // sides
      expect(rows[2]).toBe(".#.#.");  // sides
      expect(rows[3]).toBe("#...#");  // wide
      expect(rows[4]).toBe("#####");  // base
    });
  });

  describe("SYS_SIN / SYS_COS syscalls", () => {
    it("SYS_SIN returns correct values for cardinal angles", async () => {
      const h = await createHarness();
      h.load(`
        PUSH8 0
        SYSCALL 0x22
        STORE 0xD000
        PUSH8 64
        SYSCALL 0x22
        STORE 0xD002
        PUSH8 128
        SYSCALL 0x22
        STORE 0xD004
        PUSH8 192
        SYSCALL 0x22
        STORE 0xD006
        SYSCALL 0x06
        HALT
      `);
      h.frames(1);
      expect(h.read8(0xD000)).toBe(0);       // sin(0°) = 0
      expect(h.read8(0xD002)).toBe(127);      // sin(90°) = 127
      expect(h.read8(0xD004)).toBe(0);        // sin(180°) = 0
      expect(h.read8(0xD006)).toBe(129);      // sin(270°) = -127 as u8
    });

    it("SYS_COS returns sin shifted by 64", async () => {
      const h = await createHarness();
      h.load(`
        PUSH8 0
        SYSCALL 0x23
        STORE 0xD000
        PUSH8 64
        SYSCALL 0x23
        STORE 0xD002
        SYSCALL 0x06
        HALT
      `);
      h.frames(1);
      expect(h.read8(0xD000)).toBe(127);      // cos(0°) = 127
      expect(h.read8(0xD002)).toBe(0);        // cos(90°) = 0
    });
  });
});
