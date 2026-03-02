#!/usr/bin/env npx tsx
// Compile a .bas file to a .game binary (VM bytecode)
// Usage: npx tsx compile-game.ts examples/bouncing-dot.bas

import { readFileSync, writeFileSync } from "fs";
import { compile, isCompileError } from "./src/basic/compiler.ts";
import { assemble } from "./src/assembler/assembler.ts";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npx tsx compile-game.ts <file.bas>");
  process.exit(1);
}

const source = readFileSync(input, "utf-8");

// BASIC → assembly
const compiled = compile(source);
if (isCompileError(compiled)) {
  console.error(`[${compiled.phase}] Line ${compiled.line}: ${compiled.message}`);
  process.exit(1);
}

// Assembly → bytecode
const result = assemble(compiled);
if ("message" in result) {
  console.error(`Assembler error line ${result.line}: ${result.message}`);
  process.exit(1);
}

const outPath = input.replace(/\.bas$/, ".game");
writeFileSync(outPath, result.bytecode);
console.log(`${outPath} (${result.bytecode.length} bytes)`);
