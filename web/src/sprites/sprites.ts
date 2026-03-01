import {
  SCREEN_W,
  SCREEN_H,
  drawSpriteRotated,
  drawLine,
  sin256,
  cos256,
  type Framebuffer,
} from "../display/display.ts";
import { step, push, type VMState } from "../vm/vm.ts";
import type { SyscallHandler } from "../syscalls/interface.ts";

export interface Sprite {
  active: boolean;
  addr: number; // memory address of graphic data (row-major, MSB-first)
  width: number; // pixels (1–16)
  height: number; // pixels (1–16)
  x: number; // pixel position (signed JS number)
  y: number;
  vx: number; // pixels per tick at 60fps (signed JS number)
  vy: number;
  flags: number; // bit 0 = flipX, bit 1 = flipY
  edge: number; // 0=none, 1=wrap, 2=bounce, 3=destroy, 4=stop
  wallMode: number; // 0=none, 2=bounce, 3=destroy, 4=stop
  spriteMode: number; // 0=none, 2=bounce, 3=destroy, 4=stop
  hitFlags: number; // runtime: bit 0=border, bit 1=wall, bit 2=sprite
  hitIndex: number; // runtime: slot index of last wall/sprite hit
  collGroup: number; // 8-bit bitmask for collision group membership
  collMask: number; // 8-bit bitmask for collision group filter
  hitCallback: number; // VM address of hit callback, 0 = none
  angle: number; // rotation 0–255 (256 steps = 360°)
  rotSpeed: number; // angular velocity (signed, same fixed-point as vx/vy)
  _vecRaster: Uint8Array | null; // cached rasterized vector sprite (for collision)
  _vecBounds: { ox: number; oy: number; w: number; h: number } | null;
}

export type SpriteTable = Sprite[];

export function createSpriteTable(count = 32): SpriteTable {
  const table: SpriteTable = [];
  for (let i = 0; i < count; i++) {
    table.push({
      active: false,
      addr: 0,
      width: 8,
      height: 8,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      flags: 0,
      edge: 0,
      wallMode: 0,
      spriteMode: 0,
      hitFlags: 0,
      hitIndex: 0,
      collGroup: 0xff,
      collMask: 0xff,
      hitCallback: 0,
      angle: 0,
      rotSpeed: 0,
      _vecRaster: null,
      _vecBounds: null,
    });
  }
  return table;
}

export function resetSpriteTable(table: SpriteTable): void {
  for (const spr of table) {
    spr.active = false;
    spr.addr = 0;
    spr.width = 8;
    spr.height = 8;
    spr.x = 0;
    spr.y = 0;
    spr.vx = 0;
    spr.vy = 0;
    spr.flags = 0;
    spr.edge = 0;
    spr.wallMode = 0;
    spr.spriteMode = 0;
    spr.hitFlags = 0;
    spr.hitIndex = 0;
    spr.collGroup = 0xff;
    spr.collMask = 0xff;
    spr.hitCallback = 0;
    spr.angle = 0;
    spr.rotSpeed = 0;
    spr._vecRaster = null;
    spr._vecBounds = null;
  }
}

