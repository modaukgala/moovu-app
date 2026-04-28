type MetricCardProps = {
  label: string;
  value: string;
  helper?: string;
  tone?: "default" | "primary" | "success" | "warning" | "danger";
};

export default function MetricCard({ label, value, helper, tone = "default" }: MetricCardProps) {
  return (
    <div className={`moovu-app-metric moovu-app-metric-${tone}`}>
      <div className="moovu-app-metric-label">{label}</div>
      <div className="moovu-app-metric-value">{value}</div>
      {helper ? <div className="mt-2 text-xs text-slate-600">{helper}</div> : null}
    </div>
  );
}

