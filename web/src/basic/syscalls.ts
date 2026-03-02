import { Sys } from "../vm/syscall-ids.ts";

export interface SyscallDef {
  id: number;
  argCount: number;
  returns: boolean;
  /**
   * If specified, args are pushed in this order instead of left-to-right.
   * Each element is an index into the BASIC argument list.
   * Example: [1, 0, 3, 2] swaps pairs.
   */
  pushOrder?: number[];
}

/** Statements — void syscalls invoked as `NAME arg, arg, ...` */
export const SYSCALL_STMTS: Record<string, SyscallDef> = {
  CLEAR:      { id: Sys.CLEAR,     argCount: 0,  returns: false },
  PIXEL:      { id: Sys.PIXEL,     argCount: 3,  returns: false },
  LINE:       { id: Sys.LINE,      argCount: 4,  returns: false, pushOrder: [1, 0, 3, 2] },
  RECT:       { id: Sys.RECT,      argCount: 4,  returns: false },
  BLIT:       { id: Sys.BLIT,      argCount: 5,  returns: false },
  YIELD:      { id: Sys.YIELD,     argCount: 0,  returns: false },
  TEXT_SM:    { id: Sys.TEXT_SM,    argCount: 3,  returns: false },
  TEXT_LG:    { id: Sys.TEXT_LG,    argCount: 3,  returns: false },
  SPRITE:     { id: Sys.SPR_SET,   argCount: 10, returns: false },
  SPR_POS:    { id: Sys.SPR_POS,   argCount: 3,  returns: false },
  SPR_VEL:    { id: Sys.SPR_VEL,   argCount: 3,  returns: false },
  SPR_OFF:    { id: Sys.SPR_OFF,   argCount: 1,  returns: false },
  SPR_EDGE:   { id: Sys.SPR_EDGE,  argCount: 2,  returns: false },
  SPR_WALL:   { id: Sys.SPR_WALL,  argCount: 2,  returns: false },
  SPR_COLL:   { id: Sys.SPR_COLL,  argCount: 2,  returns: false },
  SPR_GROUP:  { id: Sys.SPR_GROUP, argCount: 3,  returns: false },
  SPR_ON_HIT: { id: Sys.SPR_ON_HIT, argCount: 2, returns: false },
  SPR_ROT:    { id: Sys.SPR_ROT,   argCount: 3,  returns: false },
  SPR_VIS:    { id: Sys.SPR_VIS,   argCount: 2,  returns: false },
  TEXT_NUM:   { id: Sys.TEXT_NUM,   argCount: 3,  returns: false },
  WALL_SET:   { id: Sys.WALL_SET,  argCount: 5,  returns: false },
  WALL_OFF:   { id: Sys.WALL_OFF,  argCount: 1,  returns: false },
  PFX_SET:    { id: Sys.PFX_SET,   argCount: 7,  returns: false },
  PFX_POS:    { id: Sys.PFX_POS,   argCount: 3,  returns: false },
  PFX_BURST:  { id: Sys.PFX_BURST, argCount: 2,  returns: false },
  PFX_ON:     { id: Sys.PFX_ON,    argCount: 2,  returns: false },
  PFX_CLEAR:  { id: Sys.PFX_CLEAR, argCount: 1,  returns: false },
  VOICE:      { id: Sys.VOICE,    argCount: 4,  returns: false },
  ENVELOPE:   { id: Sys.ENVELOPE, argCount: 5,  returns: false },
  NOTEOFF:    { id: Sys.NOTE_OFF, argCount: 1,  returns: false },
  FILTER:     { id: Sys.FILTER,   argCount: 4,  returns: false },
  VOLUME:     { id: Sys.VOLUME,   argCount: 1,  returns: false },
  TONE:       { id: Sys.TONE,     argCount: 3,  returns: false },
  SFX:        { id: Sys.SFX,      argCount: 2,  returns: false },
  HALT:       { id: -1,            argCount: 0,  returns: false }, // special: emits HALT opcode
};

/** Tuple functions — syscalls that return multiple values, used as `a, b = NAME(args)` */
export const SYSCALL_TUPLE_FUNCS: Record<string, SyscallDef & { returnCount: number }> = {
  SPR_GET: { id: Sys.SPR_GET, argCount: 1, returns: true, returnCount: 2 },
};

/** Functions — syscalls that return a value, used in expressions as `NAME(args)` */
export const SYSCALL_FUNCS: Record<string, SyscallDef> = {
  INPUT:      { id: Sys.INPUT,     argCount: 0,  returns: true },
  RAND:       { id: Sys.RAND,      argCount: 0,  returns: true },
  TIME:       { id: Sys.TIME,      argCount: 0,  returns: true },
  SIN:        { id: Sys.SIN,       argCount: 1,  returns: true },
  COS:        { id: Sys.COS,       argCount: 1,  returns: true },
  SPR_HIT:    { id: Sys.SPR_HIT,   argCount: 1,  returns: true },
  SPR_GETROT: { id: Sys.SPR_GETROT, argCount: 1, returns: true },
  ASHR:       { id: Sys.ASHR,      argCount: 2, returns: true },
  FX_MUL:     { id: Sys.FX_MUL,    argCount: 3, returns: true },
};
