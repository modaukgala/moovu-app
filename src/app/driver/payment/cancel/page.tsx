"use client";
import { useSearchParams } from "next/navigation";
import PaymentResultClient from "@/components/payments/PaymentResultClient";
export default function DriverPaymentCancelPage() {
  const id = useSearchParams().get("attemptId") ?? "";
  return <PaymentResultClient kind="cancel" statusUrl={`/api/payments/yoco/driver/status?attemptId=${encodeURIComponent(id)}`} backHref="/driver/commission-payments" backLabel="Return to commission payments" />;
}
