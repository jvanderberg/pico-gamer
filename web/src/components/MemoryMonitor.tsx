import { useState, useCallback } from "react";

interface MemoryMonitorProps {
  onCommand: (cmd: string) => string;
}

export function MemoryMonitor({ onCommand }: MemoryMonitorProps) {
  const [output, setOutput] = useState("Type r ADDR to read, w ADDR XX to write");

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const result = onCommand(e.currentTarget.value);
        setOutput(result);
      }
    },
    [onCommand],
  );

  return (
    <div className="w-full max-w-[540px]">
      <label className="block text-[11px] text-[var(--muted)] px-1 py-0.5">
        Memory Monitor
      </label>
      <input
        type="text"
        className="w-full bg-[var(--code-bg)] text-[var(--accent)] font-mono text-[11px] border border-[var(--border)] p-1 outline-none placeholder:text-[#555]"
        placeholder="r ADDR [LEN] | r ADDR-ADDR | w ADDR XX ..."
        spellCheck={false}
        onKeyDown={handleKeyDown}
      />
      <pre className="bg-[var(--code-bg)] text-[var(--accent)] font-mono text-[11px] p-1 m-0 max-h-[200px] min-h-[60px] overflow-y-auto border border-[var(--border)] border-t-0">
        {output}
      </pre>
    </div>
  );
}
