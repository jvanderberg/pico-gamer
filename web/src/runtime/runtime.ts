import { step, type VMState } from "../vm/vm.ts";
import { clearFB, renderToCanvas, type Framebuffer } from "../display/display.ts";
import type { SyscallContext } from "../syscalls/web-syscalls.ts";
import type { SyscallHandler } from "../syscalls/interface.ts";
import { updateSprites, drawSprites, runHitCallbacks } from "../sprites/sprites.ts";

const CYCLES_PER_FRAME = 50_000;
const MAX_DT = 1 / 15; // cap dt to prevent huge jumps (e.g. tab was backgrounded)
const STEP_DT = 1 / 60; // fixed dt for single-step mode

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
  needsClear: boolean;
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
    needsClear: true,
    onStatusUpdate,
  };
}

/** Run VM instructions until YIELD, HALT, or cycle budget exhausted. */
function runFrame(rt: RuntimeState): void {
  if (!rt.running) return;

  const now = performance.now() / 1000;
  const dt = Math.min(now - rt.lastFrameTime, MAX_DT);
  rt.lastFrameTime = now;

  clearFB(rt.fb);
  rt.syscallCtx.yieldRequested = false;
  let cycles = 0;

  try {
    while (cycles < CYCLES_PER_FRAME && !rt.syscallCtx.yieldRequested) {
      if (!step(rt.vm, rt.syscallHandler)) {
        // HALT — do sprite work so sprites render on final frame
        rt.running = false;
        updateSprites(rt.syscallCtx.sprites, rt.syscallCtx.walls, dt, rt.vm.memory);
        runHitCallbacks(rt.syscallCtx.sprites, rt.vm, rt.syscallHandler);
        drawSprites(rt.syscallCtx.sprites, rt.vm.memory, rt.fb);
        renderToCanvas(rt.fb, rt.canvasCtx, rt.scale);
        rt.onStatusUpdate();
        return;
      }
      cycles++;
    }
  } catch (e) {
    rt.running = false;
    rt.onStatusUpdate();
    throw e;
  }

  updateSprites(rt.syscallCtx.sprites, rt.syscallCtx.walls, dt, rt.vm.memory);
  runHitCallbacks(rt.syscallCtx.sprites, rt.vm, rt.syscallHandler);
  drawSprites(rt.syscallCtx.sprites, rt.vm.memory, rt.fb);
  renderToCanvas(rt.fb, rt.canvasCtx, rt.scale);
  rt.onStatusUpdate();

  if (rt.running) {
    rt.animFrame = requestAnimationFrame(() => runFrame(rt));
  }
}

export function run(rt: RuntimeState): void {
  if (rt.vm.halted || rt.running) return;
  rt.running = true;
  rt.lastFrameTime = performance.now() / 1000;
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
