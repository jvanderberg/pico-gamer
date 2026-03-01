import { describe, it, expect } from "vitest";
import { tokenize } from "../src/basic/lexer.ts";
import { TokenType } from "../src/basic/tokens.ts";
import { parse } from "../src/basic/parser.ts";
import { generate } from "../src/basic/codegen.ts";
import { compile, isCompileError } from "../src/basic/compiler.ts";
import { assemble, isError } from "../src/assembler/assembler.ts";
import { createHarness } from "../src/test-harness.ts";

// ── Helpers ─────────────────────────────────────────────────

/** Compile BASIC to assembly, assert no errors. */
function compileOk(source: string): string {
  const result = compile(source);
  if (isCompileError(result)) {
    throw new Error(
      `Compile error [${result.phase}] line ${result.line}: ${result.message}`,
    );
  }
  return result;
}

/** Compile BASIC → assembly → bytecode, load into harness. */
function loadBasic(source: string) {
  const h = createHarness();
  const asm = compileOk(source);
  h.load(asm);
  return h;
}

// ── Lexer tests ─────────────────────────────────────────────

describe("Lexer", () => {
  it("tokenizes numbers", () => {
    const tokens = tokenize("42 $FF 0x1A");
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    const nums = tokens.filter((t) => t.type === TokenType.Number);
    expect(nums).toHaveLength(3);
    expect(nums[0]!.value).toBe("42");
    expect(nums[1]!.value).toBe("0xFF");
    expect(nums[2]!.value).toBe("0x1A");
  });

  it("tokenizes identifiers and keywords", () => {
    const tokens = tokenize("x IF THEN y");
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    expect(tokens[0]!.type).toBe(TokenType.Identifier);
    expect(tokens[1]!.type).toBe(TokenType.IF);
    expect(tokens[2]!.type).toBe(TokenType.THEN);
    expect(tokens[3]!.type).toBe(TokenType.Identifier);
  });

  it("is case-insensitive for keywords", () => {
    const tokens = tokenize("if then Else");
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    expect(tokens[0]!.type).toBe(TokenType.IF);
    expect(tokens[1]!.type).toBe(TokenType.THEN);
    expect(tokens[2]!.type).toBe(TokenType.ELSE);
  });

  it("tokenizes operators", () => {
    const tokens = tokenize("+ - * = <> <= >= < >");
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    const types = tokens.filter((t) => t.type !== TokenType.Newline && t.type !== TokenType.EOF).map((t) => t.type);
    expect(types).toEqual([
      TokenType.Plus, TokenType.Minus, TokenType.Star,
      TokenType.Eq, TokenType.NotEq, TokenType.LtEq, TokenType.GtEq,
      TokenType.Lt, TokenType.Gt,
    ]);
  });

  it("tokenizes labels", () => {
    const tokens = tokenize("myLabel:");
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    expect(tokens[0]!.type).toBe(TokenType.Label);
    expect(tokens[0]!.value).toBe("myLabel");
  });

  it("handles colon as statement separator", () => {
    const tokens = tokenize("x = 1 : y = 2");
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    // x = 1 <newline> y = 2
    const types = tokens
      .filter((t) => t.type !== TokenType.EOF)
      .map((t) => t.type);
    expect(types).toEqual([
      TokenType.Identifier, TokenType.Eq, TokenType.Number,
      TokenType.Newline,
      TokenType.Identifier, TokenType.Eq, TokenType.Number,
      TokenType.Newline,
    ]);
  });

  it("handles string literals", () => {
    const tokens = tokenize('"Hello World"');
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    expect(tokens[0]!.type).toBe(TokenType.String);
    expect(tokens[0]!.value).toBe("Hello World");
  });

  it("handles comments with apostrophe", () => {
    const tokens = tokenize("x = 1 ' this is a comment");
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    const types = tokens
      .filter((t) => t.type !== TokenType.Newline && t.type !== TokenType.EOF)
      .map((t) => t.type);
    expect(types).toEqual([TokenType.Identifier, TokenType.Eq, TokenType.Number]);
  });

  it("handles REM comments", () => {
    const tokens = tokenize("REM this is a comment\nx = 1");
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) return;
    const ids = tokens.filter((t) => t.type === TokenType.Identifier);
    expect(ids).toHaveLength(1);
    expect(ids[0]!.value).toBe("x");
  });

  it("reports error on unterminated string", () => {
    const result = tokenize('"unterminated');
    expect("message" in result).toBe(true);
  });
});

// ── Parser tests ────────────────────────────────────────────

