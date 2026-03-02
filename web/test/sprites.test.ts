import { describe, it, expect } from "vitest";
import { createHarness } from "../src/test-harness.ts";

// ---------------------------------------------------------------------------
// Assembly helpers — generate instruction text for sprite/wall syscalls.
// These produce assembly source that goes through the assembler + VM.
// ---------------------------------------------------------------------------

function imm(v: number): string {
  return v > 255 || v < 0 ? `PUSH16 ${v & 0xffff}` : `PUSH8 ${v}`;
}

/** Push an address — numeric literal or label name. */
function immAddr(v: number | string): string {
  if (typeof v === "string") return `PUSH16 ${v}`;
  return v > 255 || v < 0 ? `PUSH16 ${v & 0xffff}` : `PUSH8 ${v}`;
}

/** SPR_SET (0x40): activate sprite */
function sprSet(
  slot: number, x: number, y: number,
  opts: { addr?: number | string; w?: number; h?: number; flags?: number; vx?: number; vy?: number; edge?: number } = {},
): string {
  const { addr = 0x100, w = 8, h = 8, flags = 0, vx = 0, vy = 0, edge = 0 } = opts;
  return [
    imm(slot), immAddr(addr), imm(w), imm(h),
    imm(x), imm(y), imm(flags), imm(vx), imm(vy), imm(edge),
    "SYSCALL 0x40",
  ].join("\n");
}

/** SPR_COLL (0x47): set collision mode (1=detect, 2=bounce, 3=destroy, 4=stop) */
function sprColl(slot: number, mode: number): string {
  return `${imm(slot)}\n${imm(mode)}\nSYSCALL 0x47`;
}

/** SPR_GROUP (0x4b): set collision group and mask */
function sprGroup(slot: number, group: number, mask: number): string {
  return `${imm(slot)}\n${imm(group)}\n${imm(mask)}\nSYSCALL 0x4b`;
}

/** SPR_ON_HIT (0x4c): set hit callback to a label */
function sprOnHit(slot: number, label: string): string {
  return `${imm(slot)}\nPUSH16 ${label}\nSYSCALL 0x4c`;
}

/** SPR_VEL (0x42): set sprite velocity */
function sprVel(slot: number, vx: number, vy: number): string {
  return `${imm(slot)}\n${imm(vx)}\n${imm(vy)}\nSYSCALL 0x42`;
}

/** SPR_OFF (0x44): deactivate sprite */
function sprOff(slot: number): string {
  return `${imm(slot)}\nSYSCALL 0x44`;
}

/** SPR_WALL (0x46): set wall collision mode */
function sprWall(slot: number, mode: number): string {
  return `${imm(slot)}\n${imm(mode)}\nSYSCALL 0x46`;
}

/** WALL_SET (0x48): activate wall */
function wallSet(slot: number, x: number, y: number, w: number, h: number): string {
  return [imm(slot), imm(x), imm(y), imm(w), imm(h), "SYSCALL 0x48"].join("\n");
}

/** SPR_HIT → STORE: read hit result into memory */
function sprHitStore(slot: number, addr: number): string {
  return `${imm(slot)}\nSYSCALL 0x4a\nSTORE ${addr}`;
}

/** SPR_GET → STORE × 2: read position (x → xAddr, y → yAddr) */
function sprGetStore(slot: number, xAddr: number, yAddr: number): string {
  return `${imm(slot)}\nSYSCALL 0x43\nSTORE ${yAddr}\nSTORE ${xAddr}`;
}

/** SPR_ROT (0x4d): set sprite angle and angular velocity */
function sprRot(slot: number, angle: number, rotSpeed: number): string {
  return `${imm(slot)}\n${imm(angle)}\n${imm(rotSpeed)}\nSYSCALL 0x4d`;
}

/** SPR_GETROT → STORE: read angle into memory */
function sprGetRotStore(slot: number, addr: number): string {
  return `${imm(slot)}\nSYSCALL 0x4e\nSTORE ${addr}`;
}

// ---------------------------------------------------------------------------
// Sprite 0 starts at x=0, moves right at vx=64 (1 px/frame).
// Target sprites sit at x=12. Collision at frame 5 (x=5, 5+8=13 > 12).
// SPR_HIT result readable on frame 6. So h.frames(6) captures collision.
// ---------------------------------------------------------------------------

