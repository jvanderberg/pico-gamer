import { useRef, useEffect } from "react";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { terminalThemeExtension } from "../codemirror/theme.ts";
import { basicLanguage } from "../codemirror/basic-language.ts";
import { asmLanguage } from "../codemirror/asm-language.ts";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: "asm" | "basic";
}

export function CodeEditor({ value, onChange, language }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const langExtension = language === "basic" ? basicLanguage : asmLanguage;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          langExtension,
          ...terminalThemeExtension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate when language changes
  }, [language]);

  // Update content when value changes externally (e.g. demo load)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-hidden [&_.cm-editor]:h-full"
    />
  );
}
