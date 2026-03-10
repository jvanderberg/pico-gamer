import type {
  Program,
  Stmt,
  Expr,
  BinaryOperator,
} from "./ast.ts";
import { SYSCALL_STMTS, SYSCALL_FUNCS, SYSCALL_TUPLE_FUNCS } from "./syscalls.ts";

/** Starting address for auto-allocated variables (2 bytes each). */
const VAR_BASE = 0xc100;

/** Built-in API constants pre-seeded into every BASIC program. */
const BUILTIN_CONSTS: Record<string, number> = {
  // Input bits
  INPUT_UP: 1,
  INPUT_DOWN: 2,
  INPUT_LEFT: 4,
  INPUT_RIGHT: 8,
  INPUT_BTN: 16,
  INPUT_ENC_CW: 32,
  INPUT_ENC_CCW: 64,
  INPUT_ENC_BTN: 128,
  INPUT_ENC_DELTA_SHIFT: 8,
  INPUT_ENC_DELTA_MASK: 0xFF00,

  // Edge modes
  EDGE_NONE: 0,
  EDGE_WRAP: 1,
  EDGE_BOUNCE: 2,
  EDGE_DESTROY: 3,
  EDGE_STOP: 4,

  // Collision / wall modes
  COLL_NONE: 0,
  COLL_DETECT: 1,
  COLL_BOUNCE: 2,
  COLL_DESTROY: 3,
  COLL_STOP: 4,

  // Sprite flags
  SPR_FLIPX: 1,
  SPR_FLIPY: 2,
  SPR_VECTOR: 4,

  // Camera / scroll modes
  SCROLL_NONE: 0,
  SCROLL_FOLLOW: 1,
  SCROLL_MANUAL: 2,

  // Tile properties
  TILE_SOLID: 1,
  TILE_ANIM: 2,

  // Direction constants
  DIR_RIGHT: 0,
  DIR_DOWN: 1,
  DIR_LEFT: 2,
  DIR_UP: 3,

  // Particle flags
  PFX_ALL: 255,
  PFX_2X2: 4,
  PFX_BLACK: 8,
  PFX_SPEED_VAR: 16,
  PFX_LIFE_VAR: 32,

  // Waveform IDs
  OFF: 0,
  WAVE_OFF: 0,
  WAVE_PULSE: 1,
  WAVE_SAW: 2,
  WAVE_TRI: 3,
  WAVE_NOISE: 4,

  // Filter modes
  FILTER_LP: 0,
  FILTER_BP: 1,
  FILTER_HP: 2,
  FILTER_NOTCH: 3,
  FILTER_COMB: 4,

  // SFX preset IDs
  SFX_LASER: 0,
  SFX_EXPLODE: 1,
  SFX_PICKUP: 2,
  SFX_JUMP: 3,
  SFX_HIT: 4,
  SFX_BOUNCE: 5,
  SFX_POWERUP: 6,
  SFX_DEATH: 7,
  SFX_COIN: 8,
  SFX_BEEP: 9,
  SFX_THUD: 10,
  SFX_ZAP: 11,
  SFX_ALARM: 12,
  SFX_CLICK: 13,
  SFX_WHOOSH: 14,
  SFX_BLIP: 15,
};

const NOTE_NAMES = ["C", "CS", "D", "DS", "E", "F", "FS", "G", "GS", "A", "AS", "B"];
for (let octave = 0; octave <= 8; octave++) {
  for (let semitone = 0; semitone < NOTE_NAMES.length; semitone++) {
    BUILTIN_CONSTS[`${NOTE_NAMES[semitone]}${octave}`] = 12 + octave * 12 + semitone;
  }
}

interface CodeGenState {
  lines: string[];
  dataSection: string[];
  subSection: string[];
  /** variable name → memory address */
  vars: Map<string, number>;
  /** array name → { addr, size } */
  arrays: Map<string, { addr: number; size: number }>;
  /** constant name → value */
  consts: Map<string, number>;
  /** DATA block name → assembly label */
  dataLabels: Map<string, string>;
  /** string literal dedup: value → label */
  strings: Map<string, string>;
  nextVarAddr: number;
  labelCounter: number;
  /** Stack of exit labels for EXIT FOR / EXIT DO */
  forExitStack: string[];
  doExitStack: string[];
  /** callback name → assembly label */
  callbackLabels: Map<string, string>;
  /** Are we currently inside a SUB? */
  inSub: boolean;
  /** SUB name → param names (for resolving call-site arg passing) */
  subParams: Map<string, string[]>;
}

