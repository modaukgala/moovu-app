"use client";

import { useEffect } from "react";

type Props = {
  message: string | null | undefined;
  onClose: () => void;
  title?: string;
};

function isSuccessMessage(message: string) {
  const value = message.toLowerCase();

  return (
    value.includes("success") ||
    value.includes("successful") ||
    value.includes("saved") ||
    value.includes("linked") ||
    value.includes("unlinked") ||
    value.includes("enabled") ||
    value.includes("detected ✅") ||
    value.includes("calculated ✅") ||
    value.includes("submitted successfully") ||
    value.includes("booked successfully") ||
    value.includes("✅")
  );
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

    window.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [message, onClose]);

  if (!message) return null;

  const success = isSuccessMessage(message);
  const heading = title || (success ? "Message" : "Something needs your attention");

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
    >
      <div
        className="w-full max-w-md rounded-[2rem] border-2 bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        style={{ borderColor: success ? "#1f9d55" : "#2f80ed" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div
              className="text-sm font-semibold uppercase tracking-wide"
              style={{ color: success ? "#1f9d55" : "#2f80ed" }}
            >
              {heading}
            </div>

            <p className="mt-3 text-base leading-7 text-black">{message}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border px-3 py-1 text-sm font-medium text-black"
          >
            ✕
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-white"
            style={{ background: success ? "#1f9d55" : "var(--moovu-primary)" }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}