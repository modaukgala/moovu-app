"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";

const DOC_TYPES = ["id", "license", "prdp", "vehicle_reg", "insurance", "other"] as const;
type DocType = (typeof DOC_TYPES)[number];

function isDocType(value: string): value is DocType {
  return DOC_TYPES.includes(value as DocType);
}

export default function UploadDriverDocPage() {
  const params = useParams<{ id: string }>();
  const driverId = params.id;
  const router = useRouter();

  const [docType, setDocType] = useState<DocType>("license");
  const [expiresOn, setExpiresOn] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!file) {
      setErr("Please choose a file.");
      return;
    }

    setBusy(true);

    const form = new FormData();
    form.append("driverId", driverId);
    form.append("docType", docType);
    form.append("expiresOn", expiresOn);
    form.append("file", file);

    const res = await fetch("/api/admin/driver-docs/upload", {
      method: "POST",
      body: form,
    });

    const json = await res.json();

    setBusy(false);

    if (!json.ok) {
      setErr(json.error || "Upload failed");
      return;
    }

    router.push(`/admin/drivers/${driverId}`);
  }

  return (
    <main className="p-6 max-w-xl">
      <h1 className="text-2xl font-semibold">Upload Document</h1>
      <p className="opacity-70 mt-2">Upload driver verification documents.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block">
          <div className="text-sm opacity-80 mb-2">Document type</div>
          <select
            className="w-full border rounded-xl p-3"
            value={docType}
            onChange={(e) => {
              if (isDocType(e.target.value)) {
                setDocType(e.target.value);
              }
            }}
          >
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-sm opacity-80 mb-2">Expiry date (optional)</div>
          <input
            className="w-full border rounded-xl p-3"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="text-sm opacity-80 mb-2">File</div>
          <input className="w-full" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <button disabled={busy} className="border rounded-xl px-4 py-2">
          {busy ? "Uploading..." : "Upload"}
        </button>
      </form>
    </main>
  );
}