interface EffectStepDef {
  delay: Expr;
  waveform: Expr;
  freq: Expr | null;
  pulseWidth: Expr | null;
  volume: Expr | null;
  filterCutoff: Expr | null;
}

function createState(): CodeGenState {
  return {
    lines: [],
    dataSection: [],
    subSection: [],
    vars: new Map(),
    arrays: new Map(),
    consts: new Map(),
    dataLabels: new Map(),
    callbackLabels: new Map(),
    strings: new Map(),
    nextVarAddr: VAR_BASE,
    labelCounter: 0,
    forExitStack: [],
    doExitStack: [],
    inSub: false,
    subParams: new Map(),
  };
}

function freshLabel(s: CodeGenState, prefix: string): string {
  return `__${prefix}_${s.labelCounter++}`;
}

function emit(s: CodeGenState, line: string): void {
  if (s.inSub) {
    s.subSection.push(line);
  } else {
    s.lines.push(line);
  }
}

function emitLabel(s: CodeGenState, label: string): void {
  emit(s, `${label}:`);
}

function dataLabel(name: string): string {
  return `__data_${name.toLowerCase()}`;
}

function effectLabel(name: string): string {
  return `__effect_${name.toLowerCase()}`;
}

function songLabel(name: string): string {
  return `__song_${name.toLowerCase()}`;
}

function songTrackEventsLabel(songName: string, trackIndex: number): string {
  return `__song_${songName.toLowerCase()}_events_${trackIndex}`;
}

/** Get or allocate a 2-byte variable address. */
function varAddr(s: CodeGenState, name: string): number {
  // Check constants first
  const c = s.consts.get(name.toUpperCase());
  if (c !== undefined) return -1; // sentinel: use constant value instead

  const key = name.toUpperCase();
  let addr = s.vars.get(key);
  if (addr === undefined) {
    addr = s.nextVarAddr;
    s.vars.set(key, addr);
    s.nextVarAddr += 2;
  }
  return addr;
}

function resolveValue(s: CodeGenState, name: string): { kind: "const"; value: number } | { kind: "addr"; addr: number } {
  const upper = name.toUpperCase();
  const c = s.consts.get(upper);
  if (c !== undefined) return { kind: "const", value: c };
  return { kind: "addr", addr: varAddr(s, name) };
}

function evalConstExpr(s: CodeGenState, expr: Expr): number {
  switch (expr.kind) {
    case "number":
      return expr.value & 0xffff;
    case "variable": {
      const c = s.consts.get(expr.name.toUpperCase());
      if (c === undefined) throw new Error(`Compile-time constant required: ${expr.name}`);
      return c & 0xffff;
    }
    case "unary": {
      const operand = evalConstExpr(s, expr.operand);
      if (expr.op === "NEG") return (-operand) & 0xffff;
      if (expr.op === "NOT") return (~operand) & 0xffff;
      break;
    }
    case "binary": {
      const left = evalConstExpr(s, expr.left);
      const right = evalConstExpr(s, expr.right);
      switch (expr.op) {
        case "ADD": return (left + right) & 0xffff;
        case "SUB": return (left - right) & 0xffff;
        case "MUL": return (left * right) & 0xffff;
        case "DIV": return right === 0 ? 0 : Math.floor(left / right) & 0xffff;
        case "MOD": return right === 0 ? 0 : (left % right) & 0xffff;
        case "AND": return (left & right) & 0xffff;
        case "OR": return (left | right) & 0xffff;
        case "XOR": return (left ^ right) & 0xffff;
        case "SHL": return (left << right) & 0xffff;
        case "SHR": return (left >>> right) & 0xffff;
        case "EQ": return left === right ? 1 : 0;
        case "NEQ": return left !== right ? 1 : 0;
        case "LT": return left < right ? 1 : 0;
        case "GT": return left > right ? 1 : 0;
        case "LTE": return left <= right ? 1 : 0;
        case "GTE": return left >= right ? 1 : 0;
      }
      break;
    }
    default:
      break;
  }
  throw new Error("Compile-time constant required");
}

