import { loadWasmVM, type WasmVM } from "../wasm/wasm-vm.ts";
import {
  createInput,
  bindInput,
  pressInput,
  releaseInput,
  consumeInputWord,
  INPUT_UP,
  INPUT_DOWN,
  INPUT_LEFT,
  INPUT_RIGHT,
  INPUT_BTN,
  INPUT_ENC_CW,
  INPUT_ENC_CCW,
  INPUT_ENC_BTN,
  type InputState,
} from "../input/input.ts";
import { assemble, isError, type AssemblerResult } from "../assembler/assembler.ts";
import { compile, isCompileError } from "../basic/compiler.ts";
import { DEMOS, type Demo } from "../demos/demos.ts";

export const SCREEN_W = 128;
export const SCREEN_H = 64;

// Re-export for consumers
export { DEMOS };
export type { Demo };

export interface EngineStatus {
  pc: string;
  sp: string;
  tos: string;
  state: string;
  cycles: string;
  fps: number;
}

export interface StatusUpdate {
  status: EngineStatus;
  stackText: string;
  error: string | null;
}

export interface Engine {
  assemble(source: string): void;
  run(breakAtStart: boolean): void;
  stop(): void;
  step(source: string): void;
  reset(): void;
  loadDemo(index: number): string | null;
  loadSource(): void;
  handleMemCommand(cmd: string): string;
  setScale(scale: number): void;
  pressInput(bit: number): void;
  releaseInput(bit: number): void;
  cleanup(): void;
}

export const INPUT_NAME_TO_BIT: Record<string, number> = {
  up: INPUT_UP,
  down: INPUT_DOWN,
  left: INPUT_LEFT,
  right: INPUT_RIGHT,
  btn: INPUT_BTN,
  enc_cw: INPUT_ENC_CW,
  enc_ccw: INPUT_ENC_CCW,
  enc_btn: INPUT_ENC_BTN,
};

const TARGET_FPS = 60;
const FRAME_DT = 1 / TARGET_FPS;

function buildStackText(vm: WasmVM): string {
  const sp = vm.getSP();
  if (sp === 0) return "empty";
  const lines: string[] = [];
  for (let i = sp - 1; i >= 0; i--) {
    lines.push(`[${i}] ${vm.getStackValue(i).toString(16).padStart(4, "0")}`);
  }
  return lines.join("\n");
}

function formatHexDump(vm: WasmVM, start: number, len: number): string {
  const lines: string[] = [];
  for (let off = 0; off < len; off += 16) {
    const addr = start + off;
    const rowLen = Math.min(16, len - off);
    const addrStr = (addr & 0xffff).toString(16).padStart(4, "0");
    const hexParts: string[] = [];
    let ascii = "";
    for (let j = 0; j < rowLen; j++) {
      const byte = vm.readMem(addr + j);
      hexParts.push(byte.toString(16).padStart(2, "0"));
      ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
      if (j === 7) hexParts.push("");
    }
    lines.push(`${addrStr}: ${hexParts.join(" ").padEnd(49)}| ${ascii}`);
  }
  return lines.join("\n");
}

