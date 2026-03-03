import { useRef, useState, type CSSProperties } from "react";
import { CodeEditor } from "./CodeEditor.tsx";
import { SpriteEditor } from "./SpriteEditor.tsx";
import type { Demo } from "../lib/engine.ts";

interface EditorPanelProps {
  source: string;
  onSourceChange: (source: string) => void;
  language: "asm" | "basic";
  demos: Demo[];
  selectedDemo: string;
  onDemoChange: (value: string) => void;
  onLoadFile: (text: string) => void;
  style?: CSSProperties;
}

export function EditorPanel({
  source,
  onSourceChange,
  language,
  demos,
  selectedDemo,
  onDemoChange,
  onLoadFile,
  style,
}: EditorPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [spriteEditorOpen, setSpriteEditorOpen] = useState(false);

  function handleFileClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    file.text().then(onLoadFile);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col border-r border-[var(--border)] min-w-0 shrink-0" style={style}>
      <div className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--muted)] bg-[var(--card)]">
        <select
          className="sel"
          value={selectedDemo}
          onChange={(e) => onDemoChange(e.target.value)}
        >
          <option value="">— Select demo —</option>
          {demos.map((d, i) => (
            <option key={i} value={String(i)}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          className="btn ml-auto text-[11px] px-2 py-0.5"
          onClick={() => setSpriteEditorOpen(true)}
        >
          Sprite Ed
        </button>
        <button
          className="btn text-[11px] px-2 py-0.5"
          onClick={handleFileClick}
        >
          Load File
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".asm,.bas"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
      <CodeEditor
        value={source}
        onChange={onSourceChange}
        language={language}
      />
      <SpriteEditor
        open={spriteEditorOpen}
        onClose={() => setSpriteEditorOpen(false)}
      />
    </div>
  );
}
