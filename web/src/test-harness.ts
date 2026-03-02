import { loadWasmVM, type WasmVM } from "./wasm/wasm-vm.ts";
import { assembleSource } from "./lib/engine.ts";

export interface SpriteProxy {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  rotSpeed: number;
  width: number;
  height: number;
  flags: number;
  edge: number;
  addr: number;
  collGroup: number;
  collMask: number;
  spriteMode: number;
}

export interface Harness {
  vm: WasmVM;
  labels: Record<string, number>;
  sprites: SpriteProxy[];
  input: { bits: number };
  load(source: string): void;
  frame(): void;
  frames(n: number): void;
  pixel(x: number, y: number): number;
  read16(addr: number): number;
  read8(addr: number): number;
  writeMem(addr: number, val: number): void;
  setInput(bits: number): void;
}

function createSpriteProxy(vm: WasmVM, slot: number): SpriteProxy {
  return {
    get active() { return !!vm.sprActive(slot); },
    set active(v: boolean) { vm.sprSetActive(slot, v); },
    get x() { return vm.sprX(slot); },
    set x(v: number) { vm.sprSetX(slot, v); },
    get y() { return vm.sprY(slot); },
    set y(v: number) { vm.sprSetY(slot, v); },
    get vx() { return vm.sprVx(slot); },
    set vx(v: number) { vm.sprSetVx(slot, v); },
    get vy() { return vm.sprVy(slot); },
    set vy(v: number) { vm.sprSetVy(slot, v); },
    get angle() { return vm.sprAngle(slot); },
    set angle(v: number) { vm.sprSetAngle(slot, v); },
    get rotSpeed() { return vm.sprRotSpeed(slot); },
    set rotSpeed(v: number) { vm.sprSetRotSpeed(slot, v); },
    get width() { return vm.sprWidth(slot); },
    set width(v: number) { vm.sprSetWidth(slot, v); },
    get height() { return vm.sprHeight(slot); },
    set height(v: number) { vm.sprSetHeight(slot, v); },
    get flags() { return vm.sprFlags(slot); },
    set flags(v: number) { vm.sprSetFlags(slot, v); },
    get edge() { return vm.sprEdge(slot); },
    set edge(v: number) { vm.sprSetEdge(slot, v); },
    get addr() { return 0; /* write-only for tests */ },
    set addr(v: number) { vm.sprSetAddr(slot, v); },
    get collGroup() { return vm.sprCollGroup(slot); },
    set collGroup(v: number) { vm.sprSetCollGroup(slot, v); },
    get collMask() { return vm.sprCollMask(slot); },
    set collMask(v: number) { vm.sprSetCollMask(slot, v); },
    get spriteMode() { return vm.sprSpriteMode(slot); },
    set spriteMode(v: number) { vm.sprSetSpriteMode(slot, v); },
  };
}

export async function createHarness(): Promise<Harness> {
  const vm = await loadWasmVM();
  let currentLabels: Record<string, number> = {};
  let inputBits = 0;

  const spriteProxies: SpriteProxy[] = [];
  for (let i = 0; i < 32; i++) {
    spriteProxies.push(createSpriteProxy(vm, i));
  }

  function load(source: string): void {
    const result = assembleSource(source);
    if (typeof result === "string") {
      throw new Error(result);
    }
    vm.reset();
    vm.loadProgram(result.bytecode);
    currentLabels = result.labels;
  }

  function frame(): void {
    vm.execFrame();
  }

  function frames(n: number): void {
    for (let i = 0; i < n; i++) {
      frame();
    }
  }

  return {
    vm,
    get labels() { return currentLabels; },
    sprites: spriteProxies,
    input: {
      get bits() { return inputBits; },
      set bits(v: number) { inputBits = v; vm.setInput(v); },
    },
    load,
    frame,
    frames,
    pixel: (x, y) => vm.getPixelFront(x, y),
    read16: (addr) => vm.readMem16(addr),
    read8: (addr) => vm.readMem(addr),
    writeMem: (addr, val) => vm.writeMem(addr, val),
    setInput: (bits) => { inputBits = bits; vm.setInput(bits); },
  };
}
