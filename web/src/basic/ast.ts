// ── Expression nodes ──────────────────────────────────────────────

export interface NumberLiteral {
  kind: "number";
  value: number;
}

export interface StringLiteral {
  kind: "string";
  value: string;
}

export interface Variable {
  kind: "variable";
  name: string;
}

export interface ArrayAccess {
  kind: "array_access";
  name: string;
  index: Expr;
}

export interface UnaryOp {
  kind: "unary";
  op: "NEG" | "NOT";
  operand: Expr;
}

export type BinaryOperator =
  | "ADD"
  | "SUB"
  | "MUL"
  | "DIV"
  | "MOD"
  | "AND"
  | "OR"
  | "XOR"
  | "SHL"
  | "SHR"
  | "EQ"
  | "NEQ"
  | "LT"
  | "GT"
  | "LTE"
  | "GTE";

export interface BinaryOp {
  kind: "binary";
  op: BinaryOperator;
  left: Expr;
  right: Expr;
}

export interface FunctionCall {
  kind: "call";
  name: string;
  args: Expr[];
}

export type Expr =
  | NumberLiteral
  | StringLiteral
  | Variable
  | ArrayAccess
  | UnaryOp
  | BinaryOp
  | FunctionCall;

// ── Statement nodes ──────────────────────────────────────────────

export interface AssignStmt {
  kind: "assign";
  name: string;
  expr: Expr;
}

export interface ArrayAssignStmt {
  kind: "array_assign";
  name: string;
  index: Expr;
  expr: Expr;
}

export interface IfStmt {
  kind: "if";
  branches: { condition: Expr; body: Stmt[] }[];
  elseBranch: Stmt[] | null;
}

export interface ForStmt {
  kind: "for";
  variable: string;
  from: Expr;
  to: Expr;
  step: Expr | null;
  body: Stmt[];
}

export interface DoLoopStmt {
  kind: "do_loop";
  /** If null, infinite loop (DO...LOOP). */
  condition: Expr | null;
  /** true = test at top (DO WHILE/UNTIL), false = test at bottom (LOOP WHILE/UNTIL). */
  testAtTop: boolean;
  /** true = loop while true, false = loop until true (inverts JZ/JNZ). */
  isWhile: boolean;
  body: Stmt[];
}

export interface GotoStmt {
  kind: "goto";
  label: string;
}


export interface LabelStmt {
  kind: "label";
  name: string;
}

export interface SubStmt {
  kind: "sub";
  name: string;
  params: string[];
  body: Stmt[];
}

export interface CallbackStmt {
  kind: "callback";
  name: string;
  params: string[];
  body: Stmt[];
}

export interface ExitStmt {
  kind: "exit";
  target: "for" | "do";
}

export interface SyscallStmt {
  kind: "syscall";
  name: string;
  args: Expr[];
}

export interface DimStmt {
  kind: "dim";
  name: string;
  size: number;
}

export interface ConstStmt {
  kind: "const";
  name: string;
  value: number;
}

export interface DataStmt {
  kind: "data";
  name: string;
  bytes: number[];
}

export interface PokeStmt {
  kind: "poke";
  wide: boolean;
  addr: Expr;
  value: Expr;
}

export interface SubCallStmt {
  kind: "sub_call";
  name: string;
  args: Expr[];
}

export interface TupleAssignStmt {
  kind: "tuple_assign";
  names: string[];
  funcName: string;
  args: Expr[];
}

export type Stmt =
  | AssignStmt
  | ArrayAssignStmt
  | IfStmt
  | ForStmt
  | DoLoopStmt
  | GotoStmt
  | LabelStmt
  | SubStmt
  | CallbackStmt
  | ExitStmt
  | SyscallStmt
  | DimStmt
  | ConstStmt
  | DataStmt
  | PokeStmt
  | SubCallStmt
  | TupleAssignStmt;

// ── Program ──────────────────────────────────────────────────────

export interface Program {
  statements: Stmt[];
}
