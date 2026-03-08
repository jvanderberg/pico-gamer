import { MNEMONIC_TO_OP, OPERAND_SIZES, type Opcode } from "../vm/opcodes.ts";

export interface AssemblerResult {
  bytecode: Uint8Array;
  /** Map of label name → address. */
  labels: Record<string, number>;
  /** Map of bytecode address → 1-based source line number. */
  pcToLine: Map<number, number>;
}

export interface AssemblerError {
  line: number;
  message: string;
}

type ParsedLine =
  | { kind: "label"; name: string }
  | { kind: "instruction"; mnemonic: string; operand: string | null }
  | { kind: "data"; bytes: number[] }
  | { kind: "data16"; values: string[] }
  | { kind: "org"; address: number }
  | { kind: "empty" };

function parseLine(raw: string): ParsedLine {
  // Strip comments
  const commentIdx = raw.indexOf(";");
  const line = (commentIdx >= 0 ? raw.slice(0, commentIdx) : raw).trim();

  if (line === "") return { kind: "empty" };

  // Label: identifier followed by colon
  if (line.endsWith(":")) {
    return { kind: "label", name: line.slice(0, -1).trim() };
  }

  // Directive: .data
  if (line.startsWith(".data ") || line.startsWith(".DATA ")) {
    const rest = line.slice(6).trim();
    const bytes = rest.split(/[,\s]+/).map((s) => {
      const v = parseInt(s, 0); // supports 0x prefix
      if (isNaN(v) || v < 0 || v > 255) throw new Error(`Invalid byte: ${s}`);
      return v;
    });
    return { kind: "data", bytes };
  }

  if (line.startsWith(".data16 ") || line.startsWith(".DATA16 ")) {
    const rest = line.slice(8).trim();
    const values = rest.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (values.length === 0) throw new Error("Invalid .data16 directive");
    return { kind: "data16", values };
  }

  // Directive: .org
  if (line.startsWith(".org ") || line.startsWith(".ORG ")) {
    const addr = parseInt(line.slice(5).trim(), 0);
    if (isNaN(addr)) throw new Error(`Invalid .org address`);
    return { kind: "org", address: addr };
  }

  // Instruction: MNEMONIC [operand]
  const parts = line.split(/\s+/, 2);
  const mnemonic = parts[0]!.toUpperCase();
  const operand = parts[1] ?? null;
  return { kind: "instruction", mnemonic, operand: operand ?? null };
}

function resolveOperand(
  operand: string,
  labels: Record<string, number>,
): number {
  // Try numeric literal first
  const num = parseInt(operand, 0);
  if (!isNaN(num)) return num;

  // Label reference
  const addr = labels[operand];
  if (addr !== undefined) return addr;

  throw new Error(`Undefined label or invalid operand: "${operand}"`);
}

export function assemble(source: string): AssemblerResult | AssemblerError {
  const lines = source.split("\n");
  const parsed: { parsed: ParsedLine; lineNum: number }[] = [];

  // Parse all lines
  for (let i = 0; i < lines.length; i++) {
    try {
      parsed.push({ parsed: parseLine(lines[i]!), lineNum: i + 1 });
    } catch (e) {
      return { line: i + 1, message: (e as Error).message };
    }
  }

  // Pass 1: collect labels and compute addresses
  const labels: Record<string, number> = {};
  let addr = 0;

  for (const { parsed: p, lineNum } of parsed) {
    switch (p.kind) {
      case "label":
        if (p.name in labels) {
          return { line: lineNum, message: `Duplicate label: "${p.name}"` };
        }
        labels[p.name] = addr;
        break;

      case "instruction": {
        const opcode = MNEMONIC_TO_OP[p.mnemonic];
        if (opcode === undefined) {
          return { line: lineNum, message: `Unknown mnemonic: ${p.mnemonic}` };
        }
        const operandSize = OPERAND_SIZES[opcode as Opcode] ?? 0;
        addr += 1 + operandSize;
        break;
      }

      case "data":
        addr += p.bytes.length;
        break;

      case "data16":
        addr += p.values.length * 2;
        break;

      case "org":
        addr = p.address;
        break;

      case "empty":
        break;
    }
  }

  // Pass 2: emit bytecode and build source map
  const output: number[] = [];
  const pcToLine = new Map<number, number>();

  for (const { parsed: p, lineNum } of parsed) {
    switch (p.kind) {
      case "label":
      case "empty":
        break;

      case "org":
        // Pad with zeros up to the target address
        while (output.length < p.address) {
          output.push(0);
        }
        break;

      case "data":
        pcToLine.set(output.length, lineNum);
        for (const b of p.bytes) {
          output.push(b);
        }
        break;

      case "data16":
        pcToLine.set(output.length, lineNum);
        for (const raw of p.values) {
          let value: number;
          try {
            value = resolveOperand(raw, labels);
          } catch (e) {
            return { line: lineNum, message: (e as Error).message };
          }
          output.push(value & 0xff);
          output.push((value >> 8) & 0xff);
        }
        break;

      case "instruction": {
        const opcode = MNEMONIC_TO_OP[p.mnemonic]!;
        const operandSize = OPERAND_SIZES[opcode as Opcode] ?? 0;
        pcToLine.set(output.length, lineNum);
        output.push(opcode);

        if (operandSize > 0) {
          if (p.operand === null) {
            return {
              line: lineNum,
              message: `${p.mnemonic} requires an operand`,
            };
          }
          let value: number;
          try {
            value = resolveOperand(p.operand, labels);
          } catch (e) {
            return { line: lineNum, message: (e as Error).message };
          }

          if (operandSize === 1) {
            output.push(value & 0xff);
          } else {
            // u16 little-endian
            output.push(value & 0xff);
            output.push((value >> 8) & 0xff);
          }
        }
        break;
      }
    }
  }

  return { bytecode: new Uint8Array(output), labels, pcToLine };
}

/** Type guard for error result. */
export function isError(
  r: AssemblerResult | AssemblerError,
): r is AssemblerError {
  return "message" in r;
}