describe("Parser", () => {
  function parseOk(source: string) {
    const tokens = tokenize(source);
    expect(Array.isArray(tokens)).toBe(true);
    if (!Array.isArray(tokens)) throw new Error("Lex error");
    const ast = parse(tokens);
    if ("message" in ast) throw new Error(`Parse error: ${ast.message}`);
    return ast;
  }

  it("parses assignment", () => {
    const ast = parseOk("x = 42");
    expect(ast.statements).toHaveLength(1);
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("assign");
    if (stmt.kind !== "assign") return;
    expect(stmt.name).toBe("x");
    expect(stmt.expr).toEqual({ kind: "number", value: 42 });
  });

  it("parses expression with precedence", () => {
    const ast = parseOk("x = 1 + 2 * 3");
    const stmt = ast.statements[0]!;
    if (stmt.kind !== "assign") return;
    // Should be: ADD(1, MUL(2, 3))
    expect(stmt.expr.kind).toBe("binary");
    if (stmt.expr.kind !== "binary") return;
    expect(stmt.expr.op).toBe("ADD");
    expect(stmt.expr.right.kind).toBe("binary");
    if (stmt.expr.right.kind !== "binary") return;
    expect(stmt.expr.right.op).toBe("MUL");
  });

  it("parses IF/THEN single-line", () => {
    const ast = parseOk("IF x = 1 THEN y = 2");
    expect(ast.statements).toHaveLength(1);
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("if");
    if (stmt.kind !== "if") return;
    expect(stmt.branches).toHaveLength(1);
    expect(stmt.branches[0]!.body).toHaveLength(1);
    expect(stmt.elseBranch).toBeNull();
  });

  it("parses IF/THEN/ELSE single-line", () => {
    const ast = parseOk("IF x = 1 THEN y = 2 ELSE y = 3");
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("if");
    if (stmt.kind !== "if") return;
    expect(stmt.branches).toHaveLength(1);
    expect(stmt.elseBranch).toHaveLength(1);
  });

  it("parses block IF/END IF", () => {
    const ast = parseOk("IF x = 1 THEN\ny = 2\nEND IF");
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("if");
    if (stmt.kind !== "if") return;
    expect(stmt.branches).toHaveLength(1);
    expect(stmt.branches[0]!.body).toHaveLength(1);
  });

  it("parses block IF/ELSEIF/ELSE/END IF", () => {
    const ast = parseOk(
      "IF x = 1 THEN\ny = 1\nELSEIF x = 2 THEN\ny = 2\nELSE\ny = 3\nEND IF",
    );
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("if");
    if (stmt.kind !== "if") return;
    expect(stmt.branches).toHaveLength(2);
    expect(stmt.elseBranch).toHaveLength(1);
  });

  it("parses FOR/NEXT", () => {
    const ast = parseOk("FOR i = 0 TO 10\nx = i\nNEXT");
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("for");
    if (stmt.kind !== "for") return;
    expect(stmt.variable).toBe("i");
    expect(stmt.step).toBeNull();
    expect(stmt.body).toHaveLength(1);
  });

  it("parses FOR/NEXT with STEP", () => {
    const ast = parseOk("FOR i = 0 TO 100 STEP 5\nNEXT");
    const stmt = ast.statements[0]!;
    if (stmt.kind !== "for") return;
    expect(stmt.step).not.toBeNull();
    if (stmt.step?.kind !== "number") return;
    expect(stmt.step.value).toBe(5);
  });

  it("parses DO/LOOP (infinite)", () => {
    const ast = parseOk("DO\nYIELD\nLOOP");
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("do_loop");
    if (stmt.kind !== "do_loop") return;
    expect(stmt.condition).toBeNull();
    expect(stmt.body).toHaveLength(1);
  });

  it("parses DO WHILE/LOOP", () => {
    const ast = parseOk("DO WHILE x < 10\nx = x + 1\nLOOP");
    const stmt = ast.statements[0]!;
    if (stmt.kind !== "do_loop") return;
    expect(stmt.condition).not.toBeNull();
    expect(stmt.testAtTop).toBe(true);
    expect(stmt.isWhile).toBe(true);
  });

  it("parses DO/LOOP UNTIL", () => {
    const ast = parseOk("DO\nx = x + 1\nLOOP UNTIL x = 10");
    const stmt = ast.statements[0]!;
    if (stmt.kind !== "do_loop") return;
    expect(stmt.condition).not.toBeNull();
    expect(stmt.testAtTop).toBe(false);
    expect(stmt.isWhile).toBe(false);
  });

  it("parses SUB declaration", () => {
    const ast = parseOk("SUB update(x, y)\nx = x + 1\nEND SUB");
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("sub");
    if (stmt.kind !== "sub") return;
    expect(stmt.name).toBe("update");
    expect(stmt.params).toEqual(["x", "y"]);
    expect(stmt.body).toHaveLength(1);
  });

  it("parses DIM", () => {
    const ast = parseOk("DIM arr(10)");
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("dim");
    if (stmt.kind !== "dim") return;
    expect(stmt.name).toBe("arr");
    expect(stmt.size).toBe(10);
  });

  it("parses CONST", () => {
    const ast = parseOk("CONST MAX = 100");
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("const");
    if (stmt.kind !== "const") return;
    expect(stmt.name).toBe("MAX");
    expect(stmt.value).toBe(100);
  });

  it("parses DATA block", () => {
    const ast = parseOk("DATA dot_gfx, $80, $40");
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("data");
    if (stmt.kind !== "data") return;
    expect(stmt.name).toBe("dot_gfx");
    expect(stmt.bytes).toEqual([0x80, 0x40]);
  });

  it("parses labels", () => {
    const ast = parseOk("myLabel:\nx = 1");
    expect(ast.statements).toHaveLength(2);
    expect(ast.statements[0]!.kind).toBe("label");
    if (ast.statements[0]!.kind !== "label") return;
    expect(ast.statements[0]!.name).toBe("myLabel");
  });

  it("parses GOTO", () => {
    const ast = parseOk("GOTO myLabel");
    expect(ast.statements[0]!.kind).toBe("goto");
  });

  it("parses function calls in expressions", () => {
    const ast = parseOk("x = INPUT()");
    const stmt = ast.statements[0]!;
    if (stmt.kind !== "assign") return;
    expect(stmt.expr.kind).toBe("call");
    if (stmt.expr.kind !== "call") return;
    expect(stmt.expr.name).toBe("INPUT");
  });

  it("parses unary negation", () => {
    const ast = parseOk("x = -1");
    const stmt = ast.statements[0]!;
    if (stmt.kind !== "assign") return;
    // -1 should be optimized to literal 65535 (0xFFFF)
    expect(stmt.expr.kind).toBe("number");
    if (stmt.expr.kind !== "number") return;
    expect(stmt.expr.value).toBe(0xffff);
  });

  it("parses NOT operator", () => {
    const ast = parseOk("x = NOT y");
    const stmt = ast.statements[0]!;
    if (stmt.kind !== "assign") return;
    expect(stmt.expr.kind).toBe("unary");
    if (stmt.expr.kind !== "unary") return;
    expect(stmt.expr.op).toBe("NOT");
  });

  it("parses multi-line with colon separator", () => {
    const ast = parseOk("x = 1 : y = 2");
    expect(ast.statements).toHaveLength(2);
    expect(ast.statements[0]!.kind).toBe("assign");
    expect(ast.statements[1]!.kind).toBe("assign");
  });

  it("parses EXIT FOR and EXIT DO", () => {
    const ast = parseOk("FOR i = 0 TO 10\nEXIT FOR\nNEXT");
    const stmt = ast.statements[0]!;
    if (stmt.kind !== "for") return;
    expect(stmt.body[0]!.kind).toBe("exit");
  });

  it("parses POKE and POKE16", () => {
    const ast = parseOk("POKE $C000, 42\nPOKE16 $C000, 1000");
    expect(ast.statements[0]!.kind).toBe("poke");
    expect(ast.statements[1]!.kind).toBe("poke");
    if (ast.statements[1]!.kind !== "poke") return;
    expect(ast.statements[1]!.wide).toBe(true);
  });

  it("parses tuple assignment", () => {
    const ast = parseOk("x, y = SPR_GET(0)");
    expect(ast.statements).toHaveLength(1);
    const stmt = ast.statements[0]!;
    expect(stmt.kind).toBe("tuple_assign");
    if (stmt.kind !== "tuple_assign") return;
    expect(stmt.names).toEqual(["x", "y"]);
    expect(stmt.funcName).toBe("SPR_GET");
    expect(stmt.args).toHaveLength(1);
  });

  it("parses array access in expression", () => {
    const ast = parseOk("DIM arr(5)\nx = arr(2)");
    const stmt = ast.statements[1]!;
    if (stmt.kind !== "assign") return;
    expect(stmt.expr.kind).toBe("array_access");
  });

  it("parses array assignment", () => {
    const ast = parseOk("DIM arr(5)\narr(2) = 42");
    const stmt = ast.statements[1]!;
    expect(stmt.kind).toBe("array_assign");
  });
});

