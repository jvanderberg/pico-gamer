import type { SyscallHandler } from "./interface.ts";
import type { VMState } from "../vm/vm.ts";
import { pop, push } from "../vm/vm.ts";
import {
  clearFB,
  setPixel,
  drawLine,
  drawRect,
  drawSprite,
  blit,
  type Framebuffer,
} from "../display/display.ts";
import { drawText, FONT_SM, FONT_LG } from "../display/font.ts";
import type { InputState } from "../input/input.ts";
import {
  createSpriteTable,
  createWallTable,
  type SpriteTable,
  type WallTable,
} from "../sprites/sprites.ts";

export const Sys = {
  CLEAR: 0x00,
  PIXEL: 0x01,
  LINE: 0x02,
  RECT: 0x03,
  SPRITE: 0x04,
  BLIT: 0x05,
  YIELD: 0x06,
  TILESET: 0x07,
  TILEMAP: 0x08,
  SCROLL: 0x09,
  SPRITE_OVER: 0x0a,
  INPUT: 0x10,
  RAND: 0x20,
  TIME: 0x21,
  SIN: 0x22,
  COS: 0x23,
  TEXT_SM: 0x24,
  TEXT_LG: 0x25,
  SPR_SET: 0x40,
  SPR_POS: 0x41,
  SPR_VEL: 0x42,
  SPR_GET: 0x43,
  SPR_OFF: 0x44,
  SPR_EDGE: 0x45,
  SPR_WALL: 0x46,
  SPR_COLL: 0x47,
  WALL_SET: 0x48,
  WALL_OFF: 0x49,
  SPR_HIT: 0x4a,
  SPR_GROUP: 0x4b,
  SPR_ON_HIT: 0x4c,
  SPR_ROT: 0x4d,
  SPR_GETROT: 0x4e,
} as const;

export interface SyscallContext {
  fb: Framebuffer;
  input: InputState;
  sprites: SpriteTable;
  walls: WallTable;
  /** Set to true when SYS_YIELD is called — the runtime checks this to yield. */
  yieldRequested: boolean;
  startTime: number;
}

export function createSyscallContext(
  fb: Framebuffer,
  input: InputState,
): SyscallContext {
  return {
    fb,
    input,
    sprites: createSpriteTable(),
    walls: createWallTable(),
    yieldRequested: false,
    startTime: performance.now(),
  };
}

function toI16(v: number): number {
  return v >= 0x8000 ? v - 0x10000 : v;
}

/** Precomputed 256-byte sin LUT: sin(i * 2*PI/256) * 127, stored as unsigned bytes. */
const SIN_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const v = Math.round(Math.sin((i * 2 * Math.PI) / 256) * 127);
  SIN_TABLE[i] = v & 0xff;
}

function readString(mem: Uint8Array, addr: number): string {
  let s = "";
  for (let i = addr; i < mem.length; i++) {
    const byte = mem[i]!;
    if (byte === 0) break;
    s += String.fromCharCode(byte);
  }
  return s;
}

