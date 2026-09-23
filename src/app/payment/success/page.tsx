"use client";
import { useSearchParams } from "next/navigation";
import PaymentResultClient from "@/components/payments/PaymentResultClient";
export default function PaymentSuccessPage() {
  const tripId = useSearchParams().get("tripId") ?? "";
  return <PaymentResultClient kind="success" statusUrl={`/api/payments/yoco/status?tripId=${encodeURIComponent(tripId)}`} backHref={tripId ? `/ride/${tripId}` : "/book"} backLabel="View my trip" />;
}
