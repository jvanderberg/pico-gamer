import { tokenize, type LexerError } from "./lexer.ts";
import { parse, type ParseError } from "./parser.ts";
import { generate } from "./codegen.ts";

export interface CompileError {
  phase: "lex" | "parse" | "codegen";
  line: number;
  col: number;
  message: string;
}

export function compile(source: string): string | CompileError {
  // Lex
  const tokens = tokenize(source);
  if ("message" in tokens) {
    const err = tokens as LexerError;
    return { phase: "lex", line: err.line, col: err.col, message: err.message };
  }

  // Parse
  const ast = parse(tokens);
  if ("message" in ast) {
    const err = ast as ParseError;
    return { phase: "parse", line: err.line, col: err.col, message: err.message };
  }

  // Generate
  try {
    return generate(ast);
  } catch (e) {
    return {
      phase: "codegen",
      line: 0,
      col: 0,
      message: (e as Error).message,
    };
  }
}

export function isCompileError(r: string | CompileError): r is CompileError {
  return typeof r !== "string";
}