export interface Wall {
  active: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WallTable = Wall[];

export function createWallTable(count = 16): WallTable {
  const table: WallTable = [];
  for (let i = 0; i < count; i++) {
    table.push({ active: false, x: 0, y: 0, width: 0, height: 0 });
  }
  return table;
}

export function resetWallTable(table: WallTable): void {
  for (const wall of table) {
    wall.active = false;
    wall.x = 0;
    wall.y = 0;
    wall.width = 0;
    wall.height = 0;
  }
}

function aabbOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Apply collision response on a single axis. Returns adjusted position and velocity. */
function applyCollisionMode(
  mode: number,
  spr: Sprite,
  overlapLeft: number,
  overlapRight: number,
  overlapTop: number,
  overlapBottom: number,
): void {
  if (mode === 1) return; // detect-only: hitFlags already set, no physics response
  // Find minimum penetration axis
  const minX = Math.min(overlapLeft, overlapRight);
  const minY = Math.min(overlapTop, overlapBottom);

  if (minX < minY) {
    // Resolve on X axis
    if (overlapLeft < overlapRight) {
      spr.x -= overlapLeft;
    } else {
      spr.x += overlapRight;
    }
    switch (mode) {
      case 2: // bounce
        spr.vx = -spr.vx;
        break;
      case 3: // destroy
        spr.active = false;
        break;
      case 4: // stop
        spr.vx = 0;
        break;
    }
  } else {
    // Resolve on Y axis
    if (overlapTop < overlapBottom) {
      spr.y -= overlapTop;
    } else {
      spr.y += overlapBottom;
    }
    switch (mode) {
      case 2: // bounce
        spr.vy = -spr.vy;
        break;
      case 3: // destroy
        spr.active = false;
        break;
      case 4: // stop
        spr.vy = 0;
        break;
    }
  }
}

function applyEdgeBehavior(spr: Sprite): void {
  switch (spr.edge) {
    case 1: // wrap
      spr.x = ((spr.x % SCREEN_W) + SCREEN_W) % SCREEN_W;
      spr.y = ((spr.y % SCREEN_H) + SCREEN_H) % SCREEN_H;
      break;

    case 2: // bounce
      if (spr.x <= 0) {
        spr.x = 0;
        spr.vx = Math.abs(spr.vx);
        spr.hitFlags |= 1;
      } else if (spr.x >= SCREEN_W - spr.width) {
        spr.x = SCREEN_W - spr.width;
        spr.vx = -Math.abs(spr.vx);
        spr.hitFlags |= 1;
      }
      if (spr.y <= 0) {
        spr.y = 0;
        spr.vy = Math.abs(spr.vy);
        spr.hitFlags |= 1;
      } else if (spr.y >= SCREEN_H - spr.height) {
        spr.y = SCREEN_H - spr.height;
        spr.vy = -Math.abs(spr.vy);
        spr.hitFlags |= 1;
      }
      break;

    case 3: // destroy — deactivate when fully off-screen
      if (
        spr.x <= -spr.width ||
        spr.x >= SCREEN_W ||
        spr.y <= -spr.height ||
        spr.y >= SCREEN_H
      ) {
        spr.active = false;
        spr.hitFlags |= 1;
      }
      break;

    case 4: // stop — clamp to edge and zero velocity
      if (spr.x <= 0) { spr.x = 0; spr.vx = 0; spr.hitFlags |= 1; }
      else if (spr.x >= SCREEN_W - spr.width) { spr.x = SCREEN_W - spr.width; spr.vx = 0; spr.hitFlags |= 1; }
      if (spr.y <= 0) { spr.y = 0; spr.vy = 0; spr.hitFlags |= 1; }
      else if (spr.y >= SCREEN_H - spr.height) { spr.y = SCREEN_H - spr.height; spr.vy = 0; spr.hitFlags |= 1; }
      break;
  }
}

interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Compute the axis-aligned bounding box of a (possibly rotated) sprite. */
function sprBBox(spr: Sprite): BBox {
  const angle = Math.round(spr.angle) & 0xff;
  if (angle === 0) {
    return { x: spr.x, y: spr.y, w: spr.width, h: spr.height };
  }
  const cx = spr.x + (spr.width - 1) / 2;
  const cy = spr.y + (spr.height - 1) / 2;
  const hw = (spr.width * 256) >> 1;
  const hh = (spr.height * 256) >> 1;
  const sinA = sin256(angle);
  const cosA = cos256(angle);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const ox of [-hw, hw]) {
    for (const oy of [-hh, hh]) {
      const dx = (ox * cosA - oy * sinA) / (256 * 256) + cx;
      const dy = (ox * sinA + oy * cosA) / (256 * 256) + cy;
      if (dx < minX) minX = dx;
      if (dx > maxX) maxX = dx;
      if (dy < minY) minY = dy;
      if (dy > maxY) maxY = dy;
    }
  }
  const bx = Math.floor(minX);
  const by = Math.floor(minY);
  return { x: bx, y: by, w: Math.ceil(maxX) - bx, h: Math.ceil(maxY) - by };
}

