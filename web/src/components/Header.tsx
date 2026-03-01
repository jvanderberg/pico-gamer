export function Header() {
  return (
    <header className="flex items-center gap-4 bg-[var(--card)] border-b border-[var(--border)]" style={{ padding: 16 }}>
      <h1 className="text-base font-bold text-[var(--primary)]">Pico Gamer</h1>
      <span className="text-sm text-[var(--foreground)]">Web VM Prototype</span>
    </header>
  );
}
