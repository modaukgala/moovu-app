"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { safeInternalNotificationUrl } from "@/lib/notifications/deepLinkRouting";

type ReviewNotification = {
  id: string;
  title: string;
  body: string;
  url: string | null;
  created_at: string;
  data: { type?: string } | null;
};

export default function Phase6NotificationList() {
  const [items, setItems] = useState<ReviewNotification[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data: auth } = await supabaseClient.auth.getSession();
      if (!auth.session) return;
      const result = await supabaseClient.from("app_notifications")
        .select("id,title,body,url,created_at,data")
        .eq("user_id", auth.session.user.id)
        .eq("role", "driver")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!mounted) return;
      if (result.error) { setError(true); return; }
      setItems(((result.data ?? []) as ReviewNotification[]).filter(item => item.data?.type?.startsWith("phase6_")));
    })();
    return () => { mounted = false; };
  }, []);

  if (!items.length && !error) return null;
  return <section aria-label="Application notifications" className="my-4 rounded-2xl border border-blue-100 bg-white p-4">
    <h2 className="font-bold">Application notifications</h2>
    {error ? <p className="mt-2 text-sm text-amber-800">Notifications are unavailable right now. Your application status remains available below.</p> :
      <ul className="mt-2 divide-y divide-slate-100">{items.map(item => <li key={item.id} className="py-3 text-sm">
        <p className="font-semibold">{item.title}</p><p className="mt-1 text-slate-700">{item.body}</p>
        <p className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p>
        <Link className="mt-2 inline-block font-semibold text-blue-700 underline" href={safeInternalNotificationUrl(item.url) || "/driver/onboarding"}>Open application</Link>
      </li>)}</ul>}
  </section>;
}
