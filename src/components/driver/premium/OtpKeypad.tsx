"use client";

import { Delete } from "lucide-react";

type Props = { value: string; onChange: (value: string) => void; label: string; disabled?: boolean };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

/** Four digit boxes and a phone-style keypad. Same value/onChange as the old input. */
export default function OtpKeypad({ value, onChange, label, disabled }: Props) {
  const press = (key: string) => {
    if (disabled) return;
    if (key === "del") onChange(value.slice(0, -1));
    else if (/^\d$/.test(key) && value.length < 4) onChange(value + key);
  };
  return (
    <div
      className="dp-otp"
      role="group"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(event) => {
        if (/^\d$/.test(event.key)) press(event.key);
        else if (event.key === "Backspace") press("del");
      }}
    >
      <div className="dp-otp-boxes" aria-live="polite">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className={`dp-otp-box${index === value.length ? " is-next" : ""}`}>
            {value[index] ?? ""}
          </span>
        ))}
      </div>
      <div className="dp-keypad">
        {KEYS.map((key, index) =>
          key === "" ? (
            <span key={index} />
          ) : (
            <button
              key={index}
              type="button"
              className="dp-key"
              disabled={disabled}
              onClick={() => press(key)}
              aria-label={key === "del" ? "Delete digit" : key}
            >
              {key === "del" ? <Delete aria-hidden="true" /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