interface SongEventDef {
  pitch: number;
  duration: number;
}

const SONG_REST_PITCH = 0xff;

function parseSongPattern(pattern: string): SongEventDef[] {
  const tokens = pattern.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
  const events: SongEventDef[] = [];
  const semitones: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };

  for (const token of tokens) {
    const restMatch = /^R:(\d+)$/i.exec(token) ?? /^-:(\d+)$/i.exec(token);
    if (restMatch) {
      const duration = parseInt(restMatch[1]!, 10);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 255) {
        throw new Error(`Invalid song rest duration: ${token}`);
      }
      events.push({ pitch: SONG_REST_PITCH, duration });
      continue;
    }

    const noteMatch = /^([A-Ga-g])((?:#|S)?)([0-8]):(\d+)$/.exec(token);
    if (!noteMatch) {
      throw new Error(`Invalid song note token: ${token}`);
    }

    const letter = noteMatch[1]!.toUpperCase();
    const accidental = noteMatch[2]!.toUpperCase();
    const octave = parseInt(noteMatch[3]!, 10);
    const duration = parseInt(noteMatch[4]!, 10);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 255) {
      throw new Error(`Invalid song note duration: ${token}`);
    }

    let semitone = semitones[letter]!;
    if (accidental === "#" || accidental === "S") semitone += 1;
    const pitch = 12 + octave * 12 + semitone;
    if (pitch < 0 || pitch > 127) {
      throw new Error(`Song note out of MIDI range: ${token}`);
    }
    events.push({ pitch, duration });
  }

  if (events.length === 0) {
    throw new Error("Song track pattern must contain at least one event");
  }
  if (events.length > 65535) {
    throw new Error("Song track exceeds 65535 events");
  }
  return events;
}

function resolveDataReference(s: CodeGenState, expr: Expr, what: string): string {
  if (expr.kind !== "variable") {
    throw new Error(`${what} must be a named label`);
  }
  const label = s.dataLabels.get(expr.name.toUpperCase());
  if (!label) {
    throw new Error(`Unknown ${what}: ${expr.name}`);
  }
  return label;
}

function pushImmediate(s: CodeGenState, value: number): void {
  const v = value & 0xffff;
  if (v <= 255) {
    emit(s, `  PUSH8 ${v}`);
  } else {
    emit(s, `  PUSH16 ${v}`);
  }
}

/** Allocate a string in the data section, returning its label. */
function allocString(s: CodeGenState, value: string): string {
  const existing = s.strings.get(value);
  if (existing) return existing;
  const label = freshLabel(s, "str");
  const bytes = [];
  for (let i = 0; i < value.length; i++) {
    bytes.push(value.charCodeAt(i) & 0xff);
  }
  bytes.push(0); // null terminator
  s.dataSection.push(`${label}:`);
  s.dataSection.push(`  .data ${bytes.join(", ")}`);
  s.strings.set(value, label);
  return label;
}

// ── Expression code generation ──────────────────────────────

function emitExpr(s: CodeGenState, expr: Expr): void {
  switch (expr.kind) {
    case "number":
      pushImmediate(s, expr.value);
      break;

    case "string": {
      const label = allocString(s, expr.value);
      emit(s, `  PUSH16 ${label}`);
      break;
    }

    case "variable": {
      const r = resolveValue(s, expr.name);
      if (r.kind === "const") {
        pushImmediate(s, r.value);
      } else {
        // Check if it's a DATA or CALLBACK label
        const dataLabel = s.dataLabels.get(expr.name.toUpperCase());
        const cbLabel = s.callbackLabels.get(expr.name.toUpperCase());
        if (dataLabel) {
          emit(s, `  PUSH16 ${dataLabel}`);
        } else if (cbLabel) {
          emit(s, `  PUSH16 ${cbLabel}`);
        } else {
          emit(s, `  LOAD ${r.addr}`);
        }
      }
      break;
    }

    case "array_access": {
      const upper = expr.name.toUpperCase();
      const arr = s.arrays.get(upper);
      if (!arr) {
        // Could be a SUB call or function — fall through to generic handling
        // For now, treat as undeclared array (will use var base as fallback)
        throw new Error(`Undeclared array: ${expr.name}`);
      }
      // addr = base + index * 2
      pushImmediate(s, arr.addr);
      emitExpr(s, expr.index);
      emit(s, `  PUSH8 2`);
      emit(s, `  MUL`);
      emit(s, `  ADD`);
      emit(s, `  LOAD_IDX`);
      break;
    }

    case "unary":
      emitExpr(s, expr.operand);
      emit(s, `  ${expr.op}`);
      break;

    case "binary":
      emitBinaryOp(s, expr.op, expr.left, expr.right);
      break;

    case "call":
      emitFunctionCall(s, expr.name, expr.args);
      break;
  }
}