/** Build a SyscallHandler function bound to the given context. */
export function createWebSyscallHandler(ctx: SyscallContext): SyscallHandler {
  return (id: number, vm: VMState) => {
    switch (id) {
      case Sys.CLEAR:
        clearFB(ctx.fb);
        break;

      case Sys.PIXEL: {
        const color = pop(vm);
        const y = pop(vm);
        const x = pop(vm);
        setPixel(ctx.fb, x, y, color);
        break;
      }

      case Sys.LINE: {
        const x1 = pop(vm);
        const y1 = pop(vm);
        const x0 = pop(vm);
        const y0 = pop(vm);
        drawLine(ctx.fb, x0, y0, x1, y1);
        break;
      }

      case Sys.RECT: {
        const h = pop(vm);
        const w = pop(vm);
        const y = pop(vm);
        const x = pop(vm);
        drawRect(ctx.fb, x, y, w, h);
        break;
      }

      case Sys.SPRITE: {
        const flags = pop(vm);
        const y = pop(vm);
        const x = pop(vm);
        const height = pop(vm);
        const width = pop(vm);
        const id = pop(vm);
        const bytesPerRow = Math.ceil(width / 8);
        const byteCount = bytesPerRow * height;
        const spriteBytes = vm.memory.slice(id, id + byteCount);
        drawSprite(ctx.fb, spriteBytes, x, y, flags, width, height);
        break;
      }

      case Sys.BLIT: {
        const h = pop(vm);
        const w = pop(vm);
        const y = pop(vm);
        const x = pop(vm);
        const srcAddr = pop(vm);
        const byteCount = Math.ceil((w * h) / 8);
        const srcData = vm.memory.slice(srcAddr, srcAddr + byteCount);
        blit(ctx.fb, srcData, x, y, w, h);
        break;
      }

      case Sys.YIELD:
        ctx.yieldRequested = true;
        break;

      case Sys.TILESET:
      case Sys.TILEMAP:
      case Sys.SCROLL:
      case Sys.SPRITE_OVER:
        // Stubs — pop args and discard
        pop(vm);
        break;

      case Sys.INPUT:
        push(vm, ctx.input.bits);
        break;

      case Sys.RAND:
        push(vm, (Math.random() * 0x10000) & 0xffff);
        break;

      case Sys.TIME: {
        const elapsed = (performance.now() - ctx.startTime) & 0xffff;
        push(vm, elapsed);
        break;
      }

      case Sys.SIN: {
        const angle = pop(vm) & 0xff;
        push(vm, SIN_TABLE[angle]);
        break;
      }

      case Sys.COS: {
        const angle = pop(vm) & 0xff;
        push(vm, SIN_TABLE[(angle + 64) & 0xff]);
        break;
      }

      case Sys.TEXT_SM: {
        const y = pop(vm);
        const x = pop(vm);
        const strAddr = pop(vm);
        drawText(ctx.fb, readString(vm.memory, strAddr), x, y, FONT_SM, 3, 5, 4);
        break;
      }

      case Sys.TEXT_LG: {
        const y = pop(vm);
        const x = pop(vm);
        const strAddr = pop(vm);
        drawText(ctx.fb, readString(vm.memory, strAddr), x, y, FONT_LG, 5, 7, 6);
        break;
      }

      case Sys.SPR_SET: {
        const edge = pop(vm);
        const vy = toI16(pop(vm));
        const vx = toI16(pop(vm));
        const flags = pop(vm);
        const y = pop(vm);
        const x = pop(vm);
        const height = pop(vm);
        const width = pop(vm);
        const addr = pop(vm);
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.active = true;
          spr.addr = addr;
          spr.width = width;
          spr.height = height;
          spr.x = x;
          spr.y = y;
          spr.vx = vx;
          spr.vy = vy;
          spr.flags = flags;
          spr.edge = edge;
        }
        break;
      }

      case Sys.SPR_POS: {
        const y = pop(vm);
        const x = pop(vm);
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.x = x;
          spr.y = y;
        }
        break;
      }

      case Sys.SPR_VEL: {
        const vy = toI16(pop(vm));
        const vx = toI16(pop(vm));
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.vx = vx;
          spr.vy = vy;
        }
        break;
      }

      case Sys.SPR_GET: {
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr?.active) {
          push(vm, spr.x & 0xffff);
          push(vm, spr.y & 0xffff);
        } else {
          push(vm, 0);
          push(vm, 0);
        }
        break;
      }

      case Sys.SPR_OFF: {
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.active = false;
        }
        break;
      }

      case Sys.SPR_EDGE: {
        const edge = pop(vm);
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.edge = edge;
        }
        break;
      }

      case Sys.SPR_WALL: {
        const wallMode = pop(vm);
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.wallMode = wallMode;
        }
        break;
      }

      case Sys.SPR_COLL: {
        const spriteMode = pop(vm);
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.spriteMode = spriteMode;
        }
        break;
      }

      case Sys.WALL_SET: {
        const h = pop(vm);
        const w = pop(vm);
        const y = pop(vm);
        const x = pop(vm);
        const slot = pop(vm);
        const wall = ctx.walls[slot];
        if (wall) {
          wall.active = true;
          wall.x = x;
          wall.y = y;
          wall.width = w;
          wall.height = h;
        }
        break;
      }

      case Sys.WALL_OFF: {
        const slot = pop(vm);
        const wall = ctx.walls[slot];
        if (wall) {
          wall.active = false;
        }
        break;
      }

      case Sys.SPR_HIT: {
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          push(vm, (spr.hitIndex << 8) | spr.hitFlags);
        } else {
          push(vm, 0);
        }
        break;
      }

      case Sys.SPR_GROUP: {
        const mask = pop(vm);
        const group = pop(vm);
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.collGroup = group & 0xff;
          spr.collMask = mask & 0xff;
        }
        break;
      }

      case Sys.SPR_ON_HIT: {
        const addr = pop(vm);
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.hitCallback = addr;
        }
        break;
      }

      case Sys.SPR_ROT: {
        const rotSpeed = toI16(pop(vm));
        const angle = pop(vm);
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr) {
          spr.angle = angle & 0xff;
          spr.rotSpeed = rotSpeed;
        }
        break;
      }

      case Sys.SPR_GETROT: {
        const slot = pop(vm);
        const spr = ctx.sprites[slot];
        if (spr?.active) {
          push(vm, Math.round(spr.angle) & 0xff);
        } else {
          push(vm, 0);
        }
        break;
      }

      default:
        // Audio stubs (0x30–0x3F) and anything unknown — NOP
        if (id >= 0x30 && id <= 0x3f) {
          break;
        }
        console.warn(`Unknown syscall 0x${id.toString(16)}`);
    }
  };
}
