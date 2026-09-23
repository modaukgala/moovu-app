"use client";
import { useSearchParams } from "next/navigation";
import PaymentResultClient from "@/components/payments/PaymentResultClient";
export default function DriverPaymentFailurePage() {
  const id = useSearchParams().get("attemptId") ?? "";
  return <PaymentResultClient kind="failure" statusUrl={`/api/payments/yoco/driver/status?attemptId=${encodeURIComponent(id)}`} backHref="/driver/commission-payments" backLabel="Return to commission payments" />;
}
