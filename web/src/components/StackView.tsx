interface StackViewProps {
  stackText: string;
}

export function StackView({ stackText }: StackViewProps) {
  return (
    <div className="flex-1 min-w-0">
      <label className="block text-[11px] text-[var(--muted)] px-1 py-0.5">
        Stack
      </label>
      <pre className="bg-[var(--code-bg)] text-[var(--accent)] font-mono text-[11px] p-1 m-0 max-h-[200px] overflow-y-auto border border-[var(--border)]">
        {stackText}
      </pre>
    </div>
  );
}