// ── Codegen tests ───────────────────────────────────────────

describe("Codegen", () => {
  it("generates assembly for assignment", () => {
    const asm = compileOk("x = 42");
    expect(asm).toContain("PUSH8 42");
    expect(asm).toContain("STORE");
  });

  it("generates assembly for arithmetic", () => {
    const asm = compileOk("x = 1 + 2");
    expect(asm).toContain("PUSH8 1");
    expect(asm).toContain("PUSH8 2");
    expect(asm).toContain("ADD");
  });

  it("generates HALT at end", () => {
    const asm = compileOk("x = 1");
    expect(asm).toContain("HALT");
  });

  it("generates JMP __main at start", () => {
    const asm = compileOk("x = 1");
    const lines = asm.split("\n");
    expect(lines[0]).toBe("  JMP __main");
  });

  it("generates syscall for CLEAR", () => {
    const asm = compileOk("CLEAR");
    expect(asm).toContain("SYSCALL 0");
  });

  it("generates syscall for YIELD", () => {
    const asm = compileOk("YIELD");
    expect(asm).toContain("SYSCALL 6");
  });

  it("generates data section for DATA blocks", () => {
    const asm = compileOk("DATA gfx, $80, $40, $20");
    expect(asm).toContain("__data_gfx:");
    expect(asm).toContain(".data 128, 64, 32");
  });

  it("generates string data for TEXT_SM", () => {
    const asm = compileOk('TEXT_SM "Hi", 0, 0');
    expect(asm).toContain("__str_");
    expect(asm).toContain(".data 72, 105, 0"); // "Hi" + null
    expect(asm).toContain("SYSCALL 36"); // 0x24
  });

  it("generates comparison operators", () => {
    const asm = compileOk("x = 1 < 2");
    expect(asm).toContain("LTS"); // signed comparison
  });

  it("generates <= using GTS + XOR", () => {
    const asm = compileOk("x = 1 <= 2");
    expect(asm).toContain("GTS");
    expect(asm).toContain("XOR");
  });

  it("generates <> using EQ + XOR", () => {
    const asm = compileOk("x = 1 <> 2");
    expect(asm).toContain("EQ");
    expect(asm).toContain("XOR");
  });

  it("generates CONST as immediate values", () => {
    const asm = compileOk("CONST MAX = 100\nx = MAX");
    expect(asm).toContain("PUSH8 100");
    // Should NOT generate a LOAD for MAX
    expect(asm).not.toMatch(/LOAD.*\n.*STORE/);
  });

  it("resolves built-in constants without declaration", () => {
    const asm = compileOk("x = EDGE_BOUNCE");
    expect(asm).toContain("PUSH8 2");
    // Should be an immediate, not a LOAD
    expect(asm).not.toContain("LOAD");
  });

  it("resolves all input constants", () => {
    const asm = compileOk("a = INPUT_UP : b = INPUT_ENC_BTN");
    expect(asm).toContain("PUSH8 1");
    expect(asm).toContain("PUSH8 128");
  });

  it("user CONST overrides built-in", () => {
    const asm = compileOk("CONST EDGE_BOUNCE = 99\nx = EDGE_BOUNCE");
    expect(asm).toContain("PUSH8 99");
  });

  it("generates SUB and CALL", () => {
    const asm = compileOk("SUB myFunc()\nRETURN\nEND SUB");
    expect(asm).toContain("__sub_myfunc:");
    expect(asm).toContain("RET");
  });

  it("generates FOR loop", () => {
    const asm = compileOk("FOR i = 0 TO 5\nNEXT");
    expect(asm).toContain("__for_top_");
    expect(asm).toContain("__for_end_");
    expect(asm).toContain("GTS");
    expect(asm).toContain("JNZ");
  });

  it("generates DO/LOOP", () => {
    const asm = compileOk("DO\nYIELD\nLOOP");
    expect(asm).toContain("__do_top_");
    expect(asm).toContain("JMP __do_top_");
  });

  it("generates POKE using STORE8_IDX", () => {
    const asm = compileOk("POKE $C000, 42");
    expect(asm).toContain("STORE8_IDX");
  });

  it("generates POKE16 using STORE_IDX", () => {
    const asm = compileOk("POKE16 $C000, 1000");
    expect(asm).toContain("STORE_IDX");
  });

  it("generates ABS function", () => {
    const asm = compileOk("x = ABS(y)");
    expect(asm).toContain("DUP");
    expect(asm).toContain("32768"); // 0x8000
    expect(asm).toContain("AND");
    expect(asm).toContain("NEG");
  });

  it("generates tuple_assign with SYSCALL and two STOREs", () => {
    const asm = compileOk("x, y = SPR_GET(0)");
    expect(asm).toContain("SYSCALL 67"); // 0x43
    // Should have two STORE instructions after the SYSCALL
    const lines = asm.split("\n");
    const syscallIdx = lines.findIndex((l) => l.includes("SYSCALL 67"));
    expect(syscallIdx).toBeGreaterThan(-1);
    // Next two lines should be STOREs (y first since it's on top of stack, then x)
    expect(lines[syscallIdx + 1]).toMatch(/STORE/);
    expect(lines[syscallIdx + 2]).toMatch(/STORE/);
  });

  it("generates PEEK using LOAD8_IDX", () => {
    const asm = compileOk("x = PEEK($C000)");
    expect(asm).toContain("LOAD8_IDX");
  });

  it("generates syscall for SPR_VIS", () => {
    const asm = compileOk("SPR_VIS 0, 1");
    expect(asm).toContain("SYSCALL 79"); // 0x4f
  });

  it("generates syscall for TEXT_NUM", () => {
    const asm = compileOk("TEXT_NUM 42, 10, 20");
    expect(asm).toContain("SYSCALL 38"); // 0x26
  });

  it("generates syscall for ASHR", () => {
    const asm = compileOk("x = ASHR(y, 2)");
    expect(asm).toContain("SYSCALL 39"); // 0x27
  });

  it("generates syscall for FX_MUL", () => {
    const asm = compileOk("x = FX_MUL(y, 250, 8)");
    expect(asm).toContain("SYSCALL 40"); // 0x28
  });
});

