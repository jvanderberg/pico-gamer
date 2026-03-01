import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const terminalTheme = EditorView.theme({
  "&": {
    backgroundColor: "#0a0a1a",
    color: "#00ff88",
    fontFamily: "'Courier New', monospace",
    fontSize: "14px",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "#e94560",
    padding: "8px 0",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#e94560",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "#0f3460",
  },
  ".cm-gutters": {
    backgroundColor: "#0a0a1a",
    color: "#555",
    border: "none",
    minWidth: "3em",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#16213e",
  },
  ".cm-activeLine": {
    backgroundColor: "#16213e40",
  },
  ".cm-line": {
    padding: "0 8px",
  },
}, { dark: true });

const terminalHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#ff6b8a", fontWeight: "bold" },
  { tag: tags.operator, color: "#e0e0e0" },
  { tag: tags.number, color: "#00ccff" },
  { tag: tags.string, color: "#ffcc00" },
  { tag: tags.comment, color: "#555", fontStyle: "italic" },
  { tag: tags.labelName, color: "#ff8800" },
  { tag: tags.constant(tags.name), color: "#c4b5fd" },
  { tag: tags.name, color: "#00ff88" },
  { tag: tags.processingInstruction, color: "#a855f7" },
]);

export const terminalThemeExtension = [
  terminalTheme,
  syntaxHighlighting(terminalHighlight),
];
