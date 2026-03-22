#!/usr/bin/env npx tsx
// Terminal runner for Pico Gamer — renders 128×64 framebuffer using half-block characters
// Usage: npx tsx terminal/pico-term.ts [--color white] [--no-audio] <file.bas|file.game>

import { readFileSync } from "fs";
import { createRequire } from "module";
import { resolve, extname } from "path";
import { fileURLToPath } from "url";
import createModule from "../web/src/wasm/pico-vm.mjs";
import { compile, isCompileError } from "../web/src/basic/compiler.ts";
import { assemble } from "../web/src/assembler/assembler.ts";
import {
  createInput, consumeInputWord,
  INPUT_UP, INPUT_DOWN, INPUT_LEFT, INPUT_RIGHT,
  INPUT_BTN, INPUT_ENC_CW, INPUT_ENC_CCW, INPUT_ENC_BTN,
  type InputState,
} from "../web/src/input/input.ts";
import { createTerminalSynth, SAMPLE_RATE, type TerminalSynth } from "./synth-node.ts";

// ── Half-block lookup ───────────────────────────────────────
const BLOCKS = [" ", "▀", "▄", "█"];

// ── Key map (same as web) ───────────────────────────────────
const KEY_MAP: Record<string, number> = {
  w: INPUT_UP, W: INPUT_UP,
  s: INPUT_DOWN, S: INPUT_DOWN,
  a: INPUT_LEFT, A: INPUT_LEFT,
  d: INPUT_RIGHT, D: INPUT_RIGHT,
  q: INPUT_ENC_CW, Q: INPUT_ENC_CW,
  l: INPUT_ENC_CW, L: INPUT_ENC_CW,
  e: INPUT_ENC_CCW, E: INPUT_ENC_CCW,
  j: INPUT_ENC_CCW, J: INPUT_ENC_CCW,
  k: INPUT_BTN, K: INPUT_BTN,
  " ": INPUT_ENC_BTN,
};

const ARROW_MAP: Record<string, number> = {
  A: INPUT_UP, B: INPUT_DOWN, C: INPUT_RIGHT, D: INPUT_LEFT,
};

// ── Audio constants (must match syscall-ids) ────────────────
const SYS_SFX = 0x36;
const SYS_NOTE = 0x38;
const SYS_MPLAY = 0x3a;
const BUILTIN_SFX_COUNT = 18;
const SONG_REST_PITCH = 0xff;

// ── Framebuffer renderer ────────────────────────────────────
const SCREEN_W = 128;
const SCREEN_H = 64;
const FB_BYTES = (SCREEN_W * SCREEN_H) / 8;
const COLS = SCREEN_W;
const ROWS = SCREEN_H / 2;

function getPixel(fb: Uint8Array, x: number, y: number): number {
  const byteIdx = y * (SCREEN_W / 8) + (x >> 3);
  const bitIdx = 7 - (x & 7);
  return (fb[byteIdx]! >> bitIdx) & 1;
}

const screenBuf = new Uint8Array(COLS * ROWS);
let screenInited = false;

function renderDelta(fb: Uint8Array): string {
  let out = "";
  let lastRow = -1;
  let lastCol = -1;

  for (let row = 0; row < ROWS; row++) {
    const y0 = row * 2;
    const y1 = y0 + 1;
    const rowOff = row * COLS;
    for (let col = 0; col < COLS; col++) {
      const idx = getPixel(fb, col, y0) | (getPixel(fb, col, y1) << 1);
      if (screenInited && screenBuf[rowOff + col] === idx) continue;
      screenBuf[rowOff + col] = idx;
      if (row !== lastRow || col !== lastCol) {
        out += `\x1b[${row + 1};${col + 1}H`;
      }
      out += BLOCKS[idx];
      lastRow = row;
      lastCol = col + 1;
    }
  }
  screenInited = true;
  return out;
}

// ── Load and compile ────────────────────────────────────────
function loadBytecode(filePath: string): Uint8Array {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".game") return new Uint8Array(readFileSync(filePath));

  const source = readFileSync(filePath, "utf-8");
  if (ext === ".bas") {
    const compiled = compile(source);
    if (isCompileError(compiled)) {
      console.error(`[${compiled.phase}] Line ${compiled.line}: ${compiled.message}`);
      process.exit(1);
    }
    const result = assemble(compiled);
    if ("message" in result) {
      console.error(`Assembler error line ${result.line}: ${result.message}`);
      process.exit(1);
    }
    return result.bytecode;
  }

  const result = assemble(source);
  if ("message" in result) {
    console.error(`Assembler error line ${result.line}: ${result.message}`);
    process.exit(1);
  }
  return result.bytecode;
}

