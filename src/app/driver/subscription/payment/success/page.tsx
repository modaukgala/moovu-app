"use client";
import { useSearchParams } from "next/navigation";
import PaymentResultClient from "@/components/payments/PaymentResultClient";
export default function DriverSubscriptionPaymentSuccessPage() {
  const id = useSearchParams().get("attemptId") ?? "";
  return <PaymentResultClient kind="success" statusUrl={`/api/payments/yoco/driver/subscription/status?attemptId=${encodeURIComponent(id)}`} backHref="/driver/subscriptions" backLabel="View subscription" />;
}
