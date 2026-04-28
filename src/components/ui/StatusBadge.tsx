type StatusBadgeProps = {
  status?: string | null;
};

function labelForStatus(status?: string | null) {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toneForStatus(status?: string | null) {
  switch (status) {
    case "completed":
    case "approved":
    case "active":
      return "success";
    case "cancelled":
    case "rejected":
      return "danger";
    case "arrived":
    case "pending":
    case "pending_payment_review":
    case "waiting_confirmation":
      return "warning";
    case "assigned":
    case "ongoing":
    case "offered":
      return "primary";
    default:
      return "neutral";
  }
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const tone = toneForStatus(status);

  return (
    <span className={`moovu-status-badge moovu-status-badge-${tone}`}>
      <span className="moovu-status-badge-dot" />
      {labelForStatus(status)}
    </span>
  );
}

