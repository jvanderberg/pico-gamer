/**
 * Main-thread audio API.
 * Lazily creates an AudioContext + AudioWorklet on first use.
 * Translates syscall IDs to messages posted to the synth worklet.
 * Buffers commands until the worklet is ready, then flushes them.
 */

import { SFX_PRESETS } from "./sfx-presets.ts";
import SynthProcessorUrl from "./synth-processor.ts?worker&url";

export interface EffectStepPayload {
  delayMs: number;
  waveform: number;
  freqValue: number;
  pulseWidth: number;
  volume: number;
  filterCutoff: number;
}

export interface EffectPayload {
  mode: "absolute" | "relative";
  basePitch: number;
  vibratoRate64: number;
  vibratoDepth: number;
  steps: EffectStepPayload[];
}

export interface SongEventPayload {
  pitch: number;
  duration: number;
}

export interface SongTrackPayload {
  voice: number;
  vibratoRate64: number;
  vibratoDepth: number;
  effect: EffectPayload;
  events: SongEventPayload[];
}

export interface SongPayload {
  bpm: number;
  loop: boolean;
  tracks: SongTrackPayload[];
}

export interface AudioManager {
  /** Ensure AudioContext is created and resumed (call on user gesture). */
  resume(): Promise<void>;
  /** Suspend audio (on stop). */
  suspend(): void;
  /** Dispatch an audio command from the VM to the worklet. */
  dispatchAudioCmd(syscallId: number, args: number[], effect?: EffectPayload, song?: SongPayload): void;
  /** Tear down AudioContext. */
  cleanup(): void;
}

export function createAudioManager(): AudioManager {
  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let ready = false;
  let initPromise: Promise<void> | null = null;
  let pendingCmds: { type: number; args: number[]; effect?: EffectPayload; song?: SongPayload }[] = [];
  let gestureCleanup: (() => void) | null = null;

  function flushPending(): void {
    if (!node) return;
    for (const cmd of pendingCmds) {
      node.port.postMessage(cmd);
    }
    pendingCmds = [];
  }

  async function init(): Promise<void> {
    if (ready) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      ctx = new AudioContext({ sampleRate: 44100 });

      await ctx.audioWorklet.addModule(SynthProcessorUrl);

      node = new AudioWorkletNode(ctx, "synth-processor");
      node.connect(ctx.destination);

      // Send SFX preset data to the worklet thread
      node.port.postMessage({ type: "init-presets", presets: SFX_PRESETS });

      // Flush any commands that arrived before the worklet was ready
      flushPending();

      ready = true;

      // If the context started suspended (no user gesture yet),
      // listen for the first interaction to resume it.
      if (ctx.state === "suspended") {
        listenForGesture();
      }
    })();
    return initPromise;
  }

  function listenForGesture(): void {
    if (gestureCleanup) return;
    const handler = () => {
      if (ctx && ctx.state === "suspended") {
        ctx.resume();
      }
      removeListeners();
    };
    const events = ["click", "keydown", "touchstart"] as const;
    for (const ev of events) {
      window.addEventListener(ev, handler, { once: true, capture: true });
    }
    gestureCleanup = () => {
      for (const ev of events) {
        window.removeEventListener(ev, handler, { capture: true });
      }
      gestureCleanup = null;
    };
  }

  function removeListeners(): void {
    gestureCleanup?.();
  }

  return {
    async resume() {
      await init();
      if (ctx && ctx.state === "suspended") {
        await ctx.resume();
      }
    },

    suspend() {
      ctx?.suspend();
    },

    dispatchAudioCmd(syscallId: number, args: number[], effect?: EffectPayload, song?: SongPayload) {
      if (node) {
        node.port.postMessage({ type: syscallId, args, effect, song });
      } else {
        pendingCmds.push({ type: syscallId, args, effect, song });
      }
    },

    cleanup() {
      removeListeners();
      if (node) {
        node.disconnect();
        node = null;
      }
      if (ctx) {
        ctx.close();
        ctx = null;
      }
      ready = false;
      initPromise = null;
      pendingCmds = [];
    },
  };
}
