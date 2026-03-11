import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MOOVU Kasi Rides",
  description:
    "MOOVU Kasi Rides is a smart local ride-hailing platform connecting riders and drivers for fast, safe and affordable transport.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icon.png"],
  },
  appleWebApp: {
    capable: true,
    title: "MOOVU",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "MOOVU Kasi Rides",
    description: "Book, track and ride with MOOVU Kasi Rides.",
    url: "https://www.moovurides.co.za",
    siteName: "MOOVU Kasi Rides",
    images: [
      {
        url: "/icon-512.png",
        width: 512,
        height: 512,
        alt: "MOOVU Kasi Rides",
      },
    ],
    locale: "en_ZA",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#2f80ed",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}