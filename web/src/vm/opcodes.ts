export const Op = {
  HALT: 0x00,
  NOP: 0x01,
  PUSH8: 0x02,
  PUSH16: 0x03,
  POP: 0x04,
  DUP: 0x05,
  SWAP: 0x06,
  OVER: 0x07,

  ADD: 0x10,
  SUB: 0x11,
  MUL: 0x12,
  DIV: 0x13,
  MOD: 0x14,
  NEG: 0x15,

  AND: 0x20,
  OR: 0x21,
  XOR: 0x22,
  NOT: 0x23,
  SHL: 0x24,
  SHR: 0x25,

  EQ: 0x30,
  LT: 0x31,
  GT: 0x32,
  LTS: 0x33,
  GTS: 0x34,

  JMP: 0x40,
  JZ: 0x41,
  JNZ: 0x42,
  CALL: 0x43,
  RET: 0x44,

  LOAD: 0x50,
  STORE: 0x51,
  LOAD8: 0x52,
  STORE8: 0x53,
  LOAD_IDX: 0x54,
  STORE_IDX: 0x55,
  LOAD8_IDX: 0x56,
  STORE8_IDX: 0x57,

  SYSCALL: 0x60,
} as const;

export type Opcode = (typeof Op)[keyof typeof Op];

/** Number of inline operand bytes following each opcode. */
export const OPERAND_SIZES: Partial<Record<Opcode, number>> = {
  [Op.PUSH8]: 1,
  [Op.PUSH16]: 2,
  [Op.JMP]: 2,
  [Op.JZ]: 2,
  [Op.JNZ]: 2,
  [Op.CALL]: 2,
  [Op.LOAD]: 2,
  [Op.STORE]: 2,
  [Op.LOAD8]: 2,
  [Op.STORE8]: 2,
  [Op.SYSCALL]: 1,
};

/** Map mnemonic strings → opcode values. */
export const MNEMONIC_TO_OP: Record<string, Opcode> = {};
/** Map opcode values → mnemonic strings. */
export const OP_TO_MNEMONIC: Record<number, string> = {};

for (const [name, value] of Object.entries(Op)) {
  MNEMONIC_TO_OP[name] = value;
  OP_TO_MNEMONIC[value] = name;
}
