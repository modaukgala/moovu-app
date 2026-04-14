"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function RideConfirmRedirectPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();

  useEffect(() => {
    if (params?.id) {
      router.replace(`/ride/${params.id}`);
    }
  }, [params?.id, router]);

  return <main className="p-6 text-black">Redirecting to your trip...</main>;
}