describe("sprite collisions", () => {
  describe("collision groups filter", () => {
    it("non-overlapping groups produce no sprite hitFlags", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 1),
        sprGroup(0, 0x01, 0x01),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        sprGroup(1, 0x02, 0x02),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(0, 0x200),
        sprHitStore(1, 0x202),
        "  JMP loop",
      ].join("\n"));

      h.frames(6);

      expect(h.read16(0x200) & 4).toBe(0);
      expect(h.read16(0x202) & 4).toBe(0);
    });

    it("same group produces sprite hitFlags", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 1),
        sprGroup(0, 0x01, 0x01),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        sprGroup(1, 0x01, 0x01),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(0, 0x200),
        sprHitStore(1, 0x202),
        "  JMP loop",
      ].join("\n"));

      h.frames(6);

      expect(h.read16(0x200) & 4).not.toBe(0);
      expect(h.read16(0x202) & 4).not.toBe(0);
    });
  });

  describe("detect-only mode", () => {
    it("spriteMode=1 records hitFlags without altering position", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 1),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprGetStore(0, 0x200, 0x202),
        sprHitStore(0, 0x204),
        "  JMP loop",
      ].join("\n"));

      h.frames(6);

      // x=5 after 5 frames of movement — no correction despite overlap
      expect(h.read16(0x200)).toBe(5);
      expect(h.read16(0x202)).toBe(10);
      expect(h.read16(0x204) & 4).not.toBe(0);
    });
  });

  describe("bounce mode", () => {
    it("spriteMode=2 reverses velocity and corrects position", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 2),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprGetStore(0, 0x200, 0x202),
        sprHitStore(0, 0x204),
        "  JMP loop",
      ].join("\n"));

      h.frames(6);

      // Collision at x=5, pushed back 1px to x=4, velocity reversed
      expect(h.read16(0x200)).toBe(4);
      expect(h.read16(0x204) & 4).not.toBe(0);

      h.frames(2);

      // Sprite bounced back: 4 → 3 → 2
      expect(h.read16(0x200)).toBe(2);
    });
  });

  describe("stop mode", () => {
    it("spriteMode=4 zeros velocity and clamps position", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 4),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprGetStore(0, 0x200, 0x202),
        sprHitStore(0, 0x204),
        "  JMP loop",
      ].join("\n"));

      h.frames(6);

      // Collision at x=5, pushed back to x=4, velocity zeroed
      expect(h.read16(0x200)).toBe(4);
      expect(h.read16(0x204) & 4).not.toBe(0);

      h.frames(3);

      // Sprite stopped — hasn't moved
      expect(h.read16(0x200)).toBe(4);
    });
  });

  describe("multiple collisions in one frame", () => {
    it("sprite colliding with two targets reports all hits", async () => {
      const h = await createHarness();
      h.load([
        // Sprite 0 at y=14 overlaps both sprite 1 (y=10) and sprite 2 (y=18)
        // but sprites 1 and 2 do NOT overlap each other (strict AABB: 10+8=18 !> 18)
        sprSet(0, 0, 14, { vx: 64 }),
        sprColl(0, 1),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        sprSet(2, 12, 18),
        sprColl(2, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(0, 0x200),
        sprHitStore(1, 0x202),
        sprHitStore(2, 0x204),
        "  JMP loop",
      ].join("\n"));

      h.frames(6);

      // All three report sprite collision
      expect(h.read16(0x200) & 4).not.toBe(0);
      expect(h.read16(0x202) & 4).not.toBe(0);
      expect(h.read16(0x204) & 4).not.toBe(0);
      // Sprite 0's hitIndex is 2 (last collision partner wins)
      expect(h.read16(0x200) >> 8).toBe(2);
    });
  });

  describe("hit callbacks", () => {
    it("callback repositions sprite via SPR_POS", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 1),
        sprOnHit(0, "teleport"),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprGetStore(0, 0x200, 0x202),
        "  JMP loop",
        "teleport:",
        "  SWAP",
        "  DUP",
        "  PUSH8 100",
        "  PUSH8 50",
        "  SYSCALL 0x41",
        "  POP",
        "  RET",
      ].join("\n"));

      h.frames(6);

      expect(h.read16(0x200)).toBe(100);
      expect(h.read16(0x202)).toBe(50);
    });

    it("callback destroys sprite via SPR_OFF", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 1),
        sprOnHit(0, "destroy_cb"),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprGetStore(0, 0x200, 0x202),
        sprHitStore(0, 0x204),
        "  JMP loop",
        "destroy_cb:",
        "  SWAP",
        "  DUP",
        "  SYSCALL 0x44",
        "  POP",
        "  RET",
      ].join("\n"));

      h.frames(6);

      // SPR_GET returns (0,0) for deactivated sprite
      expect(h.read16(0x200)).toBe(0);
      expect(h.read16(0x202)).toBe(0);
      // hitFlags persist
      expect(h.read16(0x204) & 4).not.toBe(0);
    });

    it("callback receives correct slot index", async () => {
      const h = await createHarness();
      h.load([
        // Use slot 3 so we can distinguish from 0
        sprSet(3, 0, 10, { vx: 64 }),
        sprColl(3, 1),
        sprOnHit(3, "store_slot"),
        sprSet(4, 12, 10),
        sprColl(4, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(3, 0x200),
        "  JMP loop",
        "store_slot:",
        "  SWAP",
        "  STORE8 0x300",
        "  RET",
      ].join("\n"));

      h.frames(6);

      expect(h.read8(0x300)).toBe(3);
      expect(h.read16(0x200) & 4).not.toBe(0);
    });
  });

  describe("SPR_HIT after destroy", () => {
    it("destroyed sprite still reports hitFlags via SPR_HIT", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 3), // destroy on collision
        sprSet(1, 12, 10),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(0, 0x200),
        sprGetStore(0, 0x202, 0x204),
        "  JMP loop",
      ].join("\n"));

      h.frames(6);

      const hit0 = h.read16(0x200);
      expect(hit0 & 4).not.toBe(0);
      expect(hit0 >> 8).toBe(1);       // hitIndex = sprite 1
      expect(h.read16(0x202)).toBe(0);  // SPR_GET x = 0 (inactive)
      expect(h.read16(0x204)).toBe(0);  // SPR_GET y = 0 (inactive)
    });
  });

  describe("group/mask asymmetry", () => {
    it("mask=0x01 only collides with group=0x01, ignores group=0x02", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 0, 10, { vx: 64 }),
        sprColl(0, 1),
        sprGroup(0, 0x01, 0x01),
        sprSet(1, 12, 10),
        sprColl(1, 1),
        sprGroup(1, 0x02, 0x02),
        sprSet(2, 12, 10),
        sprColl(2, 1),
        sprGroup(2, 0x01, 0x01),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(0, 0x200),
        sprHitStore(1, 0x202),
        sprHitStore(2, 0x204),
        "  JMP loop",
      ].join("\n"));

      h.frames(6);

      const hitA = h.read16(0x200);
      const hitB = h.read16(0x202);
      const hitC = h.read16(0x204);

      expect(hitA & 4).not.toBe(0);
      expect(hitA >> 8).toBe(2);   // A hit by C (slot 2)
      expect(hitB & 4).toBe(0);    // B untouched
      expect(hitC & 4).not.toBe(0);
      expect(hitC >> 8).toBe(0);   // C hit by A (slot 0)
    });
  });
});

