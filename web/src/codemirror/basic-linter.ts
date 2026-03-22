import { linter, type Diagnostic } from "@codemirror/lint";
import { compile, isCompileError } from "../basic/compiler.ts";
import { assemble } from "../assembler/assembler.ts";
import { detectLang } from "../lib/engine.ts";

/** CodeMirror linter extension that runs the BASIC compiler + assembler
 *  and maps errors to inline diagnostics with squiggly underlines. */
export const basicLinter = linter((view) => {
  const source = view.state.doc.toString();
  if (!source.trim()) return [];

  const diagnostics: Diagnostic[] = [];
  const lang = detectLang(source);

  if (lang === "basic") {
    const result = compile(source);
    if (isCompileError(result)) {
      const line = Math.max(1, Math.min(result.line, view.state.doc.lines));
      const lineObj = view.state.doc.line(line);
      const from = lineObj.from + Math.max(0, result.col - 1);
      const to = lineObj.to;
      diagnostics.push({
        from,
        to: Math.max(from + 1, to),
        severity: "error",
        message: `[${result.phase}] ${result.message}`,
      });
      return diagnostics;
    }

    // BASIC compiled OK — now try assembling the generated ASM
    const asmResult = assemble(result);
    if ("message" in asmResult) {
      // Try to map assembler errors back to source lines.
      // "__sub_xyz" errors mean "xyz" was treated as a SUB call — find it.
      const subMatch = asmResult.message.match(/"__sub_(\w+)"/);
      let from = 0;
      let to = view.state.doc.line(1).to;
      let message = asmResult.message;

      if (subMatch) {
        const name = subMatch[1]!;
        // Search source lines for the identifier (case-insensitive)
        const re = new RegExp(`\\b${name}\\b`, "i");
        for (let i = 1; i <= view.state.doc.lines; i++) {
          const lineObj = view.state.doc.line(i);
          const text = lineObj.text;
          // Skip comments
          if (/^\s*'/.test(text)) continue;
          const m = re.exec(text);
          if (m) {
            from = lineObj.from + m.index;
            to = from + m[0].length;
            message = `'${name}' is not a known command or SUB`;
            break;
          }
        }
      }

      diagnostics.push({ from, to, severity: "error", message });
    }
  } else {
    // Raw ASM mode
    const result = assemble(source);
    if ("message" in result) {
      const line = Math.max(1, Math.min(result.line, view.state.doc.lines));
      const lineObj = view.state.doc.line(line);
      diagnostics.push({
        from: lineObj.from,
        to: lineObj.to,
        severity: "error",
        message: result.message,
      });
    }
  }

  return diagnostics;
}, { delay: 500 });