/** Check if a sprite has a set pixel at world position (wx, wy), accounting for rotation. */
function spriteHasPixelAt(spr: Sprite, mem: Uint8Array, wx: number, wy: number): boolean {
  // Vector sprites use the rasterized cache
  if (spr.flags & 4) {
    if (!spr._vecRaster || !spr._vecBounds) {
      rasterizeVector(spr, mem);
    }
    const b = spr._vecBounds!;
    const lx = wx - b.ox;
    const ly = wy - b.oy;
    if (lx < 0 || lx >= b.w || ly < 0 || ly >= b.h) return false;
    const rBytesPerRow = Math.ceil(b.w / 8);
    const byteIdx = ly * rBytesPerRow + (lx >>> 3);
    const bitOff = 7 - (lx & 7);
    return ((spr._vecRaster![byteIdx]! >>> bitOff) & 1) !== 0;
  }

  const angle = Math.round(spr.angle) & 0xff;
  const bytesPerRow = Math.ceil(spr.width / 8);
  let srcX: number, srcY: number;

  if (angle === 0) {
    srcX = wx - Math.round(spr.x);
    srcY = wy - Math.round(spr.y);
  } else {
    // Inverse rotation from world to source coords
    const cx = spr.x + (spr.width - 1) / 2;
    const cy = spr.y + (spr.height - 1) / 2;
    const offX = (wx - cx) * 256;
    const offY = (wy - cy) * 256;
    const cosA = cos256(angle);
    const sinA = sin256(angle);
    const sx = ((spr.width - 1) * 256) >> 1;
    const sy = ((spr.height - 1) * 256) >> 1;
    const srcX256 = (offX * cosA + offY * sinA + sx * 256) >> 8;
    const srcY256 = (-offX * sinA + offY * cosA + sy * 256) >> 8;
    srcX = (srcX256 + 128) >> 8;
    srcY = (srcY256 + 128) >> 8;
  }

  if (srcX < 0 || srcX >= spr.width || srcY < 0 || srcY >= spr.height) return false;

  const byteIdx = srcY * bytesPerRow + (srcX >>> 3);
  const bitOff = 7 - (srcX & 7);
  return ((mem[spr.addr + byteIdx]! >>> bitOff) & 1) !== 0;
}

/** Pixel-perfect overlap test between two sprites. */
function pixelOverlap(a: Sprite, b: Sprite, mem: Uint8Array): boolean {
  const ba = sprBBox(a);
  const bb = sprBBox(b);
  // Intersection of the two bounding boxes
  const ix0 = Math.max(Math.floor(ba.x), Math.floor(bb.x));
  const iy0 = Math.max(Math.floor(ba.y), Math.floor(bb.y));
  const ix1 = Math.min(Math.ceil(ba.x + ba.w), Math.ceil(bb.x + bb.w));
  const iy1 = Math.min(Math.ceil(ba.y + ba.h), Math.ceil(bb.y + bb.h));
  if (ix0 >= ix1 || iy0 >= iy1) return false;

  for (let py = iy0; py < iy1; py++) {
    for (let px = ix0; px < ix1; px++) {
      if (spriteHasPixelAt(a, mem, px, py) && spriteHasPixelAt(b, mem, px, py)) {
        return true;
      }
    }
  }
  return false;
}

const TARGET_FPS = 60;
const VEL_DIVISOR = 64; // fixed-point: vx=64 → 1 px/frame → 60 px/sec

