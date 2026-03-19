import { TokenType, type Token } from "./tokens.ts";
import { SYSCALL_STMTS, SYSCALL_FUNCS, SYSCALL_TUPLE_FUNCS } from "./syscalls.ts";
import type {
  Expr,
  Stmt,
  Program,
  BinaryOperator,
} from "./ast.ts";

export interface ParseError {
  line: number;
  col: number;
  message: string;
}

export function parse(tokens: Token[]): Program | ParseError {
  let pos = 0;

  function current(): Token {
    return tokens[pos]!;
  }

  function peek(): TokenType {
    return current().type;
  }

function advance(): Token {
    const tok = current();
    pos++;
    return tok;
  }

  function expect(type: TokenType, what?: string): Token | ParseError {
    if (peek() !== type) {
      const tok = current();
      return {
        line: tok.line,
        col: tok.col,
        message: `Expected ${what ?? "token"}, got '${tok.value}'`,
      };
    }
    return advance();
  }

  function isError(v: unknown): v is ParseError {
    return v !== null && typeof v === "object" && "message" in v!;
  }

  function skipNewlines(): void {
    while (peek() === TokenType.Newline) advance();
  }

  // ── Expression parsing (precedence climbing) ──────────────────

  function parseExpr(): Expr | ParseError {
    return parseOr();
  }

  function parseOr(): Expr | ParseError {
    let left = parseXor();
    if (isError(left)) return left;
    while (peek() === TokenType.OR) {
      advance();
      const right = parseXor();
      if (isError(right)) return right;
      left = { kind: "binary", op: "OR", left, right };
    }
    return left;
  }

  function parseXor(): Expr | ParseError {
    let left = parseAnd();
    if (isError(left)) return left;
    while (peek() === TokenType.XOR) {
      advance();
      const right = parseAnd();
      if (isError(right)) return right;
      left = { kind: "binary", op: "XOR", left, right };
    }
    return left;
  }

  function parseAnd(): Expr | ParseError {
    let left = parseNot();
    if (isError(left)) return left;
    while (peek() === TokenType.AND) {
      advance();
      const right = parseNot();
      if (isError(right)) return right;
      left = { kind: "binary", op: "AND", left, right };
    }
    return left;
  }

  function parseNot(): Expr | ParseError {
    if (peek() === TokenType.NOT) {
      advance();
      const operand = parseNot();
      if (isError(operand)) return operand;
      return { kind: "unary", op: "NOT", operand };
    }
    return parseComparison();
  }

  function parseComparison(): Expr | ParseError {
    let left = parseShift();
    if (isError(left)) return left;

    const compOps: Partial<Record<TokenType, BinaryOperator>> = {
      [TokenType.Eq]: "EQ",
      [TokenType.NotEq]: "NEQ",
      [TokenType.Lt]: "LT",
      [TokenType.Gt]: "GT",
      [TokenType.LtEq]: "LTE",
      [TokenType.GtEq]: "GTE",
    };

    const op = compOps[peek()];
    if (op) {
      advance();
      const right = parseShift();
      if (isError(right)) return right;
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseShift(): Expr | ParseError {
    let left = parseAddSub();
    if (isError(left)) return left;
    while (peek() === TokenType.SHL || peek() === TokenType.SHR) {
      const op: BinaryOperator = peek() === TokenType.SHL ? "SHL" : "SHR";
      advance();
      const right = parseAddSub();
      if (isError(right)) return right;
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseAddSub(): Expr | ParseError {
    let left = parseMulDiv();
    if (isError(left)) return left;
    while (peek() === TokenType.Plus || peek() === TokenType.Minus) {
      const op: BinaryOperator = peek() === TokenType.Plus ? "ADD" : "SUB";
      advance();
      const right = parseMulDiv();
      if (isError(right)) return right;
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseMulDiv(): Expr | ParseError {
    let left = parseUnary();
    if (isError(left)) return left;
    while (
      peek() === TokenType.Star ||
      peek() === TokenType.DIV ||
      peek() === TokenType.MOD
    ) {
      const op: BinaryOperator =
        peek() === TokenType.Star
          ? "MUL"
          : peek() === TokenType.DIV
            ? "DIV"
            : "MOD";
      advance();
      const right = parseUnary();
      if (isError(right)) return right;
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  function parseUnary(): Expr | ParseError {
    if (peek() === TokenType.Plus) {
      advance();
      return parseUnary();
    }
    if (peek() === TokenType.Minus) {
      advance();
      const operand = parseUnary();
      if (isError(operand)) return operand;
      // Optimize: -literal → negative literal
      if (operand.kind === "number") {
        return { kind: "number", value: (-operand.value) & 0xffff };
      }
      return { kind: "unary", op: "NEG", operand };
    }
    return parseAtom();
  }

  function parseAtom(): Expr | ParseError {
    // Number literal
    if (peek() === TokenType.Number) {
      const tok = advance();
      const value = parseInt(tok.value, 0) & 0xffff;
      return { kind: "number", value };
    }

    // String literal (used in TEXT_SM/TEXT_LG)
    if (peek() === TokenType.String) {
      const tok = advance();
      return { kind: "string", value: tok.value };
    }

    // Parenthesized expression
    if (peek() === TokenType.LParen) {
      advance();
      const expr = parseExpr();
      if (isError(expr)) return expr;
      const rp = expect(TokenType.RParen, "')'");
      if (isError(rp)) return rp;
      return expr;
    }

    // Identifier: variable, array access, function call, or constant
    if (peek() === TokenType.Identifier) {
      const tok = advance();
      const name = tok.value;
      const upper = name.toUpperCase();

      // Built-in function call: NAME(args)
      const fn = SYSCALL_FUNCS[upper];
      if (fn && peek() === TokenType.LParen) {
        advance(); // skip (
        const args: Expr[] = [];
        if (peek() !== TokenType.RParen) {
          const first = parseExpr();
          if (isError(first)) return first;
          args.push(first);
          while (peek() === TokenType.Comma) {
            advance();
            const arg = parseExpr();
            if (isError(arg)) return arg;
            args.push(arg);
          }
        }
        const rp = expect(TokenType.RParen, "')'");
        if (isError(rp)) return rp;
        if (args.length !== fn.argCount) {
          return {
            line: tok.line,
            col: tok.col,
            message: `${upper}() expects ${fn.argCount} args, got ${args.length}`,
          };
        }
        return { kind: "call", name: upper, args };
      }

      // ABS() — compiler-generated, not a syscall
      if (upper === "ABS" && peek() === TokenType.LParen) {
        advance();
        const arg = parseExpr();
        if (isError(arg)) return arg;
        const rp = expect(TokenType.RParen, "')'");
        if (isError(rp)) return rp;
        return { kind: "call", name: "ABS", args: [arg] };
      }

      // PEEK/PEEK16 — memory read, not a syscall
      if ((upper === "PEEK" || upper === "PEEK16") && peek() === TokenType.LParen) {
        advance();
        const arg = parseExpr();
        if (isError(arg)) return arg;
        const rp = expect(TokenType.RParen, "')'");
        if (isError(rp)) return rp;
        return { kind: "call", name: upper, args: [arg] };
      }

      // Array access: name(index)
      if (peek() === TokenType.LParen) {
        advance();
        const index = parseExpr();
        if (isError(index)) return index;
        const rp = expect(TokenType.RParen, "')'");
        if (isError(rp)) return rp;
        return { kind: "array_access", name, index };
      }

      return { kind: "variable", name };
    }

    const tok = current();
    return {
      line: tok.line,
      col: tok.col,
      message: `Unexpected token: '${tok.value}'`,
    };
  }

  // ── Statement parsing ─────────────────────────────────────────

  function parseArgList(count: number, name: string): Expr[] | ParseError {
    const args: Expr[] = [];
    for (let i = 0; i < count; i++) {
      if (i > 0) {
        const comma = expect(TokenType.Comma, `',' in ${name}`);
        if (isError(comma)) return comma;
      }
      const arg = parseExpr();
      if (isError(arg)) return arg;
      args.push(arg);
    }
    return args;
  }

  function parseStatement(): Stmt | null | ParseError {
    skipNewlines();
    if (peek() === TokenType.EOF) return null;

    const tok = current();

    // ── Labels ────────────────────────────────────────────────
    if (peek() === TokenType.Label) {
      const label = advance();
      return { kind: "label", name: label.value };
    }

    // ── Block keywords ────────────────────────────────────────
    if (peek() === TokenType.IF) return parseIf();
    if (peek() === TokenType.FOR) return parseFor();
    if (peek() === TokenType.DO) return parseDo();
    if (peek() === TokenType.SUB) return parseSub();
    if (peek() === TokenType.CALLBACK) return parseCallback();
    if (peek() === TokenType.EFFECT) return parseEffect();
    if (peek() === TokenType.SONG) return parseSong();

    // ── Simple keywords ───────────────────────────────────────
    if (peek() === TokenType.DIM) return parseDim();
    if (peek() === TokenType.CONST) return parseConst();
    if (peek() === TokenType.DATA) return parseData();

    if (peek() === TokenType.GOTO) {
      advance();
      const label = expect(TokenType.Identifier, "label");
      if (isError(label)) return label;
      return { kind: "goto", label: label.value };
    }


    if (peek() === TokenType.EXIT) {
      advance();
      if (peek() === TokenType.FOR) {
        advance();
        return { kind: "exit", target: "for" };
      }
      if (peek() === TokenType.DO) {
        advance();
        return { kind: "exit", target: "do" };
      }
      return {
        line: tok.line,
        col: tok.col,
        message: "EXIT must be followed by FOR or DO",
      };
    }

    // ── Identifier-led statements ─────────────────────────────
    if (peek() === TokenType.Identifier) {
      const name = tok.value;
      const upper = name.toUpperCase();

      // POKE / POKE16
      if (upper === "POKE" || upper === "POKE16") {
        advance();
        const addr = parseExpr();
        if (isError(addr)) return addr;
        const comma = expect(TokenType.Comma, "','");
        if (isError(comma)) return comma;
        const value = parseExpr();
        if (isError(value)) return value;
        return { kind: "poke", wide: upper === "POKE16", addr, value };
      }

      // Syscall statement: NAME arg, arg, ...
      const syscall = SYSCALL_STMTS[upper];
      if (syscall) {
        advance();
        if (upper === "HALT" || upper === "YIELD" || upper === "CLEAR" || upper === "RETURN") {
          return { kind: "syscall", name: upper, args: [] };
        }
        if (upper === "NOTE") {
          const args = parseArgList(3, upper);
          if (isError(args)) return args;
          if (peek() === TokenType.Comma) {
            advance();
            const rate = parseExpr();
            if (isError(rate)) return rate;
            const comma = expect(TokenType.Comma, "','");
            if (isError(comma)) return comma;
            const depth = parseExpr();
            if (isError(depth)) return depth;
            args.push(rate, depth);
          } else {
            args.push({ kind: "number", value: 0 }, { kind: "number", value: 0 });
          }
          return { kind: "syscall", name: upper, args };
        }
        // TEXT_SM/TEXT_LG: first arg is a string expression
        const args = parseArgList(syscall.argCount, upper);
        if (isError(args)) return args;
        return { kind: "syscall", name: upper, args };
      }

      // Look ahead: is this a label (identifier followed by colon)?
      if (pos + 1 < tokens.length && tokens[pos + 1]!.type === TokenType.Newline) {
        // Could be label - check if the character after the identifier in the NEXT token position is ':'
        // Actually labels are identified differently: identifier followed by ':'
        // The lexer converts ':' to Newline, so we need a different approach.
        // Labels are handled by the lexer outputting a special pattern.
      }

      // Check if next token makes this an assignment: name = expr or name(idx) = expr
      advance(); // consume identifier

      // Tuple assignment: x, y = SPR_GET(0)
      if (peek() === TokenType.Comma) {
        const names = [name];
        while (peek() === TokenType.Comma) {
          advance(); // skip comma
          const nextName = expect(TokenType.Identifier, "variable name");
          if (isError(nextName)) return nextName;
          names.push(nextName.value);
        }
        const eq = expect(TokenType.Eq, "'='");
        if (isError(eq)) return eq;
        const funcTok = expect(TokenType.Identifier, "function name");
        if (isError(funcTok)) return funcTok;
        const funcUpper = funcTok.value.toUpperCase();
        const tupleFn = SYSCALL_TUPLE_FUNCS[funcUpper];
        if (!tupleFn) {
          return { line: funcTok.line, col: funcTok.col, message: `${funcUpper} is not a tuple-return function` };
        }
        if (names.length !== tupleFn.returnCount) {
          return { line: tok.line, col: tok.col, message: `${funcUpper} returns ${tupleFn.returnCount} values, got ${names.length} variables` };
        }
        const lp = expect(TokenType.LParen, "'('");
        if (isError(lp)) return lp;
        const args: Expr[] = [];
        if (peek() !== TokenType.RParen) {
          const first = parseExpr();
          if (isError(first)) return first;
          args.push(first);
          while (peek() === TokenType.Comma) {
            advance();
            const arg = parseExpr();
            if (isError(arg)) return arg;
            args.push(arg);
          }
        }
        const rp = expect(TokenType.RParen, "')'");
        if (isError(rp)) return rp;
        if (args.length !== tupleFn.argCount) {
          return { line: funcTok.line, col: funcTok.col, message: `${funcUpper}() expects ${tupleFn.argCount} args, got ${args.length}` };
        }
        return { kind: "tuple_assign", names, funcName: funcUpper, args };
      }

      // Array assignment: name(index) = expr
      if (peek() === TokenType.LParen) {
        advance();
        const index = parseExpr();
        if (isError(index)) return index;
        const rp = expect(TokenType.RParen, "')'");
        if (isError(rp)) return rp;
        const eq = expect(TokenType.Eq, "'='");
        if (isError(eq)) return eq;
        const expr = parseExpr();
        if (isError(expr)) return expr;
        return { kind: "array_assign", name, index, expr };
      }

      // Assignment: name = expr
      if (peek() === TokenType.Eq) {
        advance();
        const expr = parseExpr();
        if (isError(expr)) return expr;
        return { kind: "assign", name, expr };
      }

      // SUB call: name arg, arg, ...
      // If we get here and it's not an assignment, treat it as a SUB call
      pos--; // back up to re-read as SUB call
      advance(); // consume name again
      const args: Expr[] = [];
      if (
        peek() !== TokenType.Newline &&
        peek() !== TokenType.EOF &&
        peek() !== TokenType.ELSE &&
        peek() !== TokenType.END
      ) {
        const first = parseExpr();
        if (isError(first)) return first;
        args.push(first);
        while (peek() === TokenType.Comma) {
          advance();
          const arg = parseExpr();
          if (isError(arg)) return arg;
          args.push(arg);
        }
      }
      return { kind: "sub_call", name, args };
    }

    return {
      line: tok.line,
      col: tok.col,
      message: `Unexpected token: '${tok.value}'`,
    };
  }

  // ── Block structures ────────────────────────────────────────

  function parseIf(): Stmt | ParseError {
    advance(); // skip IF
    const condition = parseExpr();
    if (isError(condition)) return condition;
    const then = expect(TokenType.THEN, "THEN");
    if (isError(then)) return then;

    const branches: { condition: Expr; body: Stmt[] }[] = [];

    // Single-line IF: IF cond THEN stmt
    if (peek() !== TokenType.Newline && peek() !== TokenType.EOF) {
      const stmt = parseStatement();
      if (isError(stmt)) return stmt;
      if (stmt === null) {
        const tok = current();
        return { line: tok.line, col: tok.col, message: "Expected statement after THEN" };
      }
      branches.push({ condition, body: [stmt] });

      // Check for single-line ELSE
      let elseBranch: Stmt[] | null = null;
      if (peek() === TokenType.ELSE) {
        advance();
        const elseStmt = parseStatement();
        if (isError(elseStmt)) return elseStmt;
        if (elseStmt === null) {
          const tok = current();
          return { line: tok.line, col: tok.col, message: "Expected statement after ELSE" };
        }
        elseBranch = [elseStmt];
      }
      return { kind: "if", branches, elseBranch };
    }

    // Block IF
    skipNewlines();
    const thenBody = parseBlock();
    if (isError(thenBody)) return thenBody;
    branches.push({ condition, body: thenBody });

    // ELSEIF / ELSE
    let elseBranch: Stmt[] | null = null;
    while (peek() === TokenType.ELSEIF) {
      advance();
      const elseifCond = parseExpr();
      if (isError(elseifCond)) return elseifCond;
      const then2 = expect(TokenType.THEN, "THEN");
      if (isError(then2)) return then2;
      skipNewlines();
      const elseifBody = parseBlock();
      if (isError(elseifBody)) return elseifBody;
      branches.push({ condition: elseifCond, body: elseifBody });
    }

    if (peek() === TokenType.ELSE) {
      advance();
      skipNewlines();
      const elseBody = parseBlock();
      if (isError(elseBody)) return elseBody;
      elseBranch = elseBody;
    }

    // Expect END IF
    const end = expect(TokenType.END, "END");
    if (isError(end)) return end;
    const ifTok = expect(TokenType.IF, "IF");
    if (isError(ifTok)) return ifTok;

    return { kind: "if", branches, elseBranch };
  }

  function parseFor(): Stmt | ParseError {
    advance(); // skip FOR
    const varTok = expect(TokenType.Identifier, "variable");
    if (isError(varTok)) return varTok;
    const eq = expect(TokenType.Eq, "'='");
    if (isError(eq)) return eq;
    const from = parseExpr();
    if (isError(from)) return from;
    const to = expect(TokenType.TO, "TO");
    if (isError(to)) return to;
    const toExpr = parseExpr();
    if (isError(toExpr)) return toExpr;

    let stepExpr: Expr | null = null;
    if (peek() === TokenType.STEP) {
      advance();
      const s = parseExpr();
      if (isError(s)) return s;
      stepExpr = s;
    }

    skipNewlines();
    const body = parseBody(() => peek() === TokenType.NEXT);
    if (isError(body)) return body;

    const next = expect(TokenType.NEXT, "NEXT");
    if (isError(next)) return next;

    return {
      kind: "for",
      variable: varTok.value,
      from,
      to: toExpr,
      step: stepExpr,
      body,
    };
  }

  function parseDo(): Stmt | ParseError {
    advance(); // skip DO

    // DO WHILE cond / DO UNTIL cond
    if (peek() === TokenType.WHILE || peek() === TokenType.UNTIL) {
      const isWhile = peek() === TokenType.WHILE;
      advance();
      const condition = parseExpr();
      if (isError(condition)) return condition;
      skipNewlines();
      const body = parseBody(() => peek() === TokenType.LOOP);
      if (isError(body)) return body;
      const loop = expect(TokenType.LOOP, "LOOP");
      if (isError(loop)) return loop;
      return { kind: "do_loop", condition, testAtTop: true, isWhile, body };
    }

    // DO ... LOOP [WHILE|UNTIL cond]
    skipNewlines();
    const body = parseBody(() => peek() === TokenType.LOOP);
    if (isError(body)) return body;
    const loop = expect(TokenType.LOOP, "LOOP");
    if (isError(loop)) return loop;

    if (peek() === TokenType.WHILE || peek() === TokenType.UNTIL) {
      const isWhile = peek() === TokenType.WHILE;
      advance();
      const condition = parseExpr();
      if (isError(condition)) return condition;
      return { kind: "do_loop", condition, testAtTop: false, isWhile, body };
    }

    // Infinite loop: DO ... LOOP
    return { kind: "do_loop", condition: null, testAtTop: false, isWhile: true, body };
  }

  function parseSub(): Stmt | ParseError {
    advance(); // skip SUB
    const nameTok = expect(TokenType.Identifier, "sub name");
    if (isError(nameTok)) return nameTok;

    const params: string[] = [];
    if (peek() === TokenType.LParen) {
      advance();
      if (peek() !== TokenType.RParen) {
        const first = expect(TokenType.Identifier, "parameter");
        if (isError(first)) return first;
        params.push(first.value);
        while (peek() === TokenType.Comma) {
          advance();
          const param = expect(TokenType.Identifier, "parameter");
          if (isError(param)) return param;
          params.push(param.value);
        }
      }
      const rp = expect(TokenType.RParen, "')'");
      if (isError(rp)) return rp;
    }

    skipNewlines();
    const body = parseBody(() => peek() === TokenType.END);
    if (isError(body)) return body;
    const end = expect(TokenType.END, "END");
    if (isError(end)) return end;
    const sub = expect(TokenType.SUB, "SUB");
    if (isError(sub)) return sub;

    return { kind: "sub", name: nameTok.value, params, body };
  }

  function parseCallback(): Stmt | ParseError {
    advance(); // skip CALLBACK
    const nameTok = expect(TokenType.Identifier, "callback name");
    if (isError(nameTok)) return nameTok;

    const params: string[] = [];
    if (peek() === TokenType.LParen) {
      advance();
      if (peek() !== TokenType.RParen) {
        const first = expect(TokenType.Identifier, "parameter");
        if (isError(first)) return first;
        params.push(first.value);
        while (peek() === TokenType.Comma) {
          advance();
          const param = expect(TokenType.Identifier, "parameter");
          if (isError(param)) return param;
          params.push(param.value);
        }
      }
      const rp = expect(TokenType.RParen, "')'");
      if (isError(rp)) return rp;
    }

    skipNewlines();
    const body = parseBody(() => peek() === TokenType.END);
    if (isError(body)) return body;
    const end = expect(TokenType.END, "END");
    if (isError(end)) return end;
    const cb = expect(TokenType.CALLBACK, "CALLBACK");
    if (isError(cb)) return cb;

    return { kind: "callback", name: nameTok.value, params, body };
  }

  function parseDim(): Stmt | ParseError {
    advance(); // skip DIM
    const nameTok = expect(TokenType.Identifier, "array name");
    if (isError(nameTok)) return nameTok;
    const lp = expect(TokenType.LParen, "'('");
    if (isError(lp)) return lp;
    const sizeTok = expect(TokenType.Number, "array size");
    if (isError(sizeTok)) return sizeTok;
    const rp = expect(TokenType.RParen, "')'");
    if (isError(rp)) return rp;
    const size = parseInt(sizeTok.value, 0);
    if (isNaN(size) || size <= 0 || size > 65535) {
      return {
        line: sizeTok.line,
        col: sizeTok.col,
        message: `DIM size must be between 1 and 65535, got ${sizeTok.value}`,
      };
    }
    return { kind: "dim", name: nameTok.value, size };
  }

  function parseConst(): Stmt | ParseError {
    advance(); // skip CONST
    const nameTok = expect(TokenType.Identifier, "constant name");
    if (isError(nameTok)) return nameTok;
    const eq = expect(TokenType.Eq, "'='");
    if (isError(eq)) return eq;
    const valTok = parseExpr();
    if (isError(valTok)) return valTok;
    // CONST must have a compile-time constant value
    if (valTok.kind !== "number") {
      return {
        line: nameTok.line,
        col: nameTok.col,
        message: "CONST value must be a numeric literal",
      };
    }
    return { kind: "const", name: nameTok.value, value: valTok.value };
  }

  function parseData(): Stmt | ParseError {
    advance(); // skip DATA
    const nameTok = expect(TokenType.Identifier, "data label");
    if (isError(nameTok)) return nameTok;
    const comma = expect(TokenType.Comma, "','");
    if (isError(comma)) return comma;

    const bytes: number[] = [];
    // Read comma/space separated byte values until end of line
    for (;;) {
      if (peek() === TokenType.Number) {
        const tok = advance();
        bytes.push(parseInt(tok.value, 0) & 0xff);
      } else if (peek() === TokenType.Identifier) {
        // Could be a hex value like $FF — but our lexer handles $ as a number
        const tok = current();
        return {
          line: tok.line,
          col: tok.col,
          message: `Expected byte value, got '${tok.value}'`,
        };
      } else {
        break;
      }
      if (peek() === TokenType.Comma) {
        advance();
      } else {
        break;
      }
    }

    if (bytes.length === 0) {
      return {
        line: nameTok.line,
        col: nameTok.col,
        message: "DATA block must contain at least one byte",
      };
    }

    return { kind: "data", name: nameTok.value, bytes };
  }

  function parseEffect(): Stmt | ParseError {
    advance(); // skip EFFECT
    const nameTok = expect(TokenType.Identifier, "effect name");
    if (isError(nameTok)) return nameTok;

    skipNewlines();
    const steps: {
      delay: Expr;
      waveform: Expr;
      freq: Expr | null;
      pulseWidth: Expr | null;
      volume: Expr | null;
      filterCutoff: Expr | null;
    }[] = [];

    while (peek() !== TokenType.EOF && !(peek() === TokenType.END && tokens[pos + 1]?.type === TokenType.EFFECT)) {
      const stepTok = expect(TokenType.STEP, "STEP");
      if (isError(stepTok)) return stepTok;

      const delay = parseExpr();
      if (isError(delay)) return delay;
      const comma1 = expect(TokenType.Comma, "','");
      if (isError(comma1)) return comma1;

      const waveform = parseExpr();
      if (isError(waveform)) return waveform;

      let freq: Expr | null = null;
      let pulseWidth: Expr | null = null;
      let volume: Expr | null = null;
      let filterCutoff: Expr | null = null;

      if (peek() === TokenType.Comma) {
        advance();
        const freqExpr = parseExpr();
        if (isError(freqExpr)) return freqExpr;
        freq = freqExpr;

        const comma2 = expect(TokenType.Comma, "','");
        if (isError(comma2)) return comma2;
        const pwExpr = parseExpr();
        if (isError(pwExpr)) return pwExpr;
        pulseWidth = pwExpr;

        const comma3 = expect(TokenType.Comma, "','");
        if (isError(comma3)) return comma3;
        const volumeExpr = parseExpr();
        if (isError(volumeExpr)) return volumeExpr;
        volume = volumeExpr;

        const comma4 = expect(TokenType.Comma, "','");
        if (isError(comma4)) return comma4;
        const cutoffExpr = parseExpr();
        if (isError(cutoffExpr)) return cutoffExpr;
        filterCutoff = cutoffExpr;
      }

      steps.push({ delay, waveform, freq, pulseWidth, volume, filterCutoff });
      skipNewlines();
    }

    const endTok = expect(TokenType.END, "END");
    if (isError(endTok)) return endTok;
    const effectTok = expect(TokenType.EFFECT, "EFFECT");
    if (isError(effectTok)) return effectTok;

    return { kind: "effect", name: nameTok.value, steps };
  }

  function parseSong(): Stmt | ParseError {
    advance(); // skip SONG
    const nameTok = expect(TokenType.Identifier, "song name");
    if (isError(nameTok)) return nameTok;

    const comma1 = expect(TokenType.Comma, "','");
    if (isError(comma1)) return comma1;
    const bpm = parseExpr();
    if (isError(bpm)) return bpm;

    const comma2 = expect(TokenType.Comma, "','");
    if (isError(comma2)) return comma2;
    const loop = parseExpr();
    if (isError(loop)) return loop;

    skipNewlines();

    const tracks: {
      voice: Expr;
      effect: Expr;
      vibratoRate: Expr;
      vibratoDepth: Expr;
      pattern: Expr;
    }[] = [];

    while (peek() !== TokenType.EOF && !(peek() === TokenType.END && tokens[pos + 1]?.type === TokenType.SONG)) {
      const trackTok = expect(TokenType.TRACK, "TRACK");
      if (isError(trackTok)) return trackTok;

      const voice = parseExpr();
      if (isError(voice)) return voice;
      const comma3 = expect(TokenType.Comma, "','");
      if (isError(comma3)) return comma3;

      const effect = parseExpr();
      if (isError(effect)) return effect;
      const comma4 = expect(TokenType.Comma, "','");
      if (isError(comma4)) return comma4;

      const vibratoRate = parseExpr();
      if (isError(vibratoRate)) return vibratoRate;
      const comma5 = expect(TokenType.Comma, "','");
      if (isError(comma5)) return comma5;

      const vibratoDepth = parseExpr();
      if (isError(vibratoDepth)) return vibratoDepth;
      const comma6 = expect(TokenType.Comma, "','");
      if (isError(comma6)) return comma6;

      const pattern = parseExpr();
      if (isError(pattern)) return pattern;

      tracks.push({ voice, effect, vibratoRate, vibratoDepth, pattern });
      skipNewlines();
    }

    const endTok = expect(TokenType.END, "END");
    if (isError(endTok)) return endTok;
    const songTok = expect(TokenType.SONG, "SONG");
    if (isError(songTok)) return songTok;

    return { kind: "song", name: nameTok.value, bpm, loop, tracks };
  }

  // ── Helpers ─────────────────────────────────────────────────

  /** Parse statements until the terminator predicate returns true. */
  function parseBody(isTerminator: () => boolean): Stmt[] | ParseError {
    const stmts: Stmt[] = [];
    skipNewlines();
    while (!isTerminator() && peek() !== TokenType.EOF) {
      const stmt = parseStatement();
      if (isError(stmt)) return stmt;
      if (stmt !== null) stmts.push(stmt);
      // Consume statement-ending newline if present
      if (peek() === TokenType.Newline) skipNewlines();
    }
    return stmts;
  }

  /** Parse block body for IF — stops at ELSEIF, ELSE, or END. */
  function parseBlock(): Stmt[] | ParseError {
    return parseBody(
      () =>
        peek() === TokenType.ELSEIF ||
        peek() === TokenType.ELSE ||
        peek() === TokenType.END,
    );
  }

  // ── Top-level ─────────────────────────────────────────────

  function parseProgram(): Program | ParseError {
    const statements: Stmt[] = [];
    skipNewlines();
    while (peek() !== TokenType.EOF) {
      // Check for label: identifier at start of line followed by ':'
      // Since lexer converts ':' to Newline, we detect labels by looking at
      // identifier tokens whose value in the source was followed by ':'
      // We handle this by checking the original source... actually,
      // we need a different approach. Let's check if the current identifier
      // is followed by another identifier or keyword on the same line,
      // which would indicate it's a label.

      const stmt = parseStatement();
      if (isError(stmt)) return stmt;
      if (stmt !== null) statements.push(stmt);
      if (peek() === TokenType.Newline) skipNewlines();
    }
    return { statements };
  }

  return parseProgram();
}
