import { createVM, resetVM, type VMState } from "../vm/vm.ts";
import { loadProgram } from "../vm/memory.ts";
import { createFramebuffer, renderToCanvas, SCREEN_W, SCREEN_H, type Framebuffer } from "../display/display.ts";
import {
  createInput,
  bindInput,
  pressInput,
  releaseInput,
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
import {
  createSyscallContext,
  createWebSyscallHandler,
  type SyscallContext,
} from "../syscalls/web-syscalls.ts";
import { resetSpriteTable, resetWallTable } from "../sprites/sprites.ts";
import { createRuntime, run, stop, stepOne, type RuntimeState } from "../runtime/runtime.ts";
import { assemble, isError, type AssemblerResult } from "../assembler/assembler.ts";
import { compile, isCompileError } from "../basic/compiler.ts";
import { DEMOS, type Demo } from "../demos/demos.ts";

// Re-export for consumers
export { SCREEN_W, SCREEN_H, DEMOS };
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

function buildStackText(sp: number, stack: Uint16Array): string {
  if (sp === 0) return "empty";
  const lines: string[] = [];
  for (let i = sp - 1; i >= 0; i--) {
    lines.push(`[${i}] ${stack[i]!.toString(16).padStart(4, "0")}`);
  }
  return lines.join("\n");
}

function formatHexDump(memory: Uint8Array, start: number, len: number): string {
  const lines: string[] = [];
  for (let off = 0; off < len; off += 16) {
    const addr = start + off;
    const rowLen = Math.min(16, len - off);
    const addrStr = (addr & 0xffff).toString(16).padStart(4, "0");
    const hexParts: string[] = [];
    let ascii = "";
    for (let j = 0; j < rowLen; j++) {
      const byte = memory[addr + j]!;
      hexParts.push(byte.toString(16).padStart(2, "0"));
      ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
      if (j === 7) hexParts.push("");
    }
    lines.push(`${addrStr}: ${hexParts.join(" ").padEnd(49)}| ${ascii}`);
  }
  return lines.join("\n");
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

export function createEngine(
  canvasCtx: CanvasRenderingContext2D,
  initialScale: number,
  onUpdate: (update: StatusUpdate) => void,
): Engine {
  const vm: VMState = createVM();
  const fb: Framebuffer = createFramebuffer();
  const input: InputState = createInput();
  const syscallCtx: SyscallContext = createSyscallContext(fb, input);
  const syscallHandler = createWebSyscallHandler(syscallCtx);

  let lastBytecode: Uint8Array | null = null;
  let currentError: string | null = null;

  const cleanupInput = bindInput(input);

  function getStatus(): EngineStatus {
    return {
      pc: vm.pc.toString(16).padStart(4, "0"),
      sp: String(vm.sp),
      tos: vm.sp > 0 ? String(vm.stack[vm.sp - 1]) : "\u2014",
      state: rt.running ? "running" : vm.halted ? "halted" : "idle",
      cycles: String(vm.cycles),
      fps: rt.fps,
    };
  }

  function emitUpdate(): void {
    onUpdate({
      status: getStatus(),
      stackText: rt.running ? "" : buildStackText(vm.sp, vm.stack),
      error: currentError,
    });
  }

  const rt: RuntimeState = createRuntime(vm, fb, syscallCtx, syscallHandler, canvasCtx, initialScale, () => {
    currentError = null;
    emitUpdate();
  });

  function doAssemble(source: string): boolean {
    currentError = null;
    const result = assembleSource(source);
    if (typeof result === "string") {
      currentError = result;
      emitUpdate();
      return false;
    }
    lastBytecode = result.bytecode;
    resetVM(vm);
    resetSpriteTable(syscallCtx.sprites);
    resetWallTable(syscallCtx.walls);
    loadProgram(vm.memory, result.bytecode);
    renderToCanvas(fb, canvasCtx, rt.scale);
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
      if (isNaN(addr) || isNaN(len) || addr < 0 || addr >= vm.memory.length) {
        return `Invalid address: ${parts[1]}`;
      }
      const clampedLen = Math.min(len, vm.memory.length - addr);
      return formatHexDump(vm.memory, addr, clampedLen);
    } else if (cmd === "w" && parts.length >= 3) {
      const addr = parseInt(parts[1]!, 16);
      if (isNaN(addr) || addr < 0 || addr >= vm.memory.length) {
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
      for (let i = 0; i < bytes.length && addr + i < vm.memory.length; i++) {
        vm.memory[addr + i] = bytes[i]!;
      }
      return (
        `Wrote ${bytes.length} byte(s) at ${addr.toString(16).padStart(4, "0")}\n` +
        formatHexDump(vm.memory, addr, Math.min(16, vm.memory.length - addr))
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
      if (lastBytecode === null) {
        // caller should assemble first
        return;
      }
      if (breakAtStart) {
        emitUpdate();
        return;
      }
      try {
        run(rt);
      } catch (e) {
        currentError = (e as Error).message;
        emitUpdate();
      }
    },

    stop() {
      stop(rt);
    },

    step(source: string) {
      currentError = null;
      if (lastBytecode === null) {
        if (!doAssemble(source)) return;
      }
      try {
        stepOne(rt);
      } catch (e) {
        currentError = (e as Error).message;
        emitUpdate();
      }
    },

    reset() {
      stop(rt);
      resetVM(vm);
      resetSpriteTable(syscallCtx.sprites);
      resetWallTable(syscallCtx.walls);
      if (lastBytecode) {
        loadProgram(vm.memory, lastBytecode);
      }
      renderToCanvas(fb, canvasCtx, rt.scale);
      currentError = null;
      emitUpdate();
    },

    loadDemo(index: number): string | null {
      const demo = DEMOS[index];
      if (!demo) return null;
      stop(rt);
      currentError = null;
      const result = assembleSource(demo.source);
      if (typeof result === "string") {
        currentError = result;
        emitUpdate();
        return demo.source;
      }
      lastBytecode = result.bytecode;
      resetVM(vm);
      resetSpriteTable(syscallCtx.sprites);
      resetWallTable(syscallCtx.walls);
      loadProgram(vm.memory, result.bytecode);
      renderToCanvas(fb, canvasCtx, rt.scale);
      emitUpdate();
      return demo.source;
    },

    loadSource() {
      stop(rt);
      lastBytecode = null;
      currentError = null;
      emitUpdate();
    },

    handleMemCommand,

    setScale(scale: number) {
      const canvas = canvasCtx.canvas;
      canvas.width = SCREEN_W * scale;
      canvas.height = SCREEN_H * scale;
      rt.scale = scale;
      renderToCanvas(fb, canvasCtx, scale);
    },

    pressInput(bit: number) {
      pressInput(input, bit);
    },

    releaseInput(bit: number) {
      releaseInput(input, bit);
    },

    cleanup() {
      stop(rt);
      cleanupInput();
    },
  };
}