/** Update sprite positions. dt is seconds since last frame. */
export function updateSprites(table: SpriteTable, walls: WallTable, dt: number, mem?: Uint8Array): void {
  const scale = dt * TARGET_FPS; // 1.0 at 60fps, 2.0 at 30fps, etc.

  // Phase 1: Clear hit state, apply velocity
  for (const spr of table) {
    if (!spr.active) continue;
    spr.hitFlags = 0;
    spr.hitIndex = 0;
    spr._vecRaster = null;
    spr._vecBounds = null;
    spr.x += (spr.vx / VEL_DIVISOR) * scale;
    spr.y += (spr.vy / VEL_DIVISOR) * scale;
    spr.angle = ((spr.angle + (spr.rotSpeed / VEL_DIVISOR) * scale) % 256 + 256) % 256;
  }

  // Phase 2: Wall collisions
  for (const spr of table) {
    if (!spr.active || spr.wallMode === 0) continue;
    for (let wi = 0; wi < walls.length; wi++) {
      const wall = walls[wi]!;
      if (!wall.active) continue;
      if (!aabbOverlap(spr.x, spr.y, spr.width, spr.height, wall.x, wall.y, wall.width, wall.height)) continue;

      const overlapLeft = (spr.x + spr.width) - wall.x;
      const overlapRight = (wall.x + wall.width) - spr.x;
      const overlapTop = (spr.y + spr.height) - wall.y;
      const overlapBottom = (wall.y + wall.height) - spr.y;

      applyCollisionMode(spr.wallMode, spr, overlapLeft, overlapRight, overlapTop, overlapBottom);
      spr.hitFlags |= 2;
      spr.hitIndex = wi;
      if (!spr.active) break; // destroyed
    }
  }

  // Phase 3: Sprite-sprite collisions
  for (let i = 0; i < table.length; i++) {
    const a = table[i]!;
    if (!a.active) continue;
    for (let j = i + 1; j < table.length; j++) {
      const b = table[j]!;
      if (!b.active) continue;
      if (a.spriteMode === 0 && b.spriteMode === 0) continue;
      if (!(a.collGroup & b.collMask) && !(b.collGroup & a.collMask)) continue;

      // AABB pre-check (use rotated bounding boxes when needed)
      const aRot = (Math.round(a.angle) & 0xff) !== 0;
      const bRot = (Math.round(b.angle) & 0xff) !== 0;
      if (aRot || bRot) {
        const ba = sprBBox(a);
        const bb = sprBBox(b);
        if (!aabbOverlap(ba.x, ba.y, ba.w, ba.h, bb.x, bb.y, bb.w, bb.h)) continue;
        // Pixel-perfect test for rotated sprites
        if (mem && !pixelOverlap(a, b, mem)) continue;
      } else {
        if (!aabbOverlap(a.x, a.y, a.width, a.height, b.x, b.y, b.width, b.height)) continue;
      }

      const overlapLeft = (a.x + a.width) - b.x;
      const overlapRight = (b.x + b.width) - a.x;
      const overlapTop = (a.y + a.height) - b.y;
      const overlapBottom = (b.y + b.height) - a.y;

      // Each sprite applies its own response independently
      if (a.spriteMode !== 0) {
        applyCollisionMode(a.spriteMode, a, overlapLeft, overlapRight, overlapTop, overlapBottom);
        a.hitFlags |= 4;
        a.hitIndex = j;
      }
      if (b.spriteMode !== 0) {
        // Overlaps are inverted for b's perspective
        applyCollisionMode(b.spriteMode, b, overlapRight, overlapLeft, overlapBottom, overlapTop);
        b.hitFlags |= 4;
        b.hitIndex = i;
      }
    }
  }

  // Phase 4: Screen edge behavior
  for (const spr of table) {
    if (!spr.active) continue;
    applyEdgeBehavior(spr);
  }
}

const CALLBACK_CYCLE_BUDGET = 5000;

export function runHitCallbacks(sprites: SpriteTable, vm: VMState, syscallHandler: SyscallHandler): void {
  const savedPC = vm.pc;
  for (let i = 0; i < sprites.length; i++) {
    const spr = sprites[i]!;
    if (spr.hitFlags === 0 || spr.hitCallback === 0) continue;

    // Push slot arg, then return address (mimics CALL convention)
    push(vm, i);
    push(vm, savedPC);
    vm.pc = spr.hitCallback;

    // Run until RET restores PC to savedPC
    let budget = CALLBACK_CYCLE_BUDGET;
    while (budget > 0 && vm.pc !== savedPC && !vm.halted) {
      step(vm, syscallHandler);
      budget--;
    }
    if (budget === 0 && vm.pc !== savedPC) {
      console.warn(`Hit callback for sprite ${i} exceeded cycle budget`);
      vm.pc = savedPC;
    }
  }
}

/** Decode a signed 4.4 fixed-point byte to a value scaled by 256 (for fixed-point math). */
function decode44(byte: number): number {
  // Signed: if bit 7 set, value is negative (two's complement over 8 bits)
  const signed = byte >= 128 ? byte - 256 : byte;
  // 4.4 → multiply by 16 to get integer-pixel ×256
  return signed * 16;
}

