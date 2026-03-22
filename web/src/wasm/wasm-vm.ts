import createModule, { type PicoVMModule } from "./pico-vm.mjs";

export interface WasmVM {
  init(): void;
  reset(): void;
  loadProgram(bytecode: Uint8Array): void;
  setInput(bits: number): void;
  setElapsedMs(ms: number): void;
  execFrame(): boolean;
  step(): boolean;
  isYielded(): boolean;
  doSpriteUpdate(): void;
  clearFB(): void;
  getFramebuffer(): Uint8Array;
  getPC(): number;
  getSP(): number;
  getTOS(): number;
  getCycles(): number;
  isHalted(): boolean;
  getStackValue(idx: number): number;
  readMem(addr: number): number;
  writeMem(addr: number, val: number): void;
  readMem16(addr: number): number;
  getPixelFront(x: number, y: number): number;
  // Audio command buffer
  audioCommandCount(): number;
  audioCommandId(i: number): number;
  audioCommandArg(i: number, j: number): number;
  audioCommandClear(): void;
  // Sprite introspection
  sprActive(slot: number): boolean;
  sprX(slot: number): number;
  sprY(slot: number): number;
  sprVx(slot: number): number;
  sprVy(slot: number): number;
  sprWidth(slot: number): number;
  sprHeight(slot: number): number;
  sprFlags(slot: number): number;
  sprEdge(slot: number): number;
  sprAngle(slot: number): number;
  sprRotSpeed(slot: number): number;
  sprCollGroup(slot: number): number;
  sprCollMask(slot: number): number;
  sprSpriteMode(slot: number): number;
  sprSetActive(slot: number, active: boolean): void;
  sprSetX(slot: number, x: number): void;
  sprSetY(slot: number, y: number): void;
  sprSetVx(slot: number, vx: number): void;
  sprSetVy(slot: number, vy: number): void;
  sprSetAngle(slot: number, angle: number): void;
  sprSetRotSpeed(slot: number, rs: number): void;
  sprSetAddr(slot: number, addr: number): void;
  sprSetWidth(slot: number, w: number): void;
  sprSetHeight(slot: number, h: number): void;
  sprSetFlags(slot: number, flags: number): void;
  sprSetEdge(slot: number, edge: number): void;
  sprSetCollGroup(slot: number, g: number): void;
  sprSetCollMask(slot: number, m: number): void;
  sprSetSpriteMode(slot: number, m: number): void;
}

