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
    case "online":
    case "settled":
    case "good_standing":
      return "success";
    case "cancelled":
    case "rejected":
    case "locked":
    case "payment_required":
    case "suspended":
    case "expired":
      return "danger";
    case "arrived":
    case "pending":
    case "pending_payment_review":
    case "waiting_confirmation":
    case "warning":
    case "due":
    case "inactive":
    case "expiring_soon":
      return "warning";
    case "assigned":
    case "ongoing":
    case "offered":
    case "available":
    case "busy":
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
