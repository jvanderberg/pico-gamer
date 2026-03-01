import type { EngineStatus } from "../lib/engine.ts";

interface StatusBarProps {
  status: EngineStatus;
}

export function StatusBar({ status }: StatusBarProps) {
  return (
    <div className="flex gap-4 text-xs text-[var(--muted)] px-2 py-1 bg-[var(--card)] border-t border-[var(--border)]">
      <span className="whitespace-nowrap">
        PC: <code>{status.pc}</code>
      </span>
      <span className="whitespace-nowrap">
        SP: <code>{status.sp}</code>
      </span>
      <span className="whitespace-nowrap">
        TOS: <code>{status.tos}</code>
      </span>
      <span className="whitespace-nowrap">
        State: <code>{status.state}</code>
      </span>
      <span className="whitespace-nowrap">
        Cycles: <code>{status.cycles}</code>
      </span>
    </div>
  );
}