describe("wall collisions", () => {
  it("sprite bounces off wall and reports wall hit", async () => {
    const h = await createHarness();
    h.load([
      sprSet(0, 0, 10, { vx: 64 }),
      sprWall(0, 2), // bounce off walls
      wallSet(1, 12, 10, 8, 8), // wall slot 1 so hitIndex is distinct
      "loop:",
      "  SYSCALL 0x06",
      sprHitStore(0, 0x200),
      sprGetStore(0, 0x202, 0x204),
      "  JMP loop",
    ].join("\n"));

    h.frames(6);

    const hit = h.read16(0x200);
    expect(hit & 2).not.toBe(0);  // wall hit bit
    expect(hit >> 8).toBe(1);     // wall slot 1
    expect(h.read16(0x202)).toBe(4); // pushed back from overlap

    h.frames(2);

    // Sprite bounced away from wall
    expect(h.read16(0x202)).toBe(2);
  });
});

describe("edge behaviors", () => {
  it("edge=1 wraps sprite to opposite side", async () => {
    const h = await createHarness();
    h.load([
      sprSet(0, 125, 10, { vx: 64, edge: 1 }),
      "loop:",
      "  SYSCALL 0x06",
      sprGetStore(0, 0x200, 0x202),
      "  JMP loop",
    ].join("\n"));

    // Frame 1: x=126, frame 2: x=127, frame 3: x=128 → wraps to 0
    h.frames(4);

    expect(h.read16(0x200)).toBe(0);

    h.frames(1);

    // Keeps moving after wrap
    expect(h.read16(0x200)).toBe(1);
  });

  it("edge=2 bounces sprite at screen border", async () => {
    const h = await createHarness();
    h.load([
      // SCREEN_W=128, width=8, so right edge triggers at x=120
      sprSet(0, 118, 10, { vx: 64, edge: 2 }),
      "loop:",
      "  SYSCALL 0x06",
      sprHitStore(0, 0x200),
      sprGetStore(0, 0x202, 0x204),
      "  JMP loop",
    ].join("\n"));

    // Frame 1: x=119, frame 2: x=120 → bounce (clamped, vx reversed)
    h.frames(3);

    expect(h.read16(0x200) & 1).not.toBe(0); // border hit
    expect(h.read16(0x202)).toBe(120);

    h.frames(2);

    // Bounced back: 120 → 119 → 118
    expect(h.read16(0x202)).toBe(118);
  });

  it("edge=3 destroys sprite when fully off-screen", async () => {
    const h = await createHarness();
    h.load([
      sprSet(0, 125, 10, { vx: 64, edge: 3 }),
      "loop:",
      "  SYSCALL 0x06",
      sprHitStore(0, 0x200),
      sprGetStore(0, 0x202, 0x204),
      "  JMP loop",
    ].join("\n"));

    // Frame 1: x=126, frame 2: x=127, frame 3: x=128 ≥ SCREEN_W → destroyed
    h.frames(4);

    expect(h.read16(0x200) & 1).not.toBe(0); // border hit
    expect(h.read16(0x202)).toBe(0);  // SPR_GET (0,0) = inactive
    expect(h.read16(0x204)).toBe(0);
  });

  it("edge=4 stops sprite at screen border", async () => {
    const h = await createHarness();
    h.load([
      sprSet(0, 118, 10, { vx: 64, edge: 4 }),
      "loop:",
      "  SYSCALL 0x06",
      sprHitStore(0, 0x200),
      sprGetStore(0, 0x202, 0x204),
      "  JMP loop",
    ].join("\n"));

    // Frame 1: x=119, frame 2: x=120 → stop (clamped, vx=0)
    h.frames(3);

    expect(h.read16(0x200) & 1).not.toBe(0); // border hit
    expect(h.read16(0x202)).toBe(120);

    h.frames(3);

    // Sprite hasn't moved — velocity is zero
    expect(h.read16(0x202)).toBe(120);
  });
});

