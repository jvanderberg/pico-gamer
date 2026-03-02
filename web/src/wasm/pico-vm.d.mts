/** Type declarations for the Emscripten-generated pico-vm module. */

export interface PicoVMModule {
  cwrap: (name: string, returnType: string | null, argTypes: string[]) => (...args: unknown[]) => unknown;
  HEAPU8: Uint8Array;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
}

declare function createModule(opts?: {
  locateFile?: (path: string, prefix: string) => string;
}): Promise<PicoVMModule>;

export default createModule;