// ── Terminal input ──────────────────────────────────────────
// Terminals have no key-up events, so we simulate release with a timeout.
// Single tap: short timeout so it doesn't ghost.
// Held key: once OS repeat kicks in, extend the timeout to avoid stutter.
const TAP_RELEASE_MS = 150;
const HOLD_RELEASE_MS = 180;

function bindTerminalInput(input: InputState) {
  const releaseTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const holdActive = new Set<number>();

  function keyDown(bit: number, isRepeat: boolean) {
    const wasDown = (input.bits & bit) !== 0;
    input.bits |= bit;

    if (!isRepeat && !wasDown) {
      if (bit === INPUT_ENC_CW) {
        input.encDelta += 1;
        input.encPressedMask |= INPUT_ENC_CW;
      } else if (bit === INPUT_ENC_CCW) {
        input.encDelta -= 1;
        input.encPressedMask |= INPUT_ENC_CCW;
      }
    }

    // Second event while still held = OS repeat has started
    if (wasDown) holdActive.add(bit);
    const timeout = holdActive.has(bit) ? HOLD_RELEASE_MS : TAP_RELEASE_MS;

    const existing = releaseTimers.get(bit);
    if (existing) clearTimeout(existing);
    releaseTimers.set(bit, setTimeout(() => {
      input.bits &= ~bit;
      if (bit === INPUT_ENC_CW) input.encHoldFramesCw = 0;
      else if (bit === INPUT_ENC_CCW) input.encHoldFramesCcw = 0;
      releaseTimers.delete(bit);
      holdActive.delete(bit);
    }, timeout));
  }

  process.stdin.on("data", (data: string) => {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i]!;

      if (ch === "\x03") {
        for (const t of releaseTimers.values()) clearTimeout(t);
        return process.exit(0);
      }

      if (ch === "\x1b" && data[i + 1] === "[") {
        const code = data[i + 2];
        if (code) {
          const bit = ARROW_MAP[code];
          if (bit !== undefined) keyDown(bit, (input.bits & bit) !== 0);
        }
        i += 2;
        continue;
      }

      const bit = KEY_MAP[ch];
      if (bit !== undefined) keyDown(bit, (input.bits & bit) !== 0);
    }
  });
}

