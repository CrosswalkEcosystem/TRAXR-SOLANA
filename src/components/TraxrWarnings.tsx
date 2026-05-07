type Props = {
  warnings: string[];
};

// TRAXR warnings list for a pool.
export function TraxrWarnings({ warnings }: Props) {
  if (!warnings.length) {
    return (
      <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-emerald-100">
        No active warnings. TRAXR nodes in nominal band.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-amber-50">
      <div className="mb-2 text-xs uppercase tracking-[0.26em] text-amber-200/80">
        Warnings
      </div>
      <ul className="space-y-1 text-sm">
        {warnings.map((w) => (
          <li key={w} className="flex items-start gap-2">
            <span className="mt-[4px] h-1.5 w-1.5 rounded-full bg-amber-300" />
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
