import type { Metadata, Viewport } from "next";
import "./globals.css";

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
  openGraph: {
    title: "MOOVU",
    description: "Ride booking made simple.",
    url: "https://moovurides.co.za",
    siteName: "MOOVU",
    images: [
      {
        url: "/Moovu-Black.png",
        width: 1200,
        height: 630,
        alt: "MOOVU",
      },
    ],
    locale: "en_ZA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MOOVU",
    description: "Ride booking made simple.",
    images: ["/Moovu-Black.png"],
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
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}