/** Draw a vector sprite (line segments) to the framebuffer. */
function drawVectorSprite(fb: Framebuffer, spr: Sprite, mem: Uint8Array): void {
  const n = mem[spr.addr]!;
  const angle = Math.round(spr.angle) & 0xff;
  const cosA = cos256(angle);
  const sinA = sin256(angle);
  const cx = Math.round(spr.x) + (spr.width >> 1);
  const cy = Math.round(spr.y) + (spr.height >> 1);

  for (let i = 0; i < n; i++) {
    const base = spr.addr + 1 + i * 4;
    const rx1 = decode44(mem[base]!);
    const ry1 = decode44(mem[base + 1]!);
    const rx2 = decode44(mem[base + 2]!);
    const ry2 = decode44(mem[base + 3]!);

    // Rotate and translate to screen coords
    // decode44 produces ×256, sin256/cos256 produce ×256, product is ×65536
    const sx1 = cx + ((rx1 * cosA - ry1 * sinA) >> 16);
    const sy1 = cy + ((rx1 * sinA + ry1 * cosA) >> 16);
    const sx2 = cx + ((rx2 * cosA - ry2 * sinA) >> 16);
    const sy2 = cy + ((rx2 * sinA + ry2 * cosA) >> 16);

    drawLine(fb, sx1, sy1, sx2, sy2);
  }
}

/** Rasterize vector sprite into a small temporary buffer for collision checks. */
function rasterizeVector(spr: Sprite, mem: Uint8Array): void {
  const n = mem[spr.addr]!;
  const angle = Math.round(spr.angle) & 0xff;
  const cosA = cos256(angle);
  const sinA = sin256(angle);
  const cx = Math.round(spr.x) + (spr.width >> 1);
  const cy = Math.round(spr.y) + (spr.height >> 1);

  // First pass: find bounding box of all transformed endpoints
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    const base = spr.addr + 1 + i * 4;
    for (let j = 0; j < 4; j += 2) {
      const rx = decode44(mem[base + j]!);
      const ry = decode44(mem[base + j + 1]!);
      const sx = cx + ((rx * cosA - ry * sinA) >> 16);
      const sy = cy + ((rx * sinA + ry * cosA) >> 16);
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }
  }

  if (!isFinite(minX)) {
    spr._vecBounds = { ox: 0, oy: 0, w: 0, h: 0 };
    spr._vecRaster = new Uint8Array(0);
    return;
  }

  const ox = Math.floor(minX);
  const oy = Math.floor(minY);
  const w = Math.ceil(maxX) - ox + 1;
  const h = Math.ceil(maxY) - oy + 1;
  const bytesPerRow = Math.ceil(w / 8);
  const raster = new Uint8Array(bytesPerRow * h);

  // Helper to set a pixel in the raster buffer
  function rasterSet(px: number, py: number): void {
    const lx = px - ox;
    const ly = py - oy;
    if (lx < 0 || lx >= w || ly < 0 || ly >= h) return;
    const byteIdx = ly * bytesPerRow + (lx >>> 3);
    const bitOff = 7 - (lx & 7);
    raster[byteIdx]! |= 1 << bitOff;
  }

  // Second pass: rasterize each line segment using Bresenham
  for (let i = 0; i < n; i++) {
    const base = spr.addr + 1 + i * 4;
    const rx1 = decode44(mem[base]!);
    const ry1 = decode44(mem[base + 1]!);
    const rx2 = decode44(mem[base + 2]!);
    const ry2 = decode44(mem[base + 3]!);

    let x0 = cx + ((rx1 * cosA - ry1 * sinA) >> 16);
    let y0 = cy + ((rx1 * sinA + ry1 * cosA) >> 16);
    const x1 = cx + ((rx2 * cosA - ry2 * sinA) >> 16);
    const y1 = cy + ((rx2 * sinA + ry2 * cosA) >> 16);

    // Bresenham line
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    for (;;) {
      rasterSet(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  spr._vecBounds = { ox, oy, w, h };
  spr._vecRaster = raster;
}

export function drawSprites(
  table: SpriteTable,
  mem: Uint8Array,
  fb: Framebuffer,
): void {
  for (const spr of table) {
    if (!spr.active) continue;
    if (spr.flags & 4) {
      drawVectorSprite(fb, spr, mem);
      continue;
    }
    const bytesPerRow = Math.ceil(spr.width / 8);
    const byteCount = bytesPerRow * spr.height;
    const spriteData = mem.slice(spr.addr, spr.addr + byteCount);
    drawSpriteRotated(
      fb,
      spriteData,
      Math.round(spr.x),
      Math.round(spr.y),
      spr.flags,
      spr.width,
      spr.height,
      Math.round(spr.angle),
    );
  }
}
