"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DRIVER_DOCUMENT_LABELS, DRIVER_DOCUMENT_TYPES, type DriverDocumentType } from "@/lib/driver-documents";

function isDocType(value: string): value is DriverDocumentType {
  return DRIVER_DOCUMENT_TYPES.includes(value as DriverDocumentType);
}

export default function UploadDriverDocPage() {
  const params = useParams<{ id: string }>();
  const driverId = params.id;
  const router = useRouter();

  const [docType, setDocType] = useState<DriverDocumentType>("drivers_license");
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
    form.append("documentType", docType);
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
    <main className="mx-auto max-w-3xl space-y-5">
      <header className="moovu-card p-5 sm:p-6">
        <div className="moovu-section-title">Driver verification</div>
        <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Upload document</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Add or replace a private driver verification file for admin review.
        </p>
      </header>

      <form onSubmit={onSubmit} className="moovu-card space-y-5 p-5 sm:p-6">
        <label className="block">
          <div className="text-sm opacity-80 mb-2">Document type</div>
          <select
            className="moovu-input"
            value={docType}
            onChange={(e) => {
              if (isDocType(e.target.value)) {
                setDocType(e.target.value);
              }
            }}
          >
            {DRIVER_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DRIVER_DOCUMENT_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-sm opacity-80 mb-2">Expiry date (optional)</div>
          <input
            className="moovu-input"
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="text-sm opacity-80 mb-2">File</div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="moovu-btn moovu-btn-secondary cursor-pointer">
              {file ? "Change file" : "Choose file"}
              <input
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {file && <span className="text-sm font-bold text-slate-600">{file.name}</span>}
          </div>
        </label>

        {err && <p className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700">{err}</p>}

        <button disabled={busy} className="moovu-btn moovu-btn-primary w-full sm:w-auto">
          {busy ? "Uploading..." : "Upload"}
        </button>
      </form>
    </main>
  );
}
