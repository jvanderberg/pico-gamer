import { TokenType, KEYWORDS, type Token } from "./tokens.ts";

export interface LexerError {
  line: number;
  col: number;
  message: string;
}

export function tokenize(source: string): Token[] | LexerError {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function peek(): string {
    return pos < source.length ? source[pos]! : "";
  }

  function advance(): string {
    const ch = source[pos]!;
    pos++;
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  function isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  function isAlphaNum(ch: string): boolean {
    return isAlpha(ch) || isDigit(ch);
  }

  function readNumber(): Token {
    const startCol = col;
    let value = "";

    // Hex literal: $FF or 0xFF
    if (peek() === "$") {
      advance();
      while (pos < source.length && /[0-9a-fA-F]/.test(peek())) {
        value += advance();
      }
      if (value.length === 0) {
        return { type: TokenType.Dollar, value: "$", line, col: startCol };
      }
      return {
        type: TokenType.Number,
        value: "0x" + value,
        line,
        col: startCol,
      };
    }

    if (peek() === "0" && pos + 1 < source.length && (source[pos + 1] === "x" || source[pos + 1] === "X")) {
      value += advance(); // 0
      value += advance(); // x
      while (pos < source.length && /[0-9a-fA-F]/.test(peek())) {
        value += advance();
      }
      return { type: TokenType.Number, value, line, col: startCol };
    }

    while (pos < source.length && isDigit(peek())) {
      value += advance();
    }
    return { type: TokenType.Number, value, line, col: startCol };
  }

  function readString(): Token | LexerError {
    const startLine = line;
    const startCol = col;
    advance(); // skip opening quote
    let value = "";
    while (pos < source.length && peek() !== '"') {
      if (peek() === "\n") {
        return { line: startLine, col: startCol, message: "Unterminated string" };
      }
      value += advance();
    }
    if (pos >= source.length) {
      return { line: startLine, col: startCol, message: "Unterminated string" };
    }
    advance(); // skip closing quote
    return { type: TokenType.String, value, line: startLine, col: startCol };
  }

  function readIdentifier(): Token {
    const startCol = col;
    const startLine = line;
    let value = "";
    while (pos < source.length && isAlphaNum(peek())) {
      value += advance();
    }
    const upper = value.toUpperCase();

    // REM consumes everything to end of line
    if (upper === "REM") {
      while (pos < source.length && peek() !== "\n") {
        advance();
      }
      return { type: TokenType.REM, value: upper, line: startLine, col: startCol };
    }

    // Label: identifier immediately followed by ':' (no space)
    if (peek() === ":") {
      advance(); // consume ':'
      return { type: TokenType.Label, value, line: startLine, col: startCol };
    }

    const keyword = KEYWORDS[upper];
    if (keyword !== undefined) {
      return { type: keyword, value: upper, line: startLine, col: startCol };
    }

    return { type: TokenType.Identifier, value, line: startLine, col: startCol };
  }

  while (pos < source.length) {
    const ch = peek();

    // Skip spaces and tabs (not newlines)
    if (ch === " " || ch === "\t") {
      advance();
      continue;
    }

    // Newline
    if (ch === "\n") {
      // Collapse multiple newlines into one token
      if (tokens.length > 0 && tokens[tokens.length - 1]!.type !== TokenType.Newline) {
        tokens.push({ type: TokenType.Newline, value: "\\n", line, col });
      }
      advance();
      continue;
    }

    // Carriage return
    if (ch === "\r") {
      advance();
      continue;
    }

    // Comment: ' to end of line
    if (ch === "'") {
      while (pos < source.length && peek() !== "\n") {
        advance();
      }
      continue;
    }

    // String literal
    if (ch === '"') {
      const result = readString();
      if ("message" in result) return result;
      tokens.push(result);
      continue;
    }

    // Number or hex with $
    if (isDigit(ch) || ch === "$") {
      tokens.push(readNumber());
      continue;
    }

    // Identifier or keyword
    if (isAlpha(ch)) {
      const tok = readIdentifier();
      if (tok.type === TokenType.REM) continue; // skip REM comments
      tokens.push(tok);
      continue;
    }

    // Operators and punctuation
    const startCol = col;
    switch (ch) {
      case "+":
        advance();
        tokens.push({ type: TokenType.Plus, value: "+", line, col: startCol });
        break;
      case "-":
        advance();
        tokens.push({ type: TokenType.Minus, value: "-", line, col: startCol });
        break;
      case "*":
        advance();
        tokens.push({ type: TokenType.Star, value: "*", line, col: startCol });
        break;
      case "=":
        advance();
        tokens.push({ type: TokenType.Eq, value: "=", line, col: startCol });
        break;
      case "<":
        advance();
        if (peek() === "=") {
          advance();
          tokens.push({ type: TokenType.LtEq, value: "<=", line, col: startCol });
        } else if (peek() === ">") {
          advance();
          tokens.push({ type: TokenType.NotEq, value: "<>", line, col: startCol });
        } else {
          tokens.push({ type: TokenType.Lt, value: "<", line, col: startCol });
        }
        break;
      case ">":
        advance();
        if (peek() === "=") {
          advance();
          tokens.push({ type: TokenType.GtEq, value: ">=", line, col: startCol });
        } else {
          tokens.push({ type: TokenType.Gt, value: ">", line, col: startCol });
        }
        break;
      case "(":
        advance();
        tokens.push({ type: TokenType.LParen, value: "(", line, col: startCol });
        break;
      case ")":
        advance();
        tokens.push({ type: TokenType.RParen, value: ")", line, col: startCol });
        break;
      case ",":
        advance();
        tokens.push({ type: TokenType.Comma, value: ",", line, col: startCol });
        break;
      case ":":
        advance();
        // Colon acts as statement separator (like newline)
        if (tokens.length > 0 && tokens[tokens.length - 1]!.type !== TokenType.Newline) {
          tokens.push({ type: TokenType.Newline, value: ":", line, col: startCol });
        }
        break;
      default:
        return { line, col, message: `Unexpected character: '${ch}'` };
    }
  }

  // Ensure trailing newline
  if (tokens.length > 0 && tokens[tokens.length - 1]!.type !== TokenType.Newline) {
    tokens.push({ type: TokenType.Newline, value: "\\n", line, col });
  }

  tokens.push({ type: TokenType.EOF, value: "", line, col });
  return tokens;
}
