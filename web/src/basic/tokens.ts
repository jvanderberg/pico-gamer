export const enum TokenType {
  // Literals
  Number,
  String,
  Identifier,

  // Operators
  Plus,
  Minus,
  Star,
  Eq,
  NotEq,
  Lt,
  Gt,
  LtEq,
  GtEq,
  LParen,
  RParen,
  Comma,
  Colon,
  Dollar,

  // Keywords
  AND,
  OR,
  XOR,
  NOT,
  SHL,
  SHR,
  DIV,
  MOD,
  IF,
  THEN,
  ELSEIF,
  ELSE,
  END,
  FOR,
  TO,
  STEP,
  NEXT,
  DO,
  LOOP,
  WHILE,
  UNTIL,
  GOTO,
  SUB,
  EXIT,
  DIM,
  CONST,
  DATA,
  EFFECT,
  SONG,
  TRACK,
  CALLBACK,
  REM,

  // Special
  Label,
  Newline,
  EOF,
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

/** Map of uppercase keyword strings to token types. */
export const KEYWORDS: Record<string, TokenType> = {
  AND: TokenType.AND,
  OR: TokenType.OR,
  XOR: TokenType.XOR,
  NOT: TokenType.NOT,
  SHL: TokenType.SHL,
  SHR: TokenType.SHR,
  DIV: TokenType.DIV,
  MOD: TokenType.MOD,
  IF: TokenType.IF,
  THEN: TokenType.THEN,
  ELSEIF: TokenType.ELSEIF,
  ELSE: TokenType.ELSE,
  END: TokenType.END,
  FOR: TokenType.FOR,
  TO: TokenType.TO,
  STEP: TokenType.STEP,
  NEXT: TokenType.NEXT,
  DO: TokenType.DO,
  LOOP: TokenType.LOOP,
  WHILE: TokenType.WHILE,
  UNTIL: TokenType.UNTIL,
  GOTO: TokenType.GOTO,
  SUB: TokenType.SUB,
  EXIT: TokenType.EXIT,
  DIM: TokenType.DIM,
  CONST: TokenType.CONST,
  DATA: TokenType.DATA,
  EFFECT: TokenType.EFFECT,
  SONG: TokenType.SONG,
  TRACK: TokenType.TRACK,
  CALLBACK: TokenType.CALLBACK,
  REM: TokenType.REM,
};
