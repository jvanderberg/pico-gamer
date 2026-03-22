/**
 * Node.js wrapper for the Pico Gamer synth.
 *
 * Shims AudioWorkletProcessor so synth-processor.ts can be loaded directly,
 * then exposes a simple API: feed commands, render PCM samples.
 */

// Set global sampleRate before loading the synth
export const SAMPLE_RATE = 44100;
(globalThis as Record<string, unknown>).sampleRate = SAMPLE_RATE;

// Shim AudioWorkletProcessor
class AudioWorkletProcessorShim {
  port = {
    onmessage: null as ((e: { data: unknown }) => void) | null,
    postMessage(_msg: unknown) {},
  };
}
(globalThis as Record<string, unknown>).AudioWorkletProcessor = AudioWorkletProcessorShim;

// Capture the registered processor class
type SynthClass = new () => AudioWorkletProcessorShim & {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};
let ProcessorClass: SynthClass;
(globalThis as Record<string, unknown>).registerProcessor = (_name: string, cls: SynthClass) => {
  ProcessorClass = cls;
};

let synthLoaded = false;
async function ensureSynthLoaded() {
  if (synthLoaded) return;
  await import("../web/src/audio/synth-processor.ts");
  synthLoaded = true;
}

// SFX presets loaded lazily
let presets: unknown[] | null = null;
async function getPresets() {
  if (!presets) {
    const { SFX_PRESETS } = await import("../web/src/audio/sfx-presets.ts");
    presets = SFX_PRESETS;
  }
  return presets;
}

export interface TerminalSynth {
  handleCommand(type: number | string, args: number[], effect?: unknown, song?: unknown): void;
  render(output: Float32Array): void;
  reset(): void;
}

export async function createTerminalSynth(): Promise<TerminalSynth> {
  await ensureSynthLoaded();
  const sfxPresets = await getPresets();
  const proc = new ProcessorClass!();

  // Init presets via the port shim
  if (proc.port.onmessage) {
    proc.port.onmessage({ data: { type: "init-presets", presets: sfxPresets } });
  }

  return {
    handleCommand(type, args, effect?, song?) {
      if (proc.port.onmessage) {
        proc.port.onmessage({ data: { type, args, effect, song } });
      }
    },

    render(output: Float32Array) {
      (proc as unknown as { process(i: Float32Array[][], o: Float32Array[][]): boolean })
        .process([], [[output]]);
    },

    reset() {
      if (proc.port.onmessage) {
        proc.port.onmessage({ data: { type: "reset" } });
      }
    },
  };
}
