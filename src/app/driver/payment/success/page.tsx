"use client";
import { useSearchParams } from "next/navigation";
import PaymentResultClient from "@/components/payments/PaymentResultClient";
export default function DriverPaymentSuccessPage() {
  const id = useSearchParams().get("attemptId") ?? "";
  return <PaymentResultClient kind="success" statusUrl={`/api/payments/yoco/driver/status?attemptId=${encodeURIComponent(id)}`} backHref="/driver/commission-payments" backLabel="View commission balance" />;
}
