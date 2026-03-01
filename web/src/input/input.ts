/**
 * Input state as a plain bitfield. No class — just track key state
 * and return the u16 that SYS_INPUT pushes onto the stack.
 */

export const INPUT_UP = 1 << 0;
export const INPUT_DOWN = 1 << 1;
export const INPUT_LEFT = 1 << 2;
export const INPUT_RIGHT = 1 << 3;
export const INPUT_BTN = 1 << 4;
export const INPUT_ENC_CW = 1 << 5;
export const INPUT_ENC_CCW = 1 << 6;
export const INPUT_ENC_BTN = 1 << 7;

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
}

export function createInput(): InputState {
  return { bits: 0 };
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
      input.bits |= bit;
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (isEditable(e)) return;
    const bit = KEY_MAP[e.key];
    if (bit !== undefined) {
      input.bits &= ~bit;
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
}

/** Release a bit (for on-screen buttons). */
export function releaseInput(input: InputState, bit: number): void {
  input.bits &= ~bit;
}
