/**
 * Input state for VM INPUT():
 * - low byte: button bits
 * - high byte: signed encoder delta (accumulated per frame)
 */

export const INPUT_UP = 1 << 0;
export const INPUT_DOWN = 1 << 1;
export const INPUT_LEFT = 1 << 2;
export const INPUT_RIGHT = 1 << 3;
export const INPUT_BTN = 1 << 4;
export const INPUT_ENC_CW = 1 << 5;
export const INPUT_ENC_CCW = 1 << 6;
export const INPUT_ENC_BTN = 1 << 7;
export const INPUT_ENC_DELTA_SHIFT = 8;
const ENC_HOLD_REPEAT_EVERY_FRAMES = 2;
const ENC_HOLD_INITIAL_DELAY_FRAMES = 8;

const KEY_MAP: Record<string, number> = {
  ArrowUp: INPUT_UP,
  w: INPUT_UP,
  W: INPUT_UP,
  ArrowDown: INPUT_DOWN,
  s: INPUT_DOWN,
  S: INPUT_DOWN,
  ArrowLeft: INPUT_LEFT,
  a: INPUT_LEFT,
  A: INPUT_LEFT,
  ArrowRight: INPUT_RIGHT,
  d: INPUT_RIGHT,
  D: INPUT_RIGHT,
  q: INPUT_ENC_CW,
  Q: INPUT_ENC_CW,
  e: INPUT_ENC_CCW,
  E: INPUT_ENC_CCW,
  j: INPUT_ENC_CCW,
  J: INPUT_ENC_CCW,
  l: INPUT_ENC_CW,
  L: INPUT_ENC_CW,
  k: INPUT_BTN,
  K: INPUT_BTN,
  " ": INPUT_ENC_BTN,
  Tab: INPUT_ENC_BTN,
};

export interface InputState {
  /** Current pressed-key bitfield. */
  bits: number;
  /** Signed encoder detent accumulation for next INPUT() read. */
  encDelta: number;
  /** Encoder bits first-pressed since last consume; suppresses one hold repeat pulse. */
  encPressedMask: number;
  /** Frame counter for held CW repeat cadence. */
  encHoldFramesCw: number;
  /** Frame counter for held CCW repeat cadence. */
  encHoldFramesCcw: number;
}

export function createInput(): InputState {
  return {
    bits: 0,
    encDelta: 0,
    encPressedMask: 0,
    encHoldFramesCw: 0,
    encHoldFramesCcw: 0,
  };
}

/** Returns true if the event target is a text input (textarea, input, contentEditable). */
function isEditable(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || el.isContentEditable;
}

/** Install keyboard listeners. Returns a cleanup function. */
export function bindInput(input: InputState): () => void {
  function onKeyDown(e: KeyboardEvent) {
    if (isEditable(e)) return;
    const bit = KEY_MAP[e.key];
    if (bit !== undefined) {
      const wasDown = (input.bits & bit) !== 0;
      input.bits |= bit;
      // Custom encoder repeat path: ignore OS-repeat pulses and manage hold repeats in consumeInputWord().
      if (!e.repeat && !wasDown) {
        if (bit === INPUT_ENC_CW) {
          input.encDelta += 1;
          input.encPressedMask |= INPUT_ENC_CW;
        } else if (bit === INPUT_ENC_CCW) {
          input.encDelta -= 1;
          input.encPressedMask |= INPUT_ENC_CCW;
        }
      }
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (isEditable(e)) return;
    const bit = KEY_MAP[e.key];
    if (bit !== undefined) {
      input.bits &= ~bit;
      if (bit === INPUT_ENC_CW) input.encHoldFramesCw = 0;
      else if (bit === INPUT_ENC_CCW) input.encHoldFramesCcw = 0;
      e.preventDefault();
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

/** Press a bit (for on-screen buttons). */
export function pressInput(input: InputState, bit: number): void {
  input.bits |= bit;
  // Capture quick taps between frames.
  if (bit === INPUT_ENC_CW) {
    input.encDelta += 1;
    input.encPressedMask |= INPUT_ENC_CW;
  } else if (bit === INPUT_ENC_CCW) {
    input.encDelta -= 1;
    input.encPressedMask |= INPUT_ENC_CCW;
  }
}

/** Release a bit (for on-screen buttons). */
export function releaseInput(input: InputState, bit: number): void {
  input.bits &= ~bit;
  if (bit === INPUT_ENC_CW) input.encHoldFramesCw = 0;
  else if (bit === INPUT_ENC_CCW) input.encHoldFramesCcw = 0;
}

/** Encode the VM INPUT() word and consume this frame's accumulated encoder delta. */
export function consumeInputWord(input: InputState): number {
  let delta = input.encDelta;

  // No-delay custom hold repeat for encoder keys/buttons (one pulse per frame while held).
  // Skip one frame for keys that were first-pressed since the previous consume to avoid double count.
  const heldCw = (input.bits & INPUT_ENC_CW) !== 0;
  const heldCcw = (input.bits & INPUT_ENC_CCW) !== 0;
  if (heldCw && !heldCcw && (input.encPressedMask & INPUT_ENC_CW) === 0) {
    input.encHoldFramesCw++;
    if (
      input.encHoldFramesCw >= ENC_HOLD_INITIAL_DELAY_FRAMES &&
      (input.encHoldFramesCw - ENC_HOLD_INITIAL_DELAY_FRAMES) % ENC_HOLD_REPEAT_EVERY_FRAMES === 0
    ) {
      delta += 1;
    }
  } else {
    input.encHoldFramesCw = 0;
  }
  if (heldCcw && !heldCw && (input.encPressedMask & INPUT_ENC_CCW) === 0) {
    input.encHoldFramesCcw++;
    if (
      input.encHoldFramesCcw >= ENC_HOLD_INITIAL_DELAY_FRAMES &&
      (input.encHoldFramesCcw - ENC_HOLD_INITIAL_DELAY_FRAMES) % ENC_HOLD_REPEAT_EVERY_FRAMES === 0
    ) {
      delta -= 1;
    }
  } else {
    input.encHoldFramesCcw = 0;
  }

  if (delta > 127) delta = 127;
  if (delta < -128) delta = -128;
  input.encDelta = 0;
  input.encPressedMask = 0;
  return (input.bits & 0x00ff) | ((delta & 0xff) << INPUT_ENC_DELTA_SHIFT);
}