export async function loadWasmVM(): Promise<WasmVM> {
  const opts: Record<string, unknown> = {};

  if (typeof window !== "undefined") {
    // Browser: serve .wasm from public/ via Vite's base URL
    opts.locateFile = (path: string) => {
      if (path.endsWith(".wasm")) return import.meta.env.BASE_URL + "pico-vm.wasm";
      return path;
    };
  } else {
    // Node.js (tests): read the .wasm binary from disk directly to avoid
    // emscripten's path.normalize() mangling file:// URLs (emcc 3.1.5 bug)
    // @ts-expect-error — Node-only path, types not available in DOM tsconfig
    const { readFileSync } = await import("node:fs");
    // @ts-expect-error — Node-only path, types not available in DOM tsconfig
    const { fileURLToPath } = await import("node:url");
    const wasmPath = fileURLToPath(new URL("pico-vm.wasm", import.meta.url));
    opts.wasmBinary = readFileSync(wasmPath);
  }

  const mod: PicoVMModule = await createModule(opts);

  const vmInit = mod.cwrap("vm_init", null, []) as () => void;
  const vmReset = mod.cwrap("vm_reset", null, []) as () => void;
  const vmLoadProgram = mod.cwrap("vm_load_program", null, ["number", "number"]) as (ptr: number, len: number) => void;
  const vmSetInput = mod.cwrap("vm_set_input", null, ["number"]) as (bits: number) => void;
  const vmSetElapsedMs = mod.cwrap("vm_set_elapsed_ms", null, ["number"]) as (ms: number) => void;
  const vmExecFrame = mod.cwrap("vm_exec_frame", "boolean", []) as () => boolean;
  const vmStep = mod.cwrap("vm_step", "boolean", []) as () => boolean;
  const vmIsYielded = mod.cwrap("vm_is_yielded", "boolean", []) as () => boolean;
  const vmDoSpriteUpdate = mod.cwrap("vm_do_sprite_update", null, []) as () => void;
  const vmClearFB = mod.cwrap("vm_clear_fb", null, []) as () => void;
  const vmGetFramebuffer = mod.cwrap("vm_get_framebuffer", "number", []) as () => number;
  const vmGetPC = mod.cwrap("vm_get_pc", "number", []) as () => number;
  const vmGetSP = mod.cwrap("vm_get_sp", "number", []) as () => number;
  const vmGetTOS = mod.cwrap("vm_get_tos", "number", []) as () => number;
  const vmGetCycles = mod.cwrap("vm_get_cycles", "number", []) as () => number;
  const vmIsHalted = mod.cwrap("vm_is_halted", "boolean", []) as () => boolean;
  const vmGetStackValue = mod.cwrap("vm_get_stack_value", "number", ["number"]) as (idx: number) => number;
  const vmReadMem = mod.cwrap("vm_read_mem", "number", ["number"]) as (addr: number) => number;
  const vmWriteMem = mod.cwrap("vm_write_mem", null, ["number", "number"]) as (addr: number, val: number) => void;
  const vmReadMem16 = mod.cwrap("vm_read_mem16", "number", ["number"]) as (addr: number) => number;
  const vmGetPixelFront = mod.cwrap("vm_get_pixel_front", "number", ["number", "number"]) as (x: number, y: number) => number;

  // Audio command buffer
  const vmAudioCmdCount = mod.cwrap("vm_audio_cmd_count", "number", []) as () => number;
  const vmAudioCmdId = mod.cwrap("vm_audio_cmd_id", "number", ["number"]) as (i: number) => number;
  const vmAudioCmdArg = mod.cwrap("vm_audio_cmd_arg", "number", ["number", "number"]) as (i: number, j: number) => number;
  const vmAudioCmdClear = mod.cwrap("vm_audio_cmd_clear", null, []) as () => void;

  // Sprite introspection
  const vmSprActive = mod.cwrap("vm_spr_active", "boolean", ["number"]) as (s: number) => boolean;
  const vmSprX = mod.cwrap("vm_spr_x", "number", ["number"]) as (s: number) => number;
  const vmSprY = mod.cwrap("vm_spr_y", "number", ["number"]) as (s: number) => number;
  const vmSprVx = mod.cwrap("vm_spr_vx", "number", ["number"]) as (s: number) => number;
  const vmSprVy = mod.cwrap("vm_spr_vy", "number", ["number"]) as (s: number) => number;
  const vmSprWidth = mod.cwrap("vm_spr_width", "number", ["number"]) as (s: number) => number;
  const vmSprHeight = mod.cwrap("vm_spr_height", "number", ["number"]) as (s: number) => number;
  const vmSprFlags = mod.cwrap("vm_spr_flags", "number", ["number"]) as (s: number) => number;
  const vmSprEdge = mod.cwrap("vm_spr_edge", "number", ["number"]) as (s: number) => number;
  const vmSprAngle = mod.cwrap("vm_spr_angle", "number", ["number"]) as (s: number) => number;
  const vmSprRotSpeed = mod.cwrap("vm_spr_rot_speed", "number", ["number"]) as (s: number) => number;
  const vmSprCollGroup = mod.cwrap("vm_spr_coll_group", "number", ["number"]) as (s: number) => number;
  const vmSprCollMask = mod.cwrap("vm_spr_coll_mask", "number", ["number"]) as (s: number) => number;
  const vmSprSpriteMode = mod.cwrap("vm_spr_sprite_mode", "number", ["number"]) as (s: number) => number;
  const vmSprSetActive = mod.cwrap("vm_spr_set_active", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetX = mod.cwrap("vm_spr_set_x", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetY = mod.cwrap("vm_spr_set_y", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetVx = mod.cwrap("vm_spr_set_vx", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetVy = mod.cwrap("vm_spr_set_vy", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetAngle = mod.cwrap("vm_spr_set_angle", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetRotSpeed = mod.cwrap("vm_spr_set_rot_speed", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetAddr = mod.cwrap("vm_spr_set_addr", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetWidth = mod.cwrap("vm_spr_set_width", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetHeight = mod.cwrap("vm_spr_set_height", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetFlags = mod.cwrap("vm_spr_set_flags", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetEdge = mod.cwrap("vm_spr_set_edge", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetCollGroup = mod.cwrap("vm_spr_set_coll_group", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetCollMask = mod.cwrap("vm_spr_set_coll_mask", null, ["number", "number"]) as (s: number, v: number) => void;
  const vmSprSetSpriteMode = mod.cwrap("vm_spr_set_sprite_mode", null, ["number", "number"]) as (s: number, v: number) => void;

  vmInit();

  return {
    init: vmInit,
    reset: vmReset,

    loadProgram(bytecode: Uint8Array) {
      const ptr = mod._malloc(bytecode.length);
      mod.HEAPU8.set(bytecode, ptr);
      vmLoadProgram(ptr, bytecode.length);
      mod._free(ptr);
    },

    setInput: vmSetInput,
    setElapsedMs: vmSetElapsedMs,
    execFrame: vmExecFrame,
    step: vmStep,
    isYielded: vmIsYielded,
    doSpriteUpdate: vmDoSpriteUpdate,
    clearFB: vmClearFB,

    getFramebuffer() {
      const ptr = vmGetFramebuffer();
      // Safe to hold a subarray view since ALLOW_MEMORY_GROWTH=0
      return mod.HEAPU8.subarray(ptr, ptr + 1024);
    },

    getPC: vmGetPC,
    getSP: vmGetSP,
    getTOS: vmGetTOS,
    getCycles: vmGetCycles,
    isHalted: vmIsHalted,
    getStackValue: vmGetStackValue,
    readMem: vmReadMem,
    writeMem: vmWriteMem,
    readMem16: vmReadMem16,
    getPixelFront: vmGetPixelFront,
    audioCommandCount: vmAudioCmdCount,
    audioCommandId: vmAudioCmdId,
    audioCommandArg: vmAudioCmdArg,
    audioCommandClear: vmAudioCmdClear,
    sprActive: vmSprActive,
    sprX: vmSprX,
    sprY: vmSprY,
    sprVx: vmSprVx,
    sprVy: vmSprVy,
    sprWidth: vmSprWidth,
    sprHeight: vmSprHeight,
    sprFlags: vmSprFlags,
    sprEdge: vmSprEdge,
    sprAngle: vmSprAngle,
    sprRotSpeed: vmSprRotSpeed,
    sprCollGroup: vmSprCollGroup,
    sprCollMask: vmSprCollMask,
    sprSpriteMode: vmSprSpriteMode,
    sprSetActive: (slot: number, active: boolean) => vmSprSetActive(slot, active ? 1 : 0),
    sprSetX: vmSprSetX,
    sprSetY: vmSprSetY,
    sprSetVx: vmSprSetVx,
    sprSetVy: vmSprSetVy,
    sprSetAngle: vmSprSetAngle,
    sprSetRotSpeed: vmSprSetRotSpeed,
    sprSetAddr: vmSprSetAddr,
    sprSetWidth: vmSprSetWidth,
    sprSetHeight: vmSprSetHeight,
    sprSetFlags: vmSprSetFlags,
    sprSetEdge: vmSprSetEdge,
    sprSetCollGroup: vmSprSetCollGroup,
    sprSetCollMask: vmSprSetCollMask,
    sprSetSpriteMode: vmSprSetSpriteMode,
  };
}