describe("runtime syscalls", () => {
  it("SPR_VEL changes direction mid-flight", async () => {
    const h = await createHarness();
    h.load([
      sprSet(0, 60, 10, { vx: 64 }),
      "SYSCALL 0x06", // frame 1: x → 61
      // Read position, then reverse velocity
      sprGetStore(0, 0x200, 0x202),
      sprVel(0, -64, 0),
      "loop:",
      "  SYSCALL 0x06",
      sprGetStore(0, 0x204, 0x206),
      "  JMP loop",
    ].join("\n"));

    h.frames(3);

    // Before velocity change: was at 61 (moved right from 60)
    expect(h.read16(0x200)).toBe(61);
    // After velocity change: now at 60 (moved left from 61)
    expect(h.read16(0x204)).toBe(60);

    h.frames(1);

    // Continues moving left
    expect(h.read16(0x204)).toBe(59);
  });

  it("SPR_OFF deactivates sprite preventing movement and collision", async () => {
    const h = await createHarness();
    h.load([
      sprSet(0, 0, 10, { vx: 64 }),
      sprColl(0, 1),
      sprSet(1, 12, 10),
      sprColl(1, 1),
      "SYSCALL 0x06", // frame 1: x → 1
      sprOff(0),       // deactivate before reaching sprite 1
      "loop:",
      "  SYSCALL 0x06",
      sprGetStore(0, 0x200, 0x202),
      sprHitStore(1, 0x204),
      "  JMP loop",
    ].join("\n"));

    // Run enough frames that sprite 0 WOULD have reached sprite 1
    h.frames(8);

    // Sprite 0 is inactive — SPR_GET returns (0,0)
    expect(h.read16(0x200)).toBe(0);
    expect(h.read16(0x202)).toBe(0);
    // Sprite 1 was never hit — deactivated sprite can't collide
    expect(h.read16(0x204) & 4).toBe(0);
  });
});