/** Render framebuffer (1024-byte packed 1-bit) onto an HTML canvas. */
function renderToCanvas(
  fbData: Uint8Array,
  ctx: CanvasRenderingContext2D,
  scale: number,
): void {
  const imgData = ctx.createImageData(SCREEN_W * scale, SCREEN_H * scale);
  const pixels = imgData.data;

  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) {
      const bitIndex = y * SCREEN_W + x;
      const byteIndex = bitIndex >>> 3;
      const bitOffset = 7 - (bitIndex & 7);
      const on = (fbData[byteIndex]! >>> bitOffset) & 1;
      const brightness = on ? 255 : 0;

      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const px = x * scale + sx;
          const py = y * scale + sy;
          const i = (py * SCREEN_W * scale + px) * 4;
          pixels[i] = brightness;
          pixels[i + 1] = brightness;
          pixels[i + 2] = brightness;
          pixels[i + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/** Detect whether source is BASIC or ASM from content. */
export function detectLang(source: string): "asm" | "basic" {
  if (/^\s*;/m.test(source)) return "asm";
  if (/^\s*\./m.test(source)) return "asm";
  if (/^\s*(PUSH8|PUSH16|SYSCALL|JMP|JZ|JNZ|HALT|DUP|SWAP|POP)\b/m.test(source)) return "asm";
  if (/^\s*'/m.test(source)) return "basic";
  if (/^\s*(DATA|DIM|SUB|END\s+(SUB|IF|CALLBACK)|DO\b|LOOP\b|CALLBACK\b)/m.test(source)) return "basic";
  return "asm";
}

/** Compile BASIC (if detected), then assemble. Returns result or error string. */
export function assembleSource(source: string): AssemblerResult | string {
  let asmSource = source;
  if (detectLang(source) === "basic") {
    const compiled = compile(source);
    if (isCompileError(compiled)) {
      return `[${compiled.phase}] Line ${compiled.line}: ${compiled.message}`;
    }
    asmSource = compiled;
  }
  const result = assemble(asmSource);
  if (isError(result)) {
    return `Line ${result.line}: ${result.message}`;
  }
  return result;
}

export async function createEngine(
  canvasCtx: CanvasRenderingContext2D,
  initialScale: number,
  onUpdate: (update: StatusUpdate) => void,
): Promise<Engine> {
  const vm: WasmVM = await loadWasmVM();
  const input: InputState = createInput();

  let lastBytecode: Uint8Array | null = null;
  let currentError: string | null = null;
  let scale = initialScale;
  let running = false;
  let animFrame: number | null = null;
  let lastFrameTime = 0;
  let accumulator = 0;
  let needsClear = true;
  let fps = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let startTime = 0;

  const cleanupInput = bindInput(input);

  function getStatus(): EngineStatus {
    return {
      pc: vm.getPC().toString(16).padStart(4, "0"),
      sp: String(vm.getSP()),
      tos: vm.getSP() > 0 ? String(vm.getTOS()) : "\u2014",
      state: running ? "running" : vm.isHalted() ? "halted" : "idle",
      cycles: String(vm.getCycles()),
      fps,
    };
  }

  function emitUpdate(): void {
    onUpdate({
      status: getStatus(),
      stackText: running ? "" : buildStackText(vm),
      error: currentError,
    });
  }

  function render(): void {
    renderToCanvas(vm.getFramebuffer(), canvasCtx, scale);
  }

  /** Execute one game frame. Returns false on HALT. */
  function execGameFrame(): boolean {
    vm.setInput(consumeInputWord(input));
    vm.setElapsedMs(((performance.now() - startTime) & 0xffff) >>> 0);
    return vm.execFrame();
  }

  /** rAF callback — accumulator-based fixed timestep locked to 60fps. */
  function runFrame(): void {
    if (!running) return;

    animFrame = requestAnimationFrame(runFrame);

    const now = performance.now() / 1000;
    const elapsed = now - lastFrameTime;
    lastFrameTime = now;

    // Clamp elapsed to avoid spiral of death after tab-away
    accumulator += Math.min(elapsed, FRAME_DT * 4);

    // Update FPS counter (~once per second)
    fpsAccum += elapsed;
    if (fpsAccum >= 1) {
      fps = fpsFrames / fpsAccum;
      fpsFrames = 0;
      fpsAccum = 0;
    }

    if (accumulator < FRAME_DT) return;

    // Run game frames to catch up, cap at 4
    let frames = 0;
    while (accumulator >= FRAME_DT && frames < 4) {
      accumulator -= FRAME_DT;
      fpsFrames++;
      frames++;

      try {
        if (!execGameFrame()) {
          running = false;
          render();
          emitUpdate();
          cancelAnimationFrame(animFrame!);
          animFrame = null;
          return;
        }
      } catch (e) {
        running = false;
        currentError = (e as Error).message;
        emitUpdate();
        cancelAnimationFrame(animFrame!);
        animFrame = null;
        return;
      }
    }

    render();
    emitUpdate();
  }

  function doAssemble(source: string): boolean {
    currentError = null;
    const result = assembleSource(source);
    if (typeof result === "string") {
      currentError = result;
      emitUpdate();
      return false;
    }
    lastBytecode = result.bytecode;
    vm.reset();
    vm.loadProgram(result.bytecode);
    render();
    emitUpdate();
    return true;
  }

  function handleMemCommand(cmdStr: string): string {
    const parts = cmdStr.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    if (cmd === "r" && parts.length >= 2) {
      let addr: number;
      let len: number;
      const rangeMatch = parts[1]!.match(/^([0-9a-f]+)-([0-9a-f]+)$/i);
      if (rangeMatch) {
        addr = parseInt(rangeMatch[1]!, 16);
        const end = parseInt(rangeMatch[2]!, 16);
        if (isNaN(addr) || isNaN(end) || end < addr) {
          return `Invalid range: ${parts[1]}`;
        }
        len = end - addr + 1;
      } else {
        addr = parseInt(parts[1]!, 16);
        len = parts[2] ? parseInt(parts[2]!, 10) : 16;
      }
      if (isNaN(addr) || isNaN(len) || addr < 0 || addr >= 65536) {
        return `Invalid address: ${parts[1]}`;
      }
      const clampedLen = Math.min(len, 65536 - addr);
      return formatHexDump(vm, addr, clampedLen);
    } else if (cmd === "w" && parts.length >= 3) {
      const addr = parseInt(parts[1]!, 16);
      if (isNaN(addr) || addr < 0 || addr >= 65536) {
        return `Invalid address: ${parts[1]}`;
      }
      const bytes: number[] = [];
      for (let i = 2; i < parts.length; i++) {
        const b = parseInt(parts[i]!, 16);
        if (isNaN(b) || b < 0 || b > 0xff) {
          return `Invalid byte: ${parts[i]}`;
        }
        bytes.push(b);
      }
      for (let i = 0; i < bytes.length && addr + i < 65536; i++) {
        vm.writeMem(addr + i, bytes[i]!);
      }
      return (
        `Wrote ${bytes.length} byte(s) at ${addr.toString(16).padStart(4, "0")}\n` +
        formatHexDump(vm, addr, Math.min(16, 65536 - addr))
      );
    } else {
      return "Commands:\n  r ADDR [LEN]  \u2014 read LEN bytes (default 16) at hex ADDR\n  r ADDR-ADDR   \u2014 read hex address range (inclusive)\n  w ADDR XX ..  \u2014 write hex bytes at hex ADDR";
    }
  }

  return {
    assemble(source: string) {
      doAssemble(source);
    },

    run(breakAtStart: boolean) {
      currentError = null;
      if (lastBytecode === null) return;
      if (breakAtStart) {
        emitUpdate();
        return;
      }
      if (vm.isHalted() || running) return;
      running = true;
      startTime = performance.now();
      lastFrameTime = performance.now() / 1000;
      accumulator = FRAME_DT; // trigger first frame immediately
      emitUpdate();
      animFrame = requestAnimationFrame(runFrame);
    },

    stop() {
      running = false;
      needsClear = true;
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      emitUpdate();
    },

    step(source: string) {
      currentError = null;
      if (lastBytecode === null) {
        if (!doAssemble(source)) return;
      }
      if (vm.isHalted()) return;
      if (needsClear) {
        vm.clearFB();
        needsClear = false;
      }
      vm.setInput(consumeInputWord(input));
      vm.setElapsedMs(((performance.now() - startTime) & 0xffff) >>> 0);
      vm.step();
      if (vm.isYielded()) {
        vm.doSpriteUpdate();
        render();
        needsClear = true;
      }
      emitUpdate();
    },

    reset() {
      running = false;
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      vm.reset();
      if (lastBytecode) {
        vm.loadProgram(lastBytecode);
      }
      render();
      currentError = null;
      emitUpdate();
    },

    loadDemo(index: number): string | null {
      const demo = DEMOS[index];
      if (!demo) return null;
      running = false;
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      currentError = null;
      const result = assembleSource(demo.source);
      if (typeof result === "string") {
        currentError = result;
        emitUpdate();
        return demo.source;
      }
      lastBytecode = result.bytecode;
      vm.reset();
      vm.loadProgram(result.bytecode);
      render();
      emitUpdate();
      return demo.source;
    },

    loadSource() {
      running = false;
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      lastBytecode = null;
      currentError = null;
      emitUpdate();
    },

    handleMemCommand,

    setScale(newScale: number) {
      const canvas = canvasCtx.canvas;
      canvas.width = SCREEN_W * newScale;
      canvas.height = SCREEN_H * newScale;
      scale = newScale;
      render();
    },

    pressInput(bit: number) {
      pressInput(input, bit);
    },

    releaseInput(bit: number) {
      releaseInput(input, bit);
    },

    cleanup() {
      running = false;
      if (animFrame !== null) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
      }
      cleanupInput();
    },
  };
}
