"use client";

import { useEffect } from "react";

type Props = {
  message: string | null | undefined;
  onClose: () => void;
  title?: string;
};

function isSuccessMessage(message: string) {
  const value = message.toLowerCase();

  return [
    "success",
    "successful",
    "saved",
    "linked",
    "unlinked",
    "enabled",
    "detected",
    "calculated",
    "submitted successfully",
    "booked successfully",
  ].some((keyword) => value.includes(keyword));
}

export default function CenteredMessageBox({
  message,
  onClose,
  title,
}: Props) {
  useEffect(() => {
    if (!message) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [message, onClose]);

  if (!message) return null;

  const success = isSuccessMessage(message);
  const heading = title || (success ? "Update" : "Attention");

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/45 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
    >
      <div
        className="w-full max-w-md rounded-[30px] border bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
        style={{
          borderColor: success ? "#ccefd8" : "var(--moovu-border)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
                success
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  success ? "bg-emerald-500" : "bg-slate-400"
                }`}
              />
              {heading}
            </div>

            <p className="mt-4 text-base leading-7 text-slate-900">{message}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700"
            aria-label="Close message"
          >
            X
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`moovu-btn ${
              success ? "moovu-btn-secondary" : "moovu-btn-primary"
            }`}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
