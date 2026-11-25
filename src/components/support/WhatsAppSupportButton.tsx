import type { ReactNode } from "react";

/** Big green "Chat on WhatsApp" button. Messages only; the number is never shown. */
export default function WhatsAppSupportButton({
  topic = "customer", trip, children = "Chat on WhatsApp",
}: { topic?: string; trip?: string; children?: ReactNode }) {
  const href = `/api/support/whatsapp?topic=${encodeURIComponent(topic)}${trip ? `&trip=${encodeURIComponent(trip)}` : ""}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="moovu-whatsapp-btn">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 20l1.4-4A8 8 0 1 1 8 18.6z" /></svg>
      <span>{children}</span>
    </a>
  );
}
