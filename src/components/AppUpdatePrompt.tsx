"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Download } from "lucide-react";

const LATER_KEY = "moovu:update-prompt-later-until";

/**
 * Shown only inside an older installed MOOVU app (one without the Browser
 * plugin needed for Google/Apple sign-in). Waits until the notification
 * pop-up is closed, so people see: notifications -> update -> Google/Apple.
 */
export default function AppUpdatePrompt() {
  const [open, setOpen] = useState(false);
  const [app, setApp] = useState<"customer" | "driver">("customer");
  const platform = typeof window !== "undefined" && Capacitor.getPlatform() === "ios" ? "ios" : "android";

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.isPluginAvailable("Browser")) return;
    try {
      if (Number(window.localStorage.getItem(LATER_KEY) ?? 0) > Date.now()) return;
    } catch {}
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    void App.getInfo()
      .then((info) => { if (active && /driver/i.test(info.id)) setApp("driver"); })
      .catch(() => { if (active && window.location.hostname.startsWith("driver.")) setApp("driver"); });
    const tryOpen = () => {
      if (!active) return;
      if (document.querySelector(".moovu-permission-reminder-backdrop")) {
        timer = setTimeout(tryOpen, 2000);
        return;
      }
      setOpen(true);
    };
    timer = setTimeout(tryOpen, 3500);
    return () => { active = false; clearTimeout(timer); };
  }, []);

  if (!open) return null;
  const later = () => {
    try { window.localStorage.setItem(LATER_KEY, String(Date.now() + 3 * 24 * 3600 * 1000)); } catch {}
    setOpen(false);
  };
  const href = `/api/app-update?app=${app}&platform=${platform}`;

  return (
    <div className="moovu-link-prompt" role="dialog" aria-modal="true" aria-labelledby="moovu-update-title">
      <div className="moovu-link-card">
        <div className="moovu-update-icon" aria-hidden="true"><Download /></div>
        <h2 id="moovu-update-title">A new MOOVU {app === "driver" ? "Driver " : ""}app is ready</h2>
        <p>Update to get the newest look, faster sign-in with Google or Apple, and better trip alerts. Your account and trips stay the same.</p>
        <a className="moovu-update-btn" href={href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
          Update now
        </a>
        <button type="button" className="moovu-link-later" onClick={later}>Later</button>
      </div>
    </div>
  );
}
