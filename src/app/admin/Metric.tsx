export function Metric({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-cloud p-5 ${alert ? 'border-clay' : 'border-line'}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${alert ? 'text-clay' : 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}
