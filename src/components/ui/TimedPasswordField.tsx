"use client";

import { useEffect, useRef, useState } from "react";

type TimedPasswordFieldProps = {
  className?: string;
  placeholder?: string;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
};

export default function TimedPasswordField({
  className,
  placeholder = "Password",
  autoComplete = "current-password",
  value,
  onChange,
}: TimedPasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  function brieflyRevealPassword() {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }

    setRevealed(true);
    hideTimerRef.current = window.setTimeout(() => {
      setRevealed(false);
      hideTimerRef.current = null;
    }, 1000);
  }

  return (
    <div className="relative">
      <input
        className={className}
        placeholder={placeholder}
        type={revealed ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 inline-flex h-9 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 px-3 text-xs font-black uppercase tracking-[0.08em] text-slate-700 transition hover:bg-slate-200"
        onClick={brieflyRevealPassword}
        aria-label="Reveal password briefly"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  );
}
