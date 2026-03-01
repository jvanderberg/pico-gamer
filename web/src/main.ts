import { createVM, resetVM, type VMState } from "./vm/vm.ts";
import { loadProgram } from "./vm/memory.ts";
import { createFramebuffer, renderToCanvas, SCREEN_W, SCREEN_H } from "./display/display.ts";
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
} from "./input/input.ts";
import {
  createSyscallContext,
  createWebSyscallHandler,
} from "./syscalls/web-syscalls.ts";
import { resetSpriteTable, resetWallTable } from "./sprites/sprites.ts";
import { createRuntime, run, stop, stepOne } from "./runtime/runtime.ts";
import { assemble, isError } from "./assembler/assembler.ts";
import { DEMOS } from "./demos/demos.ts";

// --- DOM elements ---
const canvas = document.getElementById("screen") as HTMLCanvasElement;
const editor = document.getElementById("asm-editor") as HTMLTextAreaElement;
const btnAssemble = document.getElementById("btn-assemble") as HTMLButtonElement;
const btnRun = document.getElementById("btn-run") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnStep = document.getElementById("btn-step") as HTMLButtonElement;
const btnReset = document.getElementById("btn-reset") as HTMLButtonElement;
const chkBreakStart = document.getElementById("chk-break-start") as HTMLInputElement;
const demoContainer = document.getElementById("demo-buttons") as HTMLDivElement;
const errorOutput = document.getElementById("error-output") as HTMLDivElement;
const statusPC = document.getElementById("status-pc") as HTMLElement;
const statusSP = document.getElementById("status-sp") as HTMLElement;
const statusTOS = document.getElementById("status-tos") as HTMLElement;
const statusState = document.getElementById("status-state") as HTMLElement;
const statusCycles = document.getElementById("status-cycles") as HTMLElement;
const stackView = document.getElementById("stack-view") as HTMLPreElement;
const memCmd = document.getElementById("mem-cmd") as HTMLInputElement;
const memOutput = document.getElementById("mem-output") as HTMLPreElement;
const selScale = document.getElementById("sel-scale") as HTMLSelectElement;

// --- Scale canvas ---
let scale = parseInt(selScale.value, 10);
canvas.width = SCREEN_W * scale;
canvas.height = SCREEN_H * scale;
const ctx = canvas.getContext("2d")!;

// --- State ---
const vm: VMState = createVM();
const fb = createFramebuffer();
const input = createInput();
const syscallCtx = createSyscallContext(fb, input);
const syscallHandler = createWebSyscallHandler(syscallCtx);

const rt = createRuntime(vm, fb, syscallCtx, syscallHandler, ctx, scale, updateStatus);

let lastBytecode: Uint8Array | null = null;
let lastPcToLine: Map<number, number> | null = null;

bindInput(input);

// --- Memory monitor command input ---
memCmd.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    handleMemCommand(memCmd.value);
  }
});

// --- Status bar ---
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

function handleMemCommand(cmdStr: string): void {
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
        memOutput.textContent = `Invalid range: ${parts[1]}`;
        return;
      }
      len = end - addr + 1;
    } else {
      addr = parseInt(parts[1]!, 16);
      len = parts[2] ? parseInt(parts[2]!, 10) : 16;
    }
    if (isNaN(addr) || isNaN(len) || addr < 0 || addr >= vm.memory.length) {
      memOutput.textContent = `Invalid address: ${parts[1]}`;
      return;
    }
    const clampedLen = Math.min(len, vm.memory.length - addr);
    memOutput.textContent = formatHexDump(vm.memory, addr, clampedLen);
  } else if (cmd === "w" && parts.length >= 3) {
    const addr = parseInt(parts[1]!, 16);
    if (isNaN(addr) || addr < 0 || addr >= vm.memory.length) {
      memOutput.textContent = `Invalid address: ${parts[1]}`;
      return;
    }
    const bytes: number[] = [];
    for (let i = 2; i < parts.length; i++) {
      const b = parseInt(parts[i]!, 16);
      if (isNaN(b) || b < 0 || b > 0xff) {
        memOutput.textContent = `Invalid byte: ${parts[i]}`;
        return;
      }
      bytes.push(b);
    }
    for (let i = 0; i < bytes.length && addr + i < vm.memory.length; i++) {
      vm.memory[addr + i] = bytes[i]!;
    }
    memOutput.textContent =
      `Wrote ${bytes.length} byte(s) at ${addr.toString(16).padStart(4, "0")}\n` +
      formatHexDump(vm.memory, addr, Math.min(16, vm.memory.length - addr));
  } else {
    memOutput.textContent = "Commands:\n  r ADDR [LEN]  — read LEN bytes (default 16) at hex ADDR\n  r ADDR-ADDR   — read hex address range (inclusive)\n  w ADDR XX ..  — write hex bytes at hex ADDR";
  }
}