describe("sprite rotation", () => {
  describe("drawSpriteRotated rendering", () => {
    // These tests verify that rotated bitmap sprites render correctly by
    // setting up sprites through assembly (SPR_SET + SPR_ROT) and checking
    // pixel output via h.pixel() after a YIELD frame.

    it("renders correctly at 0° (no rotation)", async () => {
      const h = await createHarness();
      // A simple 4x4 "L" shape:
      // Row 0: 1000  (0x80)
      // Row 1: 1000  (0x80)
      // Row 2: 1000  (0x80)
      // Row 3: 1110  (0xE0)
      h.load([
        "JMP start",
        "l_shape:",
        "  .data 0x80, 0x80, 0x80, 0xE0",
        "start:",
        sprSet(0, 10, 10, { addr: "l_shape", w: 4, h: 4, flags: 0 }),
        "SYSCALL 0x06",
        "HALT",
      ].join("\n"));

      h.frames(1);

      // Top-left pixel of L shape
      expect(h.pixel(10, 10)).toBe(1);
      expect(h.pixel(11, 10)).toBe(0);
      // Bottom row
      expect(h.pixel(10, 13)).toBe(1);
      expect(h.pixel(11, 13)).toBe(1);
      expect(h.pixel(12, 13)).toBe(1);
      expect(h.pixel(13, 13)).toBe(0);
    });

    it("renders rotated at 128 (180°)", async () => {
      const h = await createHarness();
      // 2x2 block: all 4 pixels set
      // 1100 0000 = 0xC0
      // 1100 0000 = 0xC0
      h.load([
        "JMP start",
        "block:",
        "  .data 0xC0, 0xC0",
        "start:",
        sprSet(0, 10, 10, { addr: "block", w: 2, h: 2, flags: 0 }),
        sprRot(0, 128, 0),
        "SYSCALL 0x06",
        "HALT",
      ].join("\n"));

      h.frames(1);

      // 180° rotation of a centered 2x2 block should still appear as a block
      // (symmetric under 180° — but the center shifts by 0.5 so pixels map back)
      expect(h.pixel(10, 10)).toBe(1);
      expect(h.pixel(11, 10)).toBe(1);
      expect(h.pixel(10, 11)).toBe(1);
      expect(h.pixel(11, 11)).toBe(1);
    });

    it("renders 8x8 sprite at 64 (90°) — rows become columns", async () => {
      const h = await createHarness();
      // Single row of 8 pixels at top: 0xFF followed by 7 rows of 0x00
      h.load([
        "JMP start",
        "hline:",
        "  .data 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00",
        "start:",
        sprSet(0, 20, 20, { addr: "hline", w: 8, h: 8, flags: 0 }),
        sprRot(0, 64, 0),
        "SYSCALL 0x06",
        "HALT",
      ].join("\n"));

      h.frames(1);

      // After 90° CW rotation, the horizontal line becomes vertical.
      // Nearest-neighbor sampling may lose a few pixels at small sizes.
      let totalPixels = 0;
      for (let y = 16; y <= 28; y++) {
        for (let x = 16; x <= 28; x++) {
          if (h.pixel(x, y)) totalPixels++;
        }
      }
      // Should produce at least 4 set pixels forming a line
      expect(totalPixels).toBeGreaterThanOrEqual(4);
      // Verify no pixels remain at the original horizontal position (row 20)
      // by checking that pixels are distributed vertically
      let distinctRows = 0;
      for (let y = 16; y <= 28; y++) {
        for (let x = 16; x <= 28; x++) {
          if (h.pixel(x, y)) { distinctRows++; break; }
        }
      }
      // Rotated line should span multiple rows (not just 1 row as unrotated)
      expect(distinctRows).toBeGreaterThanOrEqual(3);
    });
  });

  describe("angular velocity", () => {
    it("rotSpeed accumulates angle over frames", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 60, 30),
        // Set rotSpeed=64 → 1 angle step per frame
        sprRot(0, 0, 64),
        "loop:",
        "  SYSCALL 0x06",
        sprGetRotStore(0, 0x200),
        "  JMP loop",
      ].join("\n"));

      h.frames(10);

      // After 10 frames at rotSpeed=64 → angle should be ~10
      const angle = h.read16(0x200);
      expect(angle).toBeGreaterThanOrEqual(9);
      expect(angle).toBeLessThanOrEqual(11);
    });

    it("rotSpeed wraps angle at 256", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 60, 30),
        // Set angle=250, rotSpeed=256 → 4 steps/frame
        sprRot(0, 250, 256),
        "loop:",
        "  SYSCALL 0x06",
        sprGetRotStore(0, 0x200),
        "  JMP loop",
      ].join("\n"));

      // sprGetRotStore reads AFTER YIELD, so value is from the prior updateSprites.
      // Frame 1: updateSprites → 250+4=254
      // Frame 2: read 254, updateSprites → 258%256=2
      // Frame 3: read 2, updateSprites → 6
      // Frame 4: read 6
      h.frames(4);

      const angle = h.read16(0x200);
      expect(angle).toBeGreaterThanOrEqual(4);
      expect(angle).toBeLessThanOrEqual(8);
    });
  });

  describe("SPR_ROT / SPR_GETROT syscalls", () => {
    it("SPR_ROT sets angle and rotSpeed", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 60, 30),
        sprRot(0, 128, 0),
        // Frame 1: YIELD → updateSprites (angle stays 128, rotSpeed=0)
        "SYSCALL 0x06",
        // Frame 2: read angle, YIELD
        sprGetRotStore(0, 0x200),
        "loop:",
        "  SYSCALL 0x06",
        "  JMP loop",
      ].join("\n"));

      h.frames(2);
      expect(h.read16(0x200)).toBe(128);
    });

    it("SPR_GETROT returns current angle", async () => {
      const h = await createHarness();
      h.load([
        sprSet(0, 60, 30),
        sprRot(0, 42, 0),
        "SYSCALL 0x06",
        sprGetRotStore(0, 0x200),
        "loop:",
        "  SYSCALL 0x06",
        "  JMP loop",
      ].join("\n"));

      h.frames(2);
      expect(h.read16(0x200)).toBe(42);
    });
  });

  describe("pixel-perfect collision with rotation", () => {
    it("detects overlap of rotated sprites", async () => {
      const h = await createHarness();
      // Two 8x8 filled sprites near each other, one rotated ~45°
      // Pass the label address directly via SPR_SET so no post-hoc patching needed
      h.load([
        "JMP start",
        "full_gfx:",
        ".data 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF",
        "start:",
        // Sprite 0: at (20, 20), rotated 32 (~45°), addr = full_gfx label
        sprSet(0, 20, 20, { addr: "full_gfx" }),
        sprColl(0, 1),
        sprRot(0, 32, 0),
        // Sprite 1: at (25, 20), no rotation — should overlap with rotated sprite 0
        sprSet(1, 25, 20, { addr: "full_gfx" }),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(0, 0x200),
        sprHitStore(1, 0x202),
        "  JMP loop",
      ].join("\n"));

      h.frames(2);

      // Both should report sprite collision
      expect(h.read16(0x200) & 4).not.toBe(0);
      expect(h.read16(0x202) & 4).not.toBe(0);
    });

    it("rejects near-miss of rotated sprites", async () => {
      const h = await createHarness();
      // Small 4x4 sprites with only center pixels set, separated enough that
      // even after rotation their pixels don't touch
      h.load([
        "JMP start",
        "sm_gfx:",
        ".data 0x00, 0x60, 0x60, 0x00",
        "start:",
        // Sprite 0 at (10, 20), rotated 32 (~45°), addr = sm_gfx label
        sprSet(0, 10, 20, { addr: "sm_gfx", w: 4, h: 4 }),
        sprColl(0, 1),
        sprRot(0, 32, 0),
        // Sprite 1 at (18, 20), no rotation — gap of 4px from bounding box edge
        sprSet(1, 18, 20, { addr: "sm_gfx", w: 4, h: 4 }),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(0, 0x200),
        sprHitStore(1, 0x202),
        "  JMP loop",
      ].join("\n"));

      h.frames(2);

      // Neither should report collision — pixels don't overlap despite rotated bbox
      expect(h.read16(0x200) & 4).toBe(0);
      expect(h.read16(0x202) & 4).toBe(0);
    });
  });
});

