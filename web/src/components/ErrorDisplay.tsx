interface ErrorDisplayProps {
  error: string | null;
}

export function ErrorDisplay({ error }: ErrorDisplayProps) {
  if (!error) return null;
  return (
    <div className="text-xs text-[var(--primary)] max-h-[60px] overflow-y-auto px-2">
      {error}
    </div>
  );
}