function updateStatus(): void {
  statusPC.textContent = vm.pc.toString(16).padStart(4, "0");
  statusSP.textContent = String(vm.sp);
  statusTOS.textContent = vm.sp > 0 ? String(vm.stack[vm.sp - 1]) : "—";
  statusCycles.textContent = String(vm.cycles);

  if (rt.running) {
    statusState.textContent = "running";
  } else if (vm.halted) {
    statusState.textContent = "halted";
  } else {
    statusState.textContent = "idle";
  }

  // Only update stack view when not running (too expensive at 60fps)
  if (!rt.running) {
    stackView.textContent = buildStackText(vm.sp, vm.stack);
  }
}

function showError(msg: string): void {
  errorOutput.textContent = msg;
}

function clearError(): void {
  errorOutput.textContent = "";
}

/** Highlight the source line corresponding to the current PC in the editor. */
function highlightCurrentLine(): void {
  if (!lastPcToLine) return;
  const lineNum = lastPcToLine.get(vm.pc);
  if (lineNum === undefined) return;

  const text = editor.value;
  let start = 0;
  for (let i = 1; i < lineNum; i++) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return;
    start = nl + 1;
  }
  let end = text.indexOf("\n", start);
  if (end === -1) end = text.length;

  editor.focus();
  editor.setSelectionRange(start, end);
}

// --- Button handlers ---
btnAssemble.addEventListener("click", () => {
  clearError();
  const result = assemble(editor.value);
  if (isError(result)) {
    showError(`Line ${result.line}: ${result.message}`);
    return;
  }
  lastBytecode = result.bytecode;
  lastPcToLine = result.pcToLine;

  // Load into VM
  resetVM(vm);
  resetSpriteTable(syscallCtx.sprites);
  resetWallTable(syscallCtx.walls);
  loadProgram(vm.memory, result.bytecode);
  renderToCanvas(fb, ctx, scale);
  updateStatus();
  showError("");
});

btnRun.addEventListener("click", () => {
  clearError();
  if (lastBytecode === null) {
    // Auto-assemble
    btnAssemble.click();
    if (lastBytecode === null) return; // assembly failed
  }
  if (chkBreakStart.checked) {
    highlightCurrentLine();
    updateStatus();
    return;
  }
  try {
    run(rt);
  } catch (e) {
    showError((e as Error).message);
  }
});

btnStop.addEventListener("click", () => {
  stop(rt);
});

btnStep.addEventListener("click", () => {
  clearError();
  if (lastBytecode === null) {
    btnAssemble.click();
    if (lastBytecode === null) return;
  }
  try {
    stepOne(rt);
    highlightCurrentLine();
  } catch (e) {
    showError((e as Error).message);
  }
});

btnReset.addEventListener("click", () => {
  stop(rt);
  resetVM(vm);
  resetSpriteTable(syscallCtx.sprites);
  resetWallTable(syscallCtx.walls);
  if (lastBytecode) {
    loadProgram(vm.memory, lastBytecode);
  }
  renderToCanvas(fb, ctx, scale);
  updateStatus();
  clearError();
});

// --- Demo buttons ---
for (const demo of DEMOS) {
  const btn = document.createElement("button");
  btn.textContent = demo.name;
  btn.addEventListener("click", () => {
    stop(rt);
    editor.value = demo.source;
    clearError();
    // Auto-assemble and reset
    const result = assemble(demo.source);
    if (isError(result)) {
      showError(`Line ${result.line}: ${result.message}`);
      return;
    }
    lastBytecode = result.bytecode;
    lastPcToLine = result.pcToLine;
    resetVM(vm);
    resetSpriteTable(syscallCtx.sprites);
  resetWallTable(syscallCtx.walls);
    loadProgram(vm.memory, result.bytecode);
    renderToCanvas(fb, ctx, scale);
    updateStatus();
  });
  demoContainer.appendChild(btn);
}

// --- On-screen game input buttons ---
const INPUT_NAME_TO_BIT: Record<string, number> = {
  up: INPUT_UP,
  down: INPUT_DOWN,
  left: INPUT_LEFT,
  right: INPUT_RIGHT,
  btn: INPUT_BTN,
  enc_cw: INPUT_ENC_CW,
  enc_ccw: INPUT_ENC_CCW,
  enc_btn: INPUT_ENC_BTN,
};

for (const el of document.querySelectorAll<HTMLButtonElement>("[data-input]")) {
  const bit = INPUT_NAME_TO_BIT[el.dataset["input"]!];
  if (bit === undefined) continue;

  const press = () => pressInput(input, bit);
  const release = () => releaseInput(input, bit);

  el.addEventListener("mousedown", press);
  el.addEventListener("mouseup", release);
  el.addEventListener("mouseleave", release);
  el.addEventListener("touchstart", (e) => { e.preventDefault(); press(); });
  el.addEventListener("touchend", (e) => { e.preventDefault(); release(); });
}

// --- Scale selector ---
selScale.addEventListener("change", () => {
  scale = parseInt(selScale.value, 10);
  canvas.width = SCREEN_W * scale;
  canvas.height = SCREEN_H * scale;
  rt.scale = scale;
  renderToCanvas(fb, ctx, scale);
});

// --- Initial render ---
renderToCanvas(fb, ctx, scale);
updateStatus();

// Load first demo by default
if (DEMOS.length > 0) {
  editor.value = DEMOS[0]!.source;
}
