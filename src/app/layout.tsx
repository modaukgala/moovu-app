import type { Metadata, Viewport } from "next";
import "./globals.css";
import CapacitorBackButtonHandler from "@/components/CapacitorBackButtonHandler";
import PortalNotificationLauncher from "@/components/PortalNotificationLauncher";

export const metadata: Metadata = {
  metadataBase: new URL("https://moovurides.co.za"),
  title: "MOOVU",
  description: "MOOVU ride booking platform",
  applicationName: "MOOVU",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MOOVU",
  },
  formatDetection: {
    telephone: false,
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icon.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0B5FFF",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <CapacitorBackButtonHandler />
        <PortalNotificationLauncher />
      </body>
    </html>
  );
}
