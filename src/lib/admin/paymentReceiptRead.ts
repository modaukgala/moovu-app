export async function readPaymentReceipt(id: string, token: string | undefined, signal: AbortSignal, request = fetch) {
  if (!token) throw new Error("Sign in to view this receipt.");
  const res = await request(`/api/admin/payment-reviews?id=${encodeURIComponent(id)}`, {
    cache: "no-store", signal, headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => null);
  if (res.status === 404 && json?.ok === false && json.error === "Receipt not found.") return null;
  if (res.status === 401) throw new Error("Sign in to view this receipt.");
  if (res.status === 403) throw new Error("Financial Admin access is required.");
  const receipt = json?.receipt;
  if (!res.ok || json?.ok !== true || receipt?.id !== id || typeof receipt.status !== "string" ||
    typeof receipt.driver_id !== "string" || typeof receipt.driver_name !== "string" ||
    typeof receipt.payment_type !== "string" || !Object.hasOwn(receipt, "amount_submitted")) {
    throw new Error("Receipt retrieval failed.");
  }
  return receipt;
}
