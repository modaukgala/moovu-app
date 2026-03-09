"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function ViewDocPage() {
  const sp = useSearchParams();
  const path = sp.get("path");

  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!path) {
        setErr("Missing file path.");
        return;
      }

      const res = await fetch("/api/admin/driver-docs/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });

      const json = await res.json();

      if (!json.ok) {
        setErr(json.error || "Failed to create signed URL");
        return;
      }

      setUrl(json.url);
    })();
  }, [path]);

  if (err) return <main className="p-6">{err}</main>;
  if (!url) return <main className="p-6">Loading file...</main>;

  return (
    <main className="p-6">
      <a className="underline" href={url} target="_blank" rel="noreferrer">
        Open in new tab
      </a>

      <div className="mt-4 border rounded-2xl overflow-hidden">
        <iframe src={url} className="w-full h-[80vh]" />
      </div>
    </main>
  );
}