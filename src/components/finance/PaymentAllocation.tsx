type Allocation = { subscription: number | null; commission: number | null; excess: number | null };

export default function PaymentAllocation({ row }: { row: {
  id: string; payment_type: string; status: string; reviewed_at?: string | null; allocation?: Allocation | null;
  financialReferences?: { settlements: string[] | null; subscriptions: string[] | null; transactions: string[] | null } | null;
} }) {
  if (row.payment_type !== "combined" && !row.financialReferences) return null;
  const money = (value?: number | null) => value == null ? "Unavailable" : `R${value.toFixed(2)}`;
  return <dl className="text-sm">
    {row.payment_type === "combined" && <>
    <div><dt>Recorded subscription allocation</dt><dd>{money(row.allocation?.subscription)}</dd></div>
    <div><dt>Recorded commission allocation</dt><dd>{money(row.allocation?.commission)}</dd></div>
    <div><dt>Recorded unapplied excess</dt><dd>{money(row.allocation?.excess)}</dd></div>
    </>}
    <div><dt>Review reference and date</dt><dd>{row.id} · {row.reviewed_at
      ? new Date(row.reviewed_at).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "Unavailable"}</dd></div>
    {row.financialReferences && ([
      ["Recorded commission settlements", row.financialReferences.settlements],
      ["Recorded subscription receipts", row.financialReferences.subscriptions],
      ["Financial transaction references", row.financialReferences.transactions],
    ] as const).map(([label, values]) => <div key={label}><dt>{label}</dt>
      <dd>{values === null ? "Reference lookup unavailable" : values.length ? values.join(", ") : "No stored relationship"}</dd>
    </div>)}
  </dl>;
}