// ── Integration tests (compile + assemble + run) ────────────

describe("Integration", () => {
  it("compiles and assembles simple assignment", () => {
    const asm = compileOk("x = 42");
    const result = assemble(asm);
    expect(isError(result)).toBe(false);
  });

  it("variable assignment stores and loads correctly", () => {
    const h = loadBasic("x = 42 : y = x");
    h.frame();
    // Both x and y should be 42 — we can verify by reading from memory
    // The var addresses start at 0xC100
    expect(h.read16(0xc100)).toBe(42); // x
    expect(h.read16(0xc102)).toBe(42); // y
  });

  it("arithmetic expressions work correctly", () => {
    const h = loadBasic("x = 3 + 4 * 2");
    h.frame();
    expect(h.read16(0xc100)).toBe(11); // 3 + (4*2) = 11
  });

  it("comparison operators work", () => {
    const h = loadBasic("x = 5 < 10 : y = 10 < 5");
    h.frame();
    expect(h.read16(0xc100)).toBe(1); // true
    expect(h.read16(0xc102)).toBe(0); // false
  });

  it("IF/THEN single-line works", () => {
    const h = loadBasic("x = 5\nIF x = 5 THEN y = 1");
    h.frame();
    expect(h.read16(0xc102)).toBe(1);
  });

  it("IF/THEN/ELSE single-line works", () => {
    const h = loadBasic("x = 3\nIF x = 5 THEN y = 1 ELSE y = 2");
    h.frame();
    expect(h.read16(0xc102)).toBe(2);
  });

  it("block IF/ELSE works", () => {
    const h = loadBasic(`
      x = 10
      IF x > 5 THEN
        y = 1
      ELSE
        y = 2
      END IF
    `);
    h.frame();
    // x at 0xc100, y at 0xc102
    expect(h.read16(0xc102)).toBe(1);
  });

  it("FOR loop sums correctly", () => {
    const h = loadBasic(`
      sum = 0
      FOR i = 1 TO 5
        sum = sum + i
      NEXT
    `);
    h.frame();
    // sum = 1+2+3+4+5 = 15
    // sum is first declared var → 0xC100, i is second → 0xC102
    expect(h.read16(0xc100)).toBe(15);
  });

  it("FOR loop with STEP works", () => {
    const h = loadBasic(`
      sum = 0
      FOR i = 0 TO 10 STEP 2
        sum = sum + 1
      NEXT
    `);
    h.frame();
    // i goes: 0, 2, 4, 6, 8, 10 → 6 iterations
    expect(h.read16(0xc100)).toBe(6);
  });

  it("DO/LOOP counts correctly", () => {
    const h = loadBasic(`
      x = 0
      DO
        x = x + 1
        IF x = 5 THEN EXIT DO
      LOOP
    `);
    h.frame();
    expect(h.read16(0xc100)).toBe(5);
  });

  it("DO WHILE loop works", () => {
    const h = loadBasic(`
      x = 0
      DO WHILE x < 3
        x = x + 1
      LOOP
    `);
    h.frame();
    expect(h.read16(0xc100)).toBe(3);
  });

  it("DO/LOOP UNTIL works", () => {
    const h = loadBasic(`
      x = 0
      DO
        x = x + 1
      LOOP UNTIL x = 5
    `);
    h.frame();
    expect(h.read16(0xc100)).toBe(5);
  });

  it("CONST is used as immediate value", () => {
    const h = loadBasic(`
      CONST SIZE = 10
      x = SIZE
    `);
    h.frame();
    expect(h.read16(0xc100)).toBe(10);
  });

  it("built-in constants resolve to correct values", () => {
    const h = loadBasic(`
      x = EDGE_BOUNCE
      y = INPUT_RIGHT
      z = SPR_VECTOR
    `);
    h.frame();
    expect(h.read16(0xc100)).toBe(2);  // EDGE_BOUNCE
    expect(h.read16(0xc102)).toBe(8);  // INPUT_RIGHT
    expect(h.read16(0xc104)).toBe(4);  // SPR_VECTOR
  });

  it("user CONST overrides built-in constant", () => {
    const h = loadBasic(`
      CONST EDGE_BOUNCE = 42
      x = EDGE_BOUNCE
    `);
    h.frame();
    expect(h.read16(0xc100)).toBe(42);
  });

  it("nested IF works", () => {
    const h = loadBasic(`
      x = 5
      y = 10
      IF x = 5 THEN
        IF y = 10 THEN
          result = 1
        END IF
      END IF
    `);
    h.frame();
    // x=0xC100, y=0xC102, result=0xC104
    expect(h.read16(0xc104)).toBe(1);
  });

  it("ELSEIF works", () => {
    const h = loadBasic(`
      x = 2
      IF x = 1 THEN
        y = 10
      ELSEIF x = 2 THEN
        y = 20
      ELSE
        y = 30
      END IF
    `);
    h.frame();
    // x=0xC100, y=0xC102
    expect(h.read16(0xc102)).toBe(20);
  });

  it("bitwise AND works in expressions", () => {
    const h = loadBasic("x = $FF AND $0F");
    h.frame();
    expect(h.read16(0xc100)).toBe(0x0f);
  });

  it("GOTO works", () => {
    const h = loadBasic(`
      x = 1
      GOTO skip
      x = 99
      skip:
      y = x
    `);
    h.frame();
    // x=0xC100, y=0xC102
    expect(h.read16(0xc100)).toBe(1); // not 99
    expect(h.read16(0xc102)).toBe(1);
  });

  it("SUB call works like GOSUB", () => {
    const h = loadBasic(`
      SUB inc()
        x = x + 1
      END SUB
      x = 0
      inc
      inc
      inc
    `);
    h.frame();
    expect(h.read16(0xc100)).toBe(3);
  });

  it("SUB with parameters works", () => {
    const h = loadBasic(`
      SUB addTwo(a, b)
        result = a + b
      END SUB
      addTwo 10, 20
      POKE16 $C000, result
    `);
    h.frame();
    expect(h.read16(0xc000)).toBe(30);
  });

  it("DIM and array access works", () => {
    const h = loadBasic(`
      DIM arr(3)
      arr(0) = 10
      arr(1) = 20
      arr(2) = 30
      x = arr(0) + arr(1) + arr(2)
      POKE16 $C000, x
    `);
    h.frame();
    expect(h.read16(0xc000)).toBe(60);
  });

  it("DATA block is accessible by name", () => {
    const h = loadBasic(`
      DATA mydata, $41, $42, $43
      x = PEEK(mydata)
    `);
    h.frame();
    // x should be 0x41 (65)
    expect(h.read16(0xc100)).toBe(0x41);
  });

  it("POKE and PEEK work", () => {
    const h = loadBasic(`
      POKE $C000, 42
      x = PEEK($C000)
    `);
    h.frame();
    expect(h.read8(0xc000)).toBe(42);
    expect(h.read16(0xc100)).toBe(42);
  });

  it("POKE16 and PEEK16 work", () => {
    const h = loadBasic(`
      POKE16 $C000, 1000
      x = PEEK16($C000)
    `);
    h.frame();
    expect(h.read16(0xc000)).toBe(1000);
    expect(h.read16(0xc100)).toBe(1000);
  });

  it("EXIT FOR breaks out of loop", () => {
    const h = loadBasic(`
      x = 0
      FOR i = 1 TO 100
        x = x + 1
        IF i = 5 THEN EXIT FOR
      NEXT
    `);
    h.frame();
    expect(h.read16(0xc100)).toBe(5);
  });

  it("negative numbers work via two's complement", () => {
    const h = loadBasic(`
      x = 10
      x = x - 15
    `);
    h.frame();
    // 10 - 15 = -5 → 0xFFFB as u16
    expect(h.read16(0xc100)).toBe(0xfffb);
  });

  it("signed comparison with negative numbers works", () => {
    const h = loadBasic(`
      x = 10 - 15
      IF x < 0 THEN y = 1
    `);
    h.frame();
    // x = -5 (0xFFFB), which IS < 0 with signed comparison
    expect(h.read16(0xc102)).toBe(1);
  });

  it("CLEAR syscall clears framebuffer", () => {
    const h = loadBasic(`
      RECT 0, 0, 10, 10
      CLEAR
      YIELD
    `);
    h.frame();
    expect(h.pixel(5, 5)).toBe(0);
  });

  it("RECT draws a rectangle", () => {
    const h = loadBasic(`
      RECT 10, 10, 4, 4
      YIELD
    `);
    h.frame();
    expect(h.pixel(10, 10)).toBe(1);
    expect(h.pixel(13, 13)).toBe(1);
    expect(h.pixel(9, 9)).toBe(0);
  });

  it("PIXEL draws a pixel", () => {
    const h = loadBasic(`
      PIXEL 50, 30, 1
      YIELD
    `);
    h.frame();
    expect(h.pixel(50, 30)).toBe(1);
  });

  it("OR expression works", () => {
    const h = loadBasic("x = $F0 OR $0F");
    h.frame();
    expect(h.read16(0xc100)).toBe(0xff);
  });

  it("XOR expression works", () => {
    const h = loadBasic("x = $FF XOR $0F");
    h.frame();
    expect(h.read16(0xc100)).toBe(0xf0);
  });

  it("SHL and SHR work", () => {
    const h = loadBasic("x = 1 SHL 4 : y = 16 SHR 2");
    h.frame();
    expect(h.read16(0xc100)).toBe(16);
    expect(h.read16(0xc102)).toBe(4);
  });

  it("DIV and MOD work", () => {
    const h = loadBasic("x = 10 DIV 3 : y = 10 MOD 3");
    h.frame();
    expect(h.read16(0xc100)).toBe(3);
    expect(h.read16(0xc102)).toBe(1);
  });

  it("ASHR shifts positive values right", () => {
    const h = loadBasic("x = ASHR(256, 2)");
    h.frame();
    expect(h.read16(0xc100)).toBe(64); // 256 >> 2 = 64
  });

  it("ASHR sign-extends negative values", () => {
    const h = loadBasic("x = ASHR(-256, 2)");
    h.frame();
    // -256 as i16 = 0xFF00, arithmetic >> 2 = -64 = 0xFFC0
    expect(h.read16(0xc100)).toBe(0xffc0);
  });

  it("FX_MUL multiplies positive fixed-point values", () => {
    const h = loadBasic("x = FX_MUL(256, 250, 8)");
    h.frame();
    // (256 * 250) >> 8 = 64000 >> 8 = 250
    expect(h.read16(0xc100)).toBe(250);
  });

  it("FX_MUL handles signed negative values", () => {
    const h = loadBasic("x = FX_MUL(-256, 250, 8)");
    h.frame();
    // (-256 * 250) >> 8 = -64000 >> 8 = -250 = 0xFF06
    expect(h.read16(0xc100)).toBe((-250) & 0xffff);
  });

  it("FX_MUL handles two negative values", () => {
    const h = loadBasic("x = FX_MUL(-256, -250, 8)");
    h.frame();
    // (-256 * -250) >> 8 = 64000 >> 8 = 250
    expect(h.read16(0xc100)).toBe(250);
  });
});

