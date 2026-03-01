import { step, type VMState } from "../vm/vm.ts";
import { clearFB, renderToCanvas, type Framebuffer } from "../display/display.ts";
import type { SyscallContext } from "../syscalls/web-syscalls.ts";
import type { SyscallHandler } from "../syscalls/interface.ts";
import { updateSprites, drawSprites, runHitCallbacks } from "../sprites/sprites.ts";

const CYCLES_PER_FRAME = 50_000;
const TARGET_FPS = 60;
const FRAME_DT = 1 / TARGET_FPS; // fixed timestep per game frame
const STEP_DT = FRAME_DT; // single-step uses same timestep

export interface RuntimeState {
  vm: VMState;
  fb: Framebuffer;
  syscallCtx: SyscallContext;
  syscallHandler: SyscallHandler;
  canvasCtx: CanvasRenderingContext2D;
  scale: number;
  running: boolean;
  animFrame: number | null;
  lastFrameTime: number;
  accumulator: number;
  needsClear: boolean;
  fps: number;
  fpsAccum: number;
  fpsFrames: number;
  fpsLastUpdate: number;
  onStatusUpdate: () => void;
}

export function createRuntime(
  vm: VMState,
  fb: Framebuffer,
  syscallCtx: SyscallContext,
  syscallHandler: SyscallHandler,
  canvasCtx: CanvasRenderingContext2D,
  scale: number,
  onStatusUpdate: () => void,
): RuntimeState {
  return {
    vm,
    fb,
    syscallCtx,
    syscallHandler,
    canvasCtx,
    scale,
    running: false,
    animFrame: null,
    lastFrameTime: 0,
    accumulator: 0,
    needsClear: true,
    fps: 0,
    fpsAccum: 0,
    fpsFrames: 0,
    fpsLastUpdate: 0,
    onStatusUpdate,
  };
}

/** Execute one game frame (VM + sprites + optional render). Returns false on HALT. */
function execGameFrame(rt: RuntimeState, render: boolean): boolean {
  clearFB(rt.fb);
  rt.syscallCtx.yieldRequested = false;
  let cycles = 0;

  while (cycles < CYCLES_PER_FRAME && !rt.syscallCtx.yieldRequested) {
    if (!step(rt.vm, rt.syscallHandler)) {
      updateSprites(rt.syscallCtx.sprites, rt.syscallCtx.walls, FRAME_DT, rt.vm.memory);
      runHitCallbacks(rt.syscallCtx.sprites, rt.vm, rt.syscallHandler);
      drawSprites(rt.syscallCtx.sprites, rt.vm.memory, rt.fb);
      if (render) renderToCanvas(rt.fb, rt.canvasCtx, rt.scale);
      return false;
    }
    cycles++;
  }

  updateSprites(rt.syscallCtx.sprites, rt.syscallCtx.walls, FRAME_DT, rt.vm.memory);
  runHitCallbacks(rt.syscallCtx.sprites, rt.vm, rt.syscallHandler);
  drawSprites(rt.syscallCtx.sprites, rt.vm.memory, rt.fb);
  if (render) renderToCanvas(rt.fb, rt.canvasCtx, rt.scale);
  return true;
}

/** rAF callback — accumulator-based fixed timestep locked to 60fps. */
function runFrame(rt: RuntimeState): void {
  if (!rt.running) return;

  rt.animFrame = requestAnimationFrame(() => runFrame(rt));

  const now = performance.now() / 1000;
  const elapsed = now - rt.lastFrameTime;
  rt.lastFrameTime = now;

  // Clamp elapsed to avoid spiral of death after tab-away or debugger pause
  rt.accumulator += Math.min(elapsed, FRAME_DT * 4);

  // Update FPS counter (~once per second) based on rAF cadence
  rt.fpsAccum += elapsed;
  if (rt.fpsAccum >= 1) {
    rt.fps = rt.fpsFrames / rt.fpsAccum;
    rt.fpsFrames = 0;
    rt.fpsAccum = 0;
  }

  if (rt.accumulator < FRAME_DT) return;

  // Run game frames to catch up, cap at 4 to avoid spiral of death.
  // Only render the last frame — intermediate frames are never displayed.
  let frames = 0;
  while (rt.accumulator >= FRAME_DT && frames < 4) {
    rt.accumulator -= FRAME_DT;
    rt.fpsFrames++;
    frames++;
    const isLast = rt.accumulator < FRAME_DT || frames >= 4;

    try {
      if (!execGameFrame(rt, isLast)) {
        rt.running = false;
        rt.onStatusUpdate();
        cancelAnimationFrame(rt.animFrame!);
        rt.animFrame = null;
        return;
      }
    } catch (e) {
      rt.running = false;
      rt.onStatusUpdate();
      cancelAnimationFrame(rt.animFrame!);
      rt.animFrame = null;
      throw e;
    }
  }

  rt.onStatusUpdate();
}

export function run(rt: RuntimeState): void {
  if (rt.vm.halted || rt.running) return;
  rt.running = true;
  rt.lastFrameTime = performance.now() / 1000;
  rt.accumulator = FRAME_DT; // trigger first frame immediately
  rt.onStatusUpdate();
  rt.animFrame = requestAnimationFrame(() => runFrame(rt));
}

export function stop(rt: RuntimeState): void {
  rt.running = false;
  rt.needsClear = true;
  if (rt.animFrame !== null) {
    cancelAnimationFrame(rt.animFrame);
    rt.animFrame = null;
  }
  rt.onStatusUpdate();
}

export function stepOne(rt: RuntimeState): void {
  if (rt.vm.halted) return;
  if (rt.needsClear) {
    clearFB(rt.fb);
    rt.needsClear = false;
  }
  try {
    step(rt.vm, rt.syscallHandler);
  } catch (e) {
    rt.onStatusUpdate();
    throw e;
  }
  if (rt.syscallCtx.yieldRequested) {
    rt.syscallCtx.yieldRequested = false;
    updateSprites(rt.syscallCtx.sprites, rt.syscallCtx.walls, STEP_DT, rt.vm.memory);
    runHitCallbacks(rt.syscallCtx.sprites, rt.vm, rt.syscallHandler);
    drawSprites(rt.syscallCtx.sprites, rt.vm.memory, rt.fb);
    renderToCanvas(rt.fb, rt.canvasCtx, rt.scale);
    rt.needsClear = true;
  }
  rt.onStatusUpdate();
}