function emitBinaryOp(
  s: CodeGenState,
  op: BinaryOperator,
  left: Expr,
  right: Expr,
): void {
  emitExpr(s, left);
  emitExpr(s, right);

  switch (op) {
    case "ADD": emit(s, "  ADD"); break;
    case "SUB": emit(s, "  SUB"); break;
    case "MUL": emit(s, "  MUL"); break;
    case "DIV": emit(s, "  DIV"); break;
    case "MOD": emit(s, "  MOD"); break;
    case "AND": emit(s, "  AND"); break;
    case "OR":  emit(s, "  OR"); break;
    case "XOR": emit(s, "  XOR"); break;
    case "SHL": emit(s, "  SHL"); break;
    case "SHR": emit(s, "  SHR"); break;
    case "EQ":  emit(s, "  EQ"); break;
    case "LT":  emit(s, "  LTS"); break;  // signed
    case "GT":  emit(s, "  GTS"); break;  // signed
    case "NEQ":
      emit(s, "  EQ");
      emit(s, "  PUSH8 1");
      emit(s, "  XOR");
      break;
    case "LTE":
      emit(s, "  GTS");       // a > b (signed)
      emit(s, "  PUSH8 1");
      emit(s, "  XOR");       // flip → a <= b
      break;
    case "GTE":
      emit(s, "  LTS");       // a < b (signed)
      emit(s, "  PUSH8 1");
      emit(s, "  XOR");       // flip → a >= b
      break;
  }
}

function emitFunctionCall(s: CodeGenState, name: string, args: Expr[]): void {
  const upper = name.toUpperCase();

  // ABS — compiler-generated
  if (upper === "ABS") {
    // ABS(x): if x >= 0x8000 (negative in i16), negate it
    emitExpr(s, args[0]!);
    emit(s, "  DUP");
    emit(s, "  PUSH16 32768"); // 0x8000
    emit(s, "  AND");
    const skipLabel = freshLabel(s, "abs_skip");
    emit(s, `  JZ ${skipLabel}`);
    emit(s, "  NEG");
    emitLabel(s, skipLabel);
    return;
  }

  // PEEK / PEEK16
  if (upper === "PEEK") {
    emitExpr(s, args[0]!);
    emit(s, "  LOAD8_IDX");
    return;
  }
  if (upper === "PEEK16") {
    emitExpr(s, args[0]!);
    emit(s, "  LOAD_IDX");
    return;
  }

  // Syscall functions
  const fn = SYSCALL_FUNCS[upper];
  if (fn) {
    for (const arg of args) {
      emitExpr(s, arg);
    }
    emit(s, `  SYSCALL ${fn.id}`);
    return;
  }

  throw new Error(`Unknown function: ${name}`);
}

// ── Statement code generation ───────────────────────────────

