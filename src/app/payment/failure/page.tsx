"use client";
import { useSearchParams } from "next/navigation";
import PaymentResultClient from "@/components/payments/PaymentResultClient";
export default function PaymentFailurePage() {
  const tripId = useSearchParams().get("tripId") ?? "";
  return <PaymentResultClient kind="failure" statusUrl={`/api/payments/yoco/status?tripId=${encodeURIComponent(tripId)}`} backHref={tripId ? `/ride/${tripId}` : "/book"} backLabel="Return to trip" />;
}
