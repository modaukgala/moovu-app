import type { Metadata } from "next";
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
  keywords: [
    "MOOVU",
    "Moovu Rides",
    "Kasi Rides",
    "Ride Hailing",
    "Taxi App",
    "Siyabuswa Transport",
    "South Africa Ride App",
  ],
  authors: [{ name: "MOOVU Group" }],
  icons: {
    icon: "/logo/moovu-logo.png",
  },
  openGraph: {
    title: "MOOVU Kasi Rides",
    description:
      "Book a ride, track your driver live and move smarter with MOOVU Kasi Rides.",
    url: "https://www.moovurides.co.za",
    siteName: "MOOVU Kasi Rides",
    images: [
      {
        url: "/logo/moovu-black.png",
        width: 1200,
        height: 630,
        alt: "MOOVU Kasi Rides",
      },
    ],
    locale: "en_ZA",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}