function emitStmt(s: CodeGenState, stmt: Stmt): void {
  switch (stmt.kind) {
    case "assign":
      emitAssign(s, stmt.name, stmt.expr);
      break;

    case "array_assign":
      emitArrayAssign(s, stmt.name, stmt.index, stmt.expr);
      break;

    case "if":
      emitIf(s, stmt);
      break;

    case "for":
      emitFor(s, stmt);
      break;

    case "do_loop":
      emitDoLoop(s, stmt);
      break;

    case "goto":
      emit(s, `  JMP ${stmt.label}`);
      break;


    case "label":
      emitLabel(s, stmt.name);
      break;

    case "sub":
      emitSub(s, stmt);
      break;

    case "callback":
      emitCallback(s, stmt);
      break;

    case "exit":
      emitExit(s, stmt);
      break;

    case "syscall":
      emitSyscall(s, stmt.name, stmt.args);
      break;

    case "dim":
      emitDim(s, stmt);
      break;

    case "const":
      s.consts.set(stmt.name.toUpperCase(), stmt.value);
      break;

    case "data":
      emitData(s, stmt);
      break;

    case "poke":
      emitPoke(s, stmt);
      break;

    case "sub_call":
      emitSubCall(s, stmt);
      break;

    case "tuple_assign":
      emitTupleAssign(s, stmt);
      break;
  }
}

function emitAssign(s: CodeGenState, name: string, expr: Expr): void {
  const r = resolveValue(s, name);
  if (r.kind === "const") {
    throw new Error(`Cannot assign to constant: ${name}`);
  }
  emitExpr(s, expr);
  emit(s, `  STORE ${r.addr}`);
}

function emitArrayAssign(
  s: CodeGenState,
  name: string,
  index: Expr,
  expr: Expr,
): void {
  const upper = name.toUpperCase();
  const arr = s.arrays.get(upper);
  if (!arr) throw new Error(`Undeclared array: ${name}`);

  // Compute value first, then address, then SWAP + STORE_IDX
  emitExpr(s, expr);
  // Compute address: base + index * 2
  pushImmediate(s, arr.addr);
  emitExpr(s, index);
  emit(s, "  PUSH8 2");
  emit(s, "  MUL");
  emit(s, "  ADD");
  // Stack: value, address — STORE_IDX pops address then value
  emit(s, "  STORE_IDX");
}

function emitIf(
  s: CodeGenState,
  stmt: { branches: { condition: Expr; body: Stmt[] }[]; elseBranch: Stmt[] | null },
): void {
  const endLabel = freshLabel(s, "endif");

  for (let i = 0; i < stmt.branches.length; i++) {
    const branch = stmt.branches[i]!;
    const nextLabel =
      i < stmt.branches.length - 1 || stmt.elseBranch
        ? freshLabel(s, "else")
        : endLabel;

    emitExpr(s, branch.condition);
    emit(s, `  JZ ${nextLabel}`);
    for (const st of branch.body) emitStmt(s, st);
    if (nextLabel !== endLabel) {
      emit(s, `  JMP ${endLabel}`);
    }
    if (nextLabel !== endLabel) {
      emitLabel(s, nextLabel);
    }
  }

  if (stmt.elseBranch) {
    for (const st of stmt.elseBranch) emitStmt(s, st);
  }

  emitLabel(s, endLabel);
}

function emitFor(
  s: CodeGenState,
  stmt: {
    variable: string;
    from: Expr;
    to: Expr;
    step: Expr | null;
    body: Stmt[];
  },
): void {
  const addr = varAddr(s, stmt.variable);
  const topLabel = freshLabel(s, "for_top");
  const endLabel = freshLabel(s, "for_end");

  // Initialize: var = from
  emitExpr(s, stmt.from);
  emit(s, `  STORE ${addr}`);

  // Loop top: check var > to → exit
  emitLabel(s, topLabel);
  emitExpr(s, stmt.to);
  emit(s, `  LOAD ${addr}`);
  emit(s, "  SWAP");
  // Stack: var, to → GTS checks if var > to
  emit(s, "  GTS");
  emit(s, `  JNZ ${endLabel}`);

  // Body
  s.forExitStack.push(endLabel);
  for (const st of stmt.body) emitStmt(s, st);
  s.forExitStack.pop();

  // Increment: var = var + step
  emit(s, `  LOAD ${addr}`);
  if (stmt.step) {
    emitExpr(s, stmt.step);
  } else {
    emit(s, "  PUSH8 1");
  }
  emit(s, "  ADD");
  emit(s, `  STORE ${addr}`);
  emit(s, `  JMP ${topLabel}`);

  emitLabel(s, endLabel);
}

