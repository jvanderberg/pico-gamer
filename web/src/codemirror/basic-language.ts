import { StreamLanguage, type StreamParser } from "@codemirror/language";

const KEYWORDS = new Set([
  "AND", "OR", "XOR", "NOT", "SHL", "SHR", "DIV", "MOD",
  "IF", "THEN", "ELSEIF", "ELSE", "END",
  "FOR", "TO", "STEP", "NEXT",
  "DO", "LOOP", "WHILE", "UNTIL",
  "GOTO", "SUB", "EXIT",
  "DIM", "CONST", "DATA", "CALLBACK", "REM",
]);

const BUILTIN_CONSTS = new Set([
  "INPUT_UP", "INPUT_DOWN", "INPUT_LEFT", "INPUT_RIGHT",
  "INPUT_BTN", "INPUT_ENC_CW", "INPUT_ENC_CCW", "INPUT_ENC_BTN",
  "INPUT_ENC_DELTA_SHIFT", "INPUT_ENC_DELTA_MASK",
  "EDGE_NONE", "EDGE_WRAP", "EDGE_BOUNCE", "EDGE_DESTROY", "EDGE_STOP",
  "COLL_NONE", "COLL_DETECT", "COLL_BOUNCE", "COLL_DESTROY", "COLL_STOP",
  "SPR_FLIPX", "SPR_FLIPY", "SPR_VECTOR",
]);

interface BasicState {
  afterConst: boolean;
  userConsts: Set<string>;
}

const basicParser: StreamParser<BasicState> = {
  startState() {
    return { afterConst: false, userConsts: new Set() };
  },

  token(stream, state) {
    // Skip whitespace
    if (stream.eatSpace()) return null;

    // Comments: ' or REM
    if (stream.eat("'")) {
      stream.skipToEnd();
      state.afterConst = false;
      return "comment";
    }

    // String literals
    if (stream.eat('"')) {
      while (!stream.eol()) {
        if (stream.eat('"')) break;
        stream.next();
      }
      state.afterConst = false;
      return "string";
    }

    // Numbers: hex 0x... or &H... or decimal
    if (stream.match(/^0x[0-9a-fA-F]+/) || stream.match(/^&H[0-9a-fA-F]+/i)) {
      state.afterConst = false;
      return "number";
    }
    if (stream.match(/^\d+/)) {
      state.afterConst = false;
      return "number";
    }

    // Labels (identifier followed by colon)
    if (stream.match(/^[a-zA-Z_]\w*(?=:)/)) {
      state.afterConst = false;
      return "labelName";
    }

    // Identifiers and keywords
    if (stream.match(/^[a-zA-Z_]\w*/)) {
      const word = stream.current().toUpperCase();
      if (word === "REM") {
        stream.skipToEnd();
        state.afterConst = false;
        return "comment";
      }
      if (KEYWORDS.has(word)) {
        state.afterConst = word === "CONST";
        return "keyword";
      }
      // Identifier right after CONST keyword → user-defined constant
      if (state.afterConst) {
        state.userConsts.add(word);
        state.afterConst = false;
        return "name.constant";
      }
      if (BUILTIN_CONSTS.has(word) || state.userConsts.has(word)) {
        return "name.constant";
      }
      return "name";
    }

    // Operators
    if (stream.match(/^[+\-*=<>!(),;:$]/)) {
      state.afterConst = false;
      return "operator";
    }

    // Anything else
    stream.next();
    state.afterConst = false;
    return null;
  },
};

export const basicLanguage = StreamLanguage.define(basicParser);
