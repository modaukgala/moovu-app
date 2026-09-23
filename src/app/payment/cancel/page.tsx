"use client";
import { useSearchParams } from "next/navigation";
import PaymentResultClient from "@/components/payments/PaymentResultClient";
export default function PaymentCancelPage() {
  const tripId = useSearchParams().get("tripId") ?? "";
  return <PaymentResultClient kind="cancel" statusUrl={`/api/payments/yoco/status?tripId=${encodeURIComponent(tripId)}`} backHref={tripId ? `/ride/${tripId}` : "/book"} backLabel="Return to trip" />;
}