function emitDoLoop(
  s: CodeGenState,
  stmt: {
    condition: Expr | null;
    testAtTop: boolean;
    isWhile: boolean;
    body: Stmt[];
  },
): void {
  const topLabel = freshLabel(s, "do_top");
  const endLabel = freshLabel(s, "do_end");

  emitLabel(s, topLabel);

  // Test at top: DO WHILE/UNTIL cond
  if (stmt.condition && stmt.testAtTop) {
    emitExpr(s, stmt.condition);
    if (stmt.isWhile) {
      emit(s, `  JZ ${endLabel}`);
    } else {
      emit(s, `  JNZ ${endLabel}`);
    }
  }

  // Body
  s.doExitStack.push(endLabel);
  for (const st of stmt.body) emitStmt(s, st);
  s.doExitStack.pop();

  // Test at bottom: LOOP WHILE/UNTIL cond
  if (stmt.condition && !stmt.testAtTop) {
    emitExpr(s, stmt.condition);
    if (stmt.isWhile) {
      emit(s, `  JNZ ${topLabel}`);
    } else {
      emit(s, `  JZ ${topLabel}`);
    }
  } else if (!stmt.condition) {
    // Infinite loop
    emit(s, `  JMP ${topLabel}`);
  } else {
    // Top-tested loop — always jump back
    emit(s, `  JMP ${topLabel}`);
  }

  emitLabel(s, endLabel);
}

function emitSub(
  s: CodeGenState,
  stmt: { name: string; params: string[]; body: Stmt[] },
): void {
  const label = `__sub_${stmt.name.toLowerCase()}`;
  const prevInSub = s.inSub;
  s.inSub = true;

  s.subSection.push(`${label}:`);
  for (const st of stmt.body) emitStmt(s, st);
  s.subSection.push("  RET");

  s.inSub = prevInSub;
}

function emitCallback(
  s: CodeGenState,
  stmt: { name: string; params: string[]; body: Stmt[] },
): void {
  const label = `__cb_${stmt.name.toLowerCase()}`;
  s.callbackLabels.set(stmt.name.toUpperCase(), label);

  // Allocate a scratch variable for the return address
  const retAddr = varAddr(s, `__cb_ret_${stmt.name.toLowerCase()}`);

  const prevInSub = s.inSub;
  s.inSub = true;

  s.subSection.push(`${label}:`);

  // Prologue: engine pushes [slot, returnAddr] with returnAddr on top
  s.subSection.push(`  STORE ${retAddr}`); // save returnAddr

  // Save params from stack (in reverse order since they're pushed left-to-right)
  for (let i = stmt.params.length - 1; i >= 0; i--) {
    const addr = varAddr(s, stmt.params[i]!);
    s.subSection.push(`  STORE ${addr}`);
  }

  // Body
  for (const st of stmt.body) emitStmt(s, st);

  // Epilogue: push returnAddr and RET
  s.subSection.push(`  LOAD ${retAddr}`);
  s.subSection.push("  RET");

  s.inSub = prevInSub;
}

function emitExit(s: CodeGenState, stmt: { target: "for" | "do" }): void {
  const stack = stmt.target === "for" ? s.forExitStack : s.doExitStack;
  if (stack.length === 0) {
    throw new Error(`EXIT ${stmt.target.toUpperCase()} outside of ${stmt.target.toUpperCase()} loop`);
  }
  emit(s, `  JMP ${stack[stack.length - 1]}`);
}

function emitSyscall(s: CodeGenState, name: string, args: Expr[]): void {
  const upper = name.toUpperCase();

  // Special case: HALT is an opcode, not a syscall
  if (upper === "HALT") {
    emit(s, "  HALT");
    return;
  }

  const def = SYSCALL_STMTS[upper];
  if (!def) throw new Error(`Unknown statement: ${name}`);

  // Push args in the correct order
  const pushOrder = def.pushOrder ?? args.map((_, i) => i);
  for (const idx of pushOrder) {
    emitExpr(s, args[idx]!);
  }
  emit(s, `  SYSCALL ${def.id}`);
}

function emitDim(
  s: CodeGenState,
  stmt: { name: string; size: number },
): void {
  const upper = stmt.name.toUpperCase();
  const byteCount = stmt.size * 2;
  const addr = s.nextVarAddr;
  s.arrays.set(upper, { addr, size: stmt.size });
  s.nextVarAddr += byteCount;
}

