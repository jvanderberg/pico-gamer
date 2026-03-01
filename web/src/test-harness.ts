import { createVM, resetVM, step, type VMState } from "./vm/vm.ts";
import { loadProgram, readU8, readU16 } from "./vm/memory.ts";
import {
  createFramebuffer,
  clearFB,
  getPixel,
  type Framebuffer,
} from "./display/display.ts";
import {
  createSpriteTable,
  createWallTable,
  resetSpriteTable,
  resetWallTable,
  updateSprites,
  drawSprites,
  runHitCallbacks,
  type SpriteTable,
  type WallTable,
} from "./sprites/sprites.ts";
import { createInput, type InputState } from "./input/input.ts";
import { createWebSyscallHandler, type SyscallContext } from "./syscalls/web-syscalls.ts";
import { assemble, isError } from "./assembler/assembler.ts";

const CYCLES_PER_FRAME = 50_000;

export interface Harness {
  vm: VMState;
  fb: Framebuffer;
  sprites: SpriteTable;
  walls: WallTable;
  input: InputState;
  labels: Record<string, number>;
  load(source: string): void;
  frame(): void;
  frames(n: number): void;
  pixel(x: number, y: number): number;
  read16(addr: number): number;
  read8(addr: number): number;
}

export function createHarness(): Harness {
  const vm = createVM();
  const fb = createFramebuffer();
  const input = createInput();
  const sprites = createSpriteTable();
  const walls = createWallTable();
  let currentLabels: Record<string, number> = {};

  const ctx: SyscallContext = {
    fb,
    input,
    sprites,
    walls,
    yieldRequested: false,
    startTime: 0,
  };
  const syscallHandler = createWebSyscallHandler(ctx);

  function load(source: string): void {
    const result = assemble(source);
    if (isError(result)) {
      throw new Error(
        `Assembly error on line ${result.line}: ${result.message}`,
      );
    }
    resetVM(vm);
    resetSpriteTable(sprites);
    resetWallTable(walls);
    ctx.yieldRequested = false;
    loadProgram(vm.memory, result.bytecode);
    currentLabels = result.labels;
  }

  function frame(): void {
    clearFB(fb);
    ctx.yieldRequested = false;
    let cycles = 0;
    while (cycles < CYCLES_PER_FRAME && !ctx.yieldRequested) {
      if (!step(vm, syscallHandler)) {
        updateSprites(sprites, walls, 1 / 60, vm.memory);
        runHitCallbacks(sprites, vm, syscallHandler);
        drawSprites(sprites, vm.memory, fb);
        return;
      }
      cycles++;
    }
    updateSprites(sprites, walls, 1 / 60, vm.memory);
    runHitCallbacks(sprites, vm, syscallHandler);
    drawSprites(sprites, vm.memory, fb);
  }

  function frames(n: number): void {
    for (let i = 0; i < n; i++) {
      frame();
    }
  }

  return {
    vm,
    fb,
    sprites,
    walls,
    input,
    get labels() { return currentLabels; },
    load,
    frame,
    frames,
    pixel: (x, y) => getPixel(fb, x, y),
    read16: (addr) => readU16(vm.memory, addr),
    read8: (addr) => readU8(vm.memory, addr),
  };
}