// ── Color presets ───────────────────────────────────────────
const COLORS: Record<string, string> = {
  white:   "\x1b[97m",
  green:   "\x1b[38;2;50;255;50m",
  red:     "\x1b[31m",
  blue:    "\x1b[34m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  yellow:  "\x1b[93m",
  amber:   "\x1b[33m",
  orange:  "\x1b[33m",
  pink:    "\x1b[35m",
  purple:  "\x1b[35m",
  violet:  "\x1b[35m",
  aqua:    "\x1b[36m",
  teal:    "\x1b[36m",
  lime:    "\x1b[92m",
  grey:    "\x1b[37m",
  gray:    "\x1b[37m",
};

// ── Audio payload parsing (same as web engine) ──────────────
interface EffectStepPayload {
  delayMs: number; waveform: number; freqValue: number;
  pulseWidth: number; volume: number; filterCutoff: number;
}
interface EffectPayload {
  mode: "absolute" | "relative"; basePitch: number;
  vibratoRate64: number; vibratoDepth: number;
  steps: EffectStepPayload[];
}
interface SongPayload {
  bpm: number; loop: boolean;
  tracks: { voice: number; vibratoRate64: number; vibratoDepth: number;
            effect: EffectPayload; events: { pitch: number; duration: number }[] }[];
}

function midiToHz(note: number): number {
  return Math.round(440 * Math.pow(2, (note - 69) / 12));
}

function readEffectPayload(
  readMem: (a: number) => number, readMem16: (a: number) => number,
  addr: number, mode: "absolute" | "relative", pitch = 0,
): EffectPayload {
  const count = readMem(addr);
  const steps: EffectStepPayload[] = [];
  for (let i = 0; i < count; i++) {
    const sb = (addr + 1 + i * 8) & 0xffff;
    const rawFreq = readMem16((sb + 3) & 0xffff);
    steps.push({
      delayMs: readMem16(sb),
      waveform: readMem((sb + 2) & 0xffff),
      freqValue: rawFreq & 0x8000 ? rawFreq - 0x10000 : rawFreq,
      pulseWidth: readMem((sb + 5) & 0xffff),
      volume: readMem((sb + 6) & 0xffff),
      filterCutoff: readMem((sb + 7) & 0xffff),
    });
  }
  return {
    mode,
    basePitch: mode === "relative" ? (pitch <= 127 ? midiToHz(pitch) : pitch) : 0,
    vibratoRate64: 0, vibratoDepth: 0, steps,
  };
}

function readSongPayload(
  readMem: (a: number) => number, readMem16: (a: number) => number,
  addr: number,
): SongPayload {
  const trackCount = readMem(addr & 0xffff);
  const bpm = readMem((addr + 1) & 0xffff);
  const loop = readMem((addr + 2) & 0xffff) !== 0;
  const tracks = [];
  let tb = (addr + 3) & 0xffff;
  for (let i = 0; i < trackCount; i++) {
    const voice = readMem(tb);
    const effectAddr = readMem16((tb + 1) & 0xffff);
    const vibratoRate64 = readMem16((tb + 3) & 0xffff);
    const depthRaw = readMem16((tb + 5) & 0xffff);
    const vibratoDepth = depthRaw & 0x8000 ? depthRaw - 0x10000 : depthRaw;
    const eventsAddr = readMem16((tb + 7) & 0xffff);
    const eventCount = readMem16(eventsAddr & 0xffff);
    const events = [];
    for (let j = 0; j < eventCount; j++) {
      const eb = (eventsAddr + 2 + j * 2) & 0xffff;
      const pitch = readMem(eb);
      const duration = readMem((eb + 1) & 0xffff);
      events.push({ pitch: pitch === SONG_REST_PITCH ? SONG_REST_PITCH : pitch, duration });
    }
    tracks.push({
      voice, vibratoRate64, vibratoDepth,
      effect: readEffectPayload(readMem, readMem16, effectAddr, "relative", 0),
      events,
    });
    tb = (tb + 9) & 0xffff;
  }
  return { bpm: Math.max(1, bpm), loop, tracks };
}

// ── Audio output via node-web-audio-api ─────────────────────
async function initAudioOutput(synth: TerminalSynth): Promise<{ cleanup: () => void } | null> {
  try {
    // Resolve from web/ where node-web-audio-api is installed
    const req = createRequire(new URL("../web/package.json", import.meta.url).href);
    const { AudioContext, ScriptProcessorNode } = req("node-web-audio-api");
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Use a ScriptProcessorNode to pull samples from the synth
    // node-web-audio-api may not support AudioWorklet, but ScriptProcessor works
    const bufSize = 1024;
    const scriptNode = ctx.createScriptProcessor(bufSize, 0, 1) as InstanceType<typeof ScriptProcessorNode>;
    scriptNode.onaudioprocess = (e: { outputBuffer: { getChannelData(ch: number): Float32Array } }) => {
      const output = e.outputBuffer.getChannelData(0);
      synth.render(output);
    };
    scriptNode.connect(ctx.destination);

    return {
      cleanup() {
        scriptNode.disconnect();
        ctx.close();
      },
    };
  } catch (err) {
    console.error("Audio init failed (install node-web-audio-api in web/):", (err as Error).message);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let color = "white";
  let filePath: string | undefined;
  let noAudio = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--color" && args[i + 1]) {
      color = args[++i]!;
    } else if (args[i] === "--no-audio") {
      noAudio = true;
    } else if (!filePath) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error("Usage: npx tsx terminal/pico-term.ts [--color name] [--no-audio] <file>");
    process.exit(1);
  }

  const colorCode = COLORS[color.toLowerCase()];
  if (!colorCode) {
    console.error(`Unknown color '${color}'. Options: ${Object.keys(COLORS).join(", ")}`);
    process.exit(1);
  }

  const bytecode = loadBytecode(resolve(filePath));

  // Load WASM
  const wasmPath = fileURLToPath(new URL("../web/src/wasm/pico-vm.wasm", import.meta.url));
  const wasmBinary = readFileSync(wasmPath);
  const mod = await createModule({ wasmBinary });

  const vmInit = mod.cwrap("vm_init", null, []);
  const vmLoadProgram = mod.cwrap("vm_load_program", null, ["number", "number"]);
  const vmSetInput = mod.cwrap("vm_set_input", null, ["number"]);
  const vmSetElapsedMs = mod.cwrap("vm_set_elapsed_ms", null, ["number"]);
  const vmExecFrame = mod.cwrap("vm_exec_frame", "boolean", []);
  const vmGetFramebuffer = mod.cwrap("vm_get_framebuffer", "number", []);
  const vmAudioCmdCount = mod.cwrap("vm_audio_cmd_count", "number", []);
  const vmAudioCmdId = mod.cwrap("vm_audio_cmd_id", "number", ["number"]);
  const vmAudioCmdArg = mod.cwrap("vm_audio_cmd_arg", "number", ["number", "number"]);
  const vmAudioCmdClear = mod.cwrap("vm_audio_cmd_clear", null, []);
  const vmIsHalted = mod.cwrap("vm_is_halted", "boolean", []);
  const vmGetPC = mod.cwrap("vm_get_pc", "number", []);
  const vmGetSP = mod.cwrap("vm_get_sp", "number", []);
  const vmGetCycles = mod.cwrap("vm_get_cycles", "number", []);
  const vmReadMem = mod.cwrap("vm_read_mem", "number", ["number"]);
  const vmReadMem16 = mod.cwrap("vm_read_mem16", "number", ["number"]);

  // Init VM and load program
  vmInit();
  const ptr = mod._malloc(bytecode.length);
  mod.HEAPU8.set(bytecode, ptr);
  vmLoadProgram(ptr, bytecode.length);
  mod._free(ptr);

  // Init synth + audio output
  const synth = await createTerminalSynth();
  let audioOut: { cleanup: () => void } | null = null;
  if (!noAudio) {
    audioOut = await initAudioOutput(synth);
    if (!audioOut) {
      // Audio init failed silently — continue without sound
    }
  }

  // Drain audio commands from VM and forward to synth
  function drainAudioCommands() {
    const count = vmAudioCmdCount();
    for (let i = 0; i < count; i++) {
      const id = vmAudioCmdId(i);
      const cmdArgs: number[] = [];
      for (let j = 0; j < 5; j++) cmdArgs.push(vmAudioCmdArg(i, j));

      let effect: EffectPayload | undefined;
      let song: SongPayload | undefined;
      if (id === SYS_SFX && cmdArgs[0]! >= BUILTIN_SFX_COUNT) {
        effect = readEffectPayload(vmReadMem, vmReadMem16, cmdArgs[0]!, "absolute");
      } else if (id === SYS_NOTE) {
        effect = readEffectPayload(vmReadMem, vmReadMem16, cmdArgs[0]!, "relative", cmdArgs[2]!);
        effect.vibratoRate64 = cmdArgs[3] ?? 0;
        effect.vibratoDepth = cmdArgs[4] ?? 0;
      } else if (id === SYS_MPLAY) {
        song = readSongPayload(vmReadMem, vmReadMem16, cmdArgs[0]!);
      }

      synth.handleCommand(id, cmdArgs, effect, song);
    }
    if (count > 0) vmAudioCmdClear();
  }

  // Set up terminal
  process.stdout.write("\x1b[2J");
  process.stdout.write("\x1b[?25l");
  process.stdout.write(colorCode);
  process.stdout.write("\x1b[40m");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf-8");

  const input = createInput();
  bindTerminalInput(input);

  const startTime = Date.now();
  let frameCount = 0;
  let fpsTime = Date.now();
  let fps = 0;

  function tick() {
    if (vmIsHalted()) {
      cleanup();
      console.log("\nProgram halted.");
      process.exit(0);
    }

    const elapsed = (Date.now() - startTime) & 0xffff;
    const inputWord = consumeInputWord(input);
    vmSetInput(inputWord);
    vmSetElapsedMs(elapsed);
    vmExecFrame();
    drainAudioCommands();

    frameCount++;
    const now = Date.now();
    if (now - fpsTime >= 1000) {
      fps = frameCount / ((now - fpsTime) / 1000);
      frameCount = 0;
      fpsTime = now;
    }

    const fbPtr = vmGetFramebuffer();
    const fb = new Uint8Array(mod.HEAPU8.buffer, fbPtr, FB_BYTES);

    let out = renderDelta(fb);
    const pc = vmGetPC();
    const sp = vmGetSP();
    const cycles = vmGetCycles();
    const audioStr = audioOut ? "♪" : "mute";
    out += `\x1b[${ROWS + 1};1H\x1b[2m\x1b[K ${Math.round(fps)}fps  PC:${pc.toString(16).padStart(4, "0")}  SP:${sp}  CYC:${cycles}  IN:${inputWord.toString(2).padStart(8, "0")}  ${audioStr}\x1b[22m`;
    if (out.length > 0) process.stdout.write(out);
  }

  const FRAME_MS = 1000 / 60;
  let lastTick = Date.now();
  let accumulator = FRAME_MS;
  let loopTimer: ReturnType<typeof setTimeout> | null = null;

  function loop() {
    const now = Date.now();
    accumulator += now - lastTick;
    lastTick = now;
    if (accumulator > FRAME_MS * 4) accumulator = FRAME_MS * 4;
    while (accumulator >= FRAME_MS) {
      accumulator -= FRAME_MS;
      tick();
    }
    loopTimer = setTimeout(loop, 1);
  }
  loop();

  function cleanup() {
    if (loopTimer !== null) clearTimeout(loopTimer);
    audioOut?.cleanup();
    synth.reset();
    process.stdout.write("\x1b[0m");
    process.stdout.write("\x1b[?25h");
    process.stdout.write("\n");
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