function emitData(
  s: CodeGenState,
  stmt: { name: string; bytes: number[] },
): void {
  const label = dataLabel(stmt.name);
  s.dataLabels.set(stmt.name.toUpperCase(), label);
  s.dataSection.push(`${label}:`);
  s.dataSection.push(`  .data ${stmt.bytes.join(", ")}`);
}

function emitEffect(
  s: CodeGenState,
  stmt: { name: string; steps: EffectStepDef[] },
): void {
  if (stmt.steps.length > 255) {
    throw new Error(`Effect ${stmt.name} exceeds 255 steps`);
  }

  const bytes: number[] = [stmt.steps.length & 0xff];
  for (const step of stmt.steps) {
    const delay = evalConstExpr(s, step.delay) & 0xffff;
    const waveform = evalConstExpr(s, step.waveform) & 0xff;
    const freq = step.freq ? evalConstExpr(s, step.freq) & 0xffff : 0;
    const pulseWidth = step.pulseWidth ? evalConstExpr(s, step.pulseWidth) & 0xff : 0xff;
    const volume = step.volume ? evalConstExpr(s, step.volume) & 0xff : 0xff;
    const filterCutoff = step.filterCutoff ? evalConstExpr(s, step.filterCutoff) & 0xff : 0;

    bytes.push(delay & 0xff, (delay >> 8) & 0xff);
    bytes.push(waveform);
    bytes.push(freq & 0xff, (freq >> 8) & 0xff);
    bytes.push(pulseWidth, volume, filterCutoff);
  }

  const label = effectLabel(stmt.name);
  s.dataLabels.set(stmt.name.toUpperCase(), label);
  s.dataSection.push(`${label}:`);
  s.dataSection.push(`  .data ${bytes.join(", ")}`);
}

function emitSong(
  s: CodeGenState,
  stmt: {
    name: string;
    bpm: Expr;
    loop: Expr;
    tracks: Array<{
      voice: Expr;
      effect: Expr;
      vibratoRate: Expr;
      vibratoDepth: Expr;
      pattern: Expr;
    }>;
  },
): void {
  if (stmt.tracks.length === 0) {
    throw new Error(`Song ${stmt.name} must contain at least one TRACK`);
  }
  if (stmt.tracks.length > 255) {
    throw new Error(`Song ${stmt.name} exceeds 255 tracks`);
  }

  const label = songLabel(stmt.name);
  s.dataLabels.set(stmt.name.toUpperCase(), label);
  s.dataSection.push(`${label}:`);
  s.dataSection.push(`  .data ${stmt.tracks.length & 0xff}, ${evalConstExpr(s, stmt.bpm) & 0xff}, ${evalConstExpr(s, stmt.loop) & 0xff}`);

  for (let i = 0; i < stmt.tracks.length; i++) {
    const track = stmt.tracks[i]!;
    const voice = evalConstExpr(s, track.voice) & 0xff;
    const vibratoRate = evalConstExpr(s, track.vibratoRate) & 0xffff;
    const vibratoDepth = evalConstExpr(s, track.vibratoDepth) & 0xffff;
    const effectRef = resolveDataReference(s, track.effect, "track effect");
    const eventsLabel = songTrackEventsLabel(stmt.name, i);
    s.dataSection.push(`  .data ${voice}`);
    s.dataSection.push(`  .data16 ${effectRef}, ${vibratoRate}, ${vibratoDepth}, ${eventsLabel}`);
  }

  for (let i = 0; i < stmt.tracks.length; i++) {
    const track = stmt.tracks[i]!;
    if (track.pattern.kind !== "string") {
      throw new Error(`Song track ${i} pattern must be a string literal`);
    }
    const events = parseSongPattern(track.pattern.value);
    const bytes: number[] = [events.length & 0xff, (events.length >> 8) & 0xff];
    for (const event of events) {
      bytes.push(event.pitch & 0xff, event.duration & 0xff);
    }
    s.dataSection.push(`${songTrackEventsLabel(stmt.name, i)}:`);
    s.dataSection.push(`  .data ${bytes.join(", ")}`);
  }
}