// ── Example programs ────────────────────────────────────────

describe("Example programs", () => {
  it("bouncing dot compiles and assembles", () => {
    const asm = compileOk(`
      DATA dot_gfx, $80
      SPRITE 0, dot_gfx, 1, 1, 10, 5, 0, 64, 64, 2
      DO
        YIELD
      LOOP
    `);
    const result = assemble(asm);
    expect(isError(result)).toBe(false);
  });

  it("bouncing dot runs without error", () => {
    const h = loadBasic(`
      DATA dot_gfx, $80
      SPRITE 0, dot_gfx, 1, 1, 10, 5, 0, 64, 64, 2
      YIELD
    `);
    // Should run without throwing
    h.frame();
  });

  it("input test compiles and assembles", () => {
    const asm = compileOk(`
      x = 60 : y = 28
      DO
        inp = INPUT()
        IF inp AND 1 THEN y = y - 1
        IF inp AND 2 THEN y = y + 1
        IF inp AND 4 THEN x = x - 1
        IF inp AND 8 THEN x = x + 1
        RECT x, y, 4, 4
        YIELD
      LOOP
    `);
    const result = assemble(asm);
    expect(isError(result)).toBe(false);
  });

  it("CALLBACK compiles to valid assembly", () => {
    const asm = compileOk(`
      DATA dot_gfx, $80
      CALLBACK on_hit(slot)
        SPR_POS slot, 10, 20
      END CALLBACK
      SPRITE 0, dot_gfx, 1, 1, 60, 30, 0, 64, 0, 2
      SPR_COLL 0, 1
      SPR_ON_HIT 0, on_hit
    `);
    const result = assemble(asm);
    expect(isError(result)).toBe(false);
  });

  it("CALLBACK receives slot and executes body on hit", () => {
    const h = loadBasic(`
      DATA gfx1, $80
      DATA gfx2, $80

      ' Store hit slot at a known address for verification
      CALLBACK on_hit(slot)
        POKE16 $D000, slot
        POKE16 $D002, 1
      END CALLBACK

      ' Two sprites heading toward each other
      SPRITE 0, gfx1, 1, 1, 60, 30, 0, 64, 0, 0
      SPR_COLL 0, 1
      SPR_GROUP 0, 1, 2
      SPR_ON_HIT 0, on_hit

      SPRITE 1, gfx2, 1, 1, 62, 30, 0, -64, 0, 0
      SPR_COLL 1, 1
      SPR_GROUP 1, 2, 1

      DO
        YIELD
      LOOP
    `);
    // Run enough frames for them to collide
    for (let i = 0; i < 5; i++) h.frame();
    // callback should have fired, storing the hit slot and flag
    expect(h.read16(0xD002)).toBe(1); // callback executed
  });

  it("tuple assign retrieves sprite position", () => {
    const h = loadBasic(`
      DATA dot_gfx, $80
      SPRITE 0, dot_gfx, 1, 1, 42, 17, 0, 0, 0, 0
      x, y = SPR_GET(0)
      POKE16 $C000, x
      POKE16 $C002, y
    `);
    h.frame();
    expect(h.read16(0xc000)).toBe(42); // x
    expect(h.read16(0xc002)).toBe(17); // y
  });

  it("SPR_VIS hides sprite from rendering", () => {
    const h = loadBasic(`
      DATA gfx, $FF
      SPRITE 0, gfx, 8, 1, 0, 0, 0, 0, 0, 0
      SPR_VIS 0, 0
      YIELD
    `);
    h.frame();
    // Sprite should be hidden — pixel at (0,0) should be 0
    expect(h.pixel(0, 0)).toBe(0);
  });

  it("input test runs and draws initial rectangle", () => {
    const h = loadBasic(`
      x = 60 : y = 28
      DO
        inp = INPUT()
        IF inp AND 1 THEN y = y - 1
        IF inp AND 2 THEN y = y + 1
        IF inp AND 4 THEN x = x - 1
        IF inp AND 8 THEN x = x + 1
        RECT x, y, 4, 4
        YIELD
      LOOP
    `);
    h.frame();
    // Should draw a 4x4 rect at (60, 28)
    expect(h.pixel(60, 28)).toBe(1);
    expect(h.pixel(63, 31)).toBe(1);
    expect(h.pixel(64, 32)).toBe(0);
  });
});

