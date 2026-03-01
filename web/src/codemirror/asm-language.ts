import { StreamLanguage, type StreamParser } from "@codemirror/language";

const MNEMONICS = new Set([
  "HALT", "NOP", "PUSH8", "PUSH16", "POP", "DUP", "SWAP", "OVER",
  "ADD", "SUB", "MUL", "DIV", "MOD", "NEG",
  "AND", "OR", "XOR", "NOT", "SHL", "SHR",
  "EQ", "LT", "GT", "LTS", "GTS",
  "JMP", "JZ", "JNZ", "CALL", "RET",
  "LOAD", "STORE", "LOAD8", "STORE8",
  "LOAD_IDX", "STORE_IDX", "LOAD8_IDX", "STORE8_IDX",
  "SYSCALL",
]);

const asmParser: StreamParser<unknown> = {
  startState() {
    return {};
  },

  token(stream) {
    // Skip whitespace
    if (stream.eatSpace()) return null;

    // Comments starting with ;
    if (stream.eat(";")) {
      stream.skipToEnd();
      return "comment";
    }

    // Directives: .data, .org
    if (stream.match(/^\.[a-zA-Z]+/)) {
      return "processingInstruction";
    }

    // Numbers: hex 0x... or plain decimal
    if (stream.match(/^0x[0-9a-fA-F]+/)) {
      return "number";
    }
    if (stream.match(/^\d+/)) {
      return "number";
    }

    // Labels (identifier followed by colon)
    if (stream.match(/^[a-zA-Z_]\w*(?=:)/)) {
      return "labelName";
    }

    // Identifiers / mnemonics
    if (stream.match(/^[a-zA-Z_]\w*/)) {
      const word = stream.current().toUpperCase();
      if (MNEMONICS.has(word)) return "keyword";
      return "name";
    }

    // Operators / comma
    if (stream.match(/^[,+\-]/)) {
      return "operator";
    }

    // Anything else
    stream.next();
    return null;
  },
};

export const asmLanguage = StreamLanguage.define(asmParser);