function emitPoke(
  s: CodeGenState,
  stmt: { wide: boolean; addr: Expr; value: Expr },
): void {
  // Push value first, then address → SWAP → STORE_IDX/STORE8_IDX
  emitExpr(s, stmt.value);
  emitExpr(s, stmt.addr);
  // STORE_IDX/STORE8_IDX pops: address (top), value (below)
  // Stack is: value, address — correct order for STORE_IDX
  if (stmt.wide) {
    emit(s, "  STORE_IDX");
  } else {
    emit(s, "  STORE8_IDX");
  }
}

function emitTupleAssign(
  s: CodeGenState,
  stmt: { names: string[]; funcName: string; args: Expr[] },
): void {
  const fn = SYSCALL_TUPLE_FUNCS[stmt.funcName];
  if (!fn) throw new Error(`Unknown tuple function: ${stmt.funcName}`);

  // Push args
  for (const arg of stmt.args) {
    emitExpr(s, arg);
  }
  emit(s, `  SYSCALL ${fn.id}`);

  // Store results in reverse name order (last return value is on top of stack)
  for (let i = stmt.names.length - 1; i >= 0; i--) {
    const addr = varAddr(s, stmt.names[i]!);
    emit(s, `  STORE ${addr}`);
  }
}

function emitSubCall(
  s: CodeGenState,
  stmt: { name: string; args: Expr[] },
): void {
  const params = s.subParams.get(stmt.name.toUpperCase());
  if (params && stmt.args.length > 0) {
    for (let i = 0; i < Math.min(stmt.args.length, params.length); i++) {
      emitExpr(s, stmt.args[i]!);
      const addr = varAddr(s, params[i]!);
      emit(s, `  STORE ${addr}`);
    }
  }
  emit(s, `  CALL __sub_${stmt.name.toLowerCase()}`);
}

// ── Top-level generation ────────────────────────────────────

/** Pre-pass to collect SUB declarations for parameter mapping. */
function collectSubs(stmts: Stmt[]): Map<string, string[]> {
  const subs = new Map<string, string[]>();
  for (const stmt of stmts) {
    if (stmt.kind === "sub") {
      subs.set(stmt.name.toUpperCase(), stmt.params);
    }
  }
  return subs;
}

function collectDataLabels(stmts: Stmt[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const stmt of stmts) {
    if (stmt.kind === "effect") {
      labels.set(stmt.name.toUpperCase(), effectLabel(stmt.name));
    } else if (stmt.kind === "data") {
      labels.set(stmt.name.toUpperCase(), dataLabel(stmt.name));
    } else if (stmt.kind === "song") {
      labels.set(stmt.name.toUpperCase(), songLabel(stmt.name));
    }
  }
  return labels;
}

export function generate(program: Program): string {
  const s = createState();

  // Pre-seed built-in API constants
  for (const [name, value] of Object.entries(BUILTIN_CONSTS)) {
    s.consts.set(name, value);
  }

  // Pre-pass: collect SUB param info so emitSubCall can resolve them
  s.subParams = collectSubs(program.statements);
  s.dataLabels = collectDataLabels(program.statements);

  // Process all statements
  for (const stmt of program.statements) {
    if (stmt.kind === "sub") {
      emitSub(s, stmt);
      continue;
    }

    if (stmt.kind === "callback") {
      emitCallback(s, stmt);
      continue;
    }

    if (stmt.kind === "effect") {
      emitEffect(s, stmt);
      continue;
    }

    if (stmt.kind === "song") {
      emitSong(s, stmt);
      continue;
    }

    emitStmt(s, stmt);
  }

  // Assemble final output
  const output: string[] = [];
  output.push("  JMP __main");

  // Data section
  if (s.dataSection.length > 0) {
    output.push("; --- data ---");
    output.push(...s.dataSection);
  }

  // Subroutines
  if (s.subSection.length > 0) {
    output.push("; --- subs ---");
    output.push(...s.subSection);
  }

  // Main
  output.push("; --- main ---");
  output.push("__main:");
  output.push(...s.lines);
  output.push("  HALT");

  return output.join("\n");
}