// ── BLIT row-aligned format tests ───────────────────────────

describe("BLIT row-aligned", () => {
  it("renders all rows of a non-byte-aligned width sprite", () => {
    // 5x5 ship icon: row-aligned (1 byte per row, 5 bits used)
    // Row 0: ..#.. = 0x20
    // Row 1: .#.#. = 0x50
    // Row 2: .#.#. = 0x50
    // Row 3: #...# = 0x88
    // Row 4: ##### = 0xF8
    const h = loadBasic(`
      DATA icon, $20, $50, $50, $88, $F8
      BLIT icon, 10, 10, 5, 5
      YIELD
    `);
    h.frame();

    // Row 0: pixel at (12,10) set, (10,10) clear
    expect(h.pixel(12, 10)).toBe(1);
    expect(h.pixel(10, 10)).toBe(0);

    // Row 3: corners set, middle clear
    expect(h.pixel(10, 13)).toBe(1);
    expect(h.pixel(14, 13)).toBe(1);
    expect(h.pixel(12, 13)).toBe(0);

    // Row 4 (bottom line): ALL 5 pixels set
    expect(h.pixel(10, 14)).toBe(1);
    expect(h.pixel(11, 14)).toBe(1);
    expect(h.pixel(12, 14)).toBe(1);
    expect(h.pixel(13, 14)).toBe(1);
    expect(h.pixel(14, 14)).toBe(1);

    // Pixel just past the 5x5 region should be clear
    expect(h.pixel(15, 14)).toBe(0);
  });

  it("byte-aligned blit reads correct number of bytes per row", () => {
    // 8x2 sprite: 1 byte per row, 2 rows
    // Row 0: ####.... = 0xF0
    // Row 1: ....#### = 0x0F
    const h = loadBasic(`
      DATA pat, $F0, $0F
      BLIT pat, 0, 0, 8, 2
      YIELD
    `);
    h.frame();

    // Row 0: first 4 pixels set, last 4 clear
    expect(h.pixel(0, 0)).toBe(1);
    expect(h.pixel(3, 0)).toBe(1);
    expect(h.pixel(4, 0)).toBe(0);

    // Row 1: first 4 clear, last 4 set
    expect(h.pixel(0, 1)).toBe(0);
    expect(h.pixel(4, 1)).toBe(1);
    expect(h.pixel(7, 1)).toBe(1);
  });
});