describe("vector sprites", () => {
  describe("rendering", () => {
    it("draws line segments at angle=0", async () => {
      const h = await createHarness();
      // Vector data: 1 horizontal segment from (-3,0) to (3,0) in 4.4
      // -3 → 0xD0, 0 → 0x00, +3 → 0x30
      h.load([
        "JMP start",
        "vec_horiz:",
        "  .data 1",              // 1 segment
        "  .data 0xD0, 0x00, 0x30, 0x00",  // (-3,0) to (+3,0)
        "start:",
        sprSet(0, 60, 28, { addr: "vec_horiz", w: 7, h: 7, flags: 4 }),
        "SYSCALL 0x06",
        "HALT",
      ].join("\n"));

      h.frames(1);

      // Center of sprite: 60 + 3 = 63, 28 + 3 = 31
      // Line from (60, 31) to (66, 31) — horizontal
      expect(h.pixel(63, 31)).toBe(1); // center
      expect(h.pixel(60, 31)).toBe(1); // left end
      expect(h.pixel(66, 31)).toBe(1); // right end
      // Pixels above/below should be off
      expect(h.pixel(63, 30)).toBe(0);
      expect(h.pixel(63, 32)).toBe(0);
    });

    it("draws rotated line segments at angle=64 (90°)", async () => {
      const h = await createHarness();
      // Same horizontal segment, but rotated 90°
      h.load([
        "JMP start",
        "vec_horiz90:",
        "  .data 1",
        "  .data 0xD0, 0x00, 0x30, 0x00",
        "start:",
        sprSet(0, 60, 28, { addr: "vec_horiz90", w: 7, h: 7, flags: 4 }),
        sprRot(0, 64, 0),
        "SYSCALL 0x06",
        "HALT",
      ].join("\n"));

      h.frames(1);

      const cx = 60 + 3; // 63
      const cy = 28 + 3; // 31
      // After 90° rotation, horizontal line becomes vertical
      expect(h.pixel(cx, cy)).toBe(1); // center
      // Pixels should be distributed vertically, not horizontally
      let vertPixels = 0;
      for (let y = cy - 4; y <= cy + 4; y++) {
        if (h.pixel(cx, y)) vertPixels++;
      }
      expect(vertPixels).toBeGreaterThanOrEqual(4);
    });

    it("draws a triangle (3 segments) via demo assembly", async () => {
      const h = await createHarness();
      h.load([
        "JMP start",
        "tri_vecs:",
        "  .data 3",
        "  .data 0x00, 0xD0, 0xE0, 0x20",  // (0,-3) → (-2,2)
        "  .data 0xE0, 0x20, 0x20, 0x20",  // (-2,2) → (2,2)
        "  .data 0x20, 0x20, 0x00, 0xD0",  // (2,2) → (0,-3)
        "start:",
        "  PUSH8 0",
        "  PUSH16 tri_vecs",
        "  PUSH8 7",
        "  PUSH8 7",
        "  PUSH8 60",
        "  PUSH8 28",
        "  PUSH8 4",          // flags = vector mode
        "  PUSH8 0",
        "  PUSH8 0",
        "  PUSH8 0",
        "  SYSCALL 0x40",     // SPR_SET
        "loop:",
        "  SYSCALL 0x06",
        "  JMP loop",
      ].join("\n"));

      h.frames(2);

      // Should have rendered some pixels on the framebuffer
      let pixels = 0;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 128; x++) {
          if (h.pixel(x, y)) pixels++;
        }
      }
      // A triangle made of 3 lines should produce at least 10 pixels
      expect(pixels).toBeGreaterThanOrEqual(10);
    });
  });

  describe("collision", () => {
    it("vector sprite collides with bitmap sprite at overlapping pixels", async () => {
      const h = await createHarness();
      h.load([
        "JMP start",
        // Vector: single horizontal line (-3,0) to (3,0)
        "vec_data:",
        "  .data 1",
        "  .data 0xD0, 0x00, 0x30, 0x00",
        // Bitmap: 8x8 filled block
        "bmp_data:",
        "  .data 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF",
        "start:",
        // Sprite 0: vector at (20, 28), addr = vec_data label
        sprSet(0, 20, 28, { addr: "vec_data", w: 7, h: 7, flags: 4 }),
        sprColl(0, 1),
        // Sprite 1: bitmap at (24, 28) — overlaps, addr = bmp_data label
        sprSet(1, 24, 28, { addr: "bmp_data" }),
        sprColl(1, 1),
        "loop:",
        "  SYSCALL 0x06",
        sprHitStore(0, 0x200),
        sprHitStore(1, 0x202),
        "  JMP loop",
      ].join("\n"));

      h.frames(2);

      expect(h.read16(0x200) & 4).not.toBe(0); // vector hit bitmap
      expect(h.read16(0x202) & 4).not.toBe(0); // bitmap hit vector
    });
  });
});
