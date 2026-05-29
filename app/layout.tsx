import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://getnudgd.com"),
  title: "GetNudgd | Get referred by verified employees",
  description:
    "Sifarish toh hoti hai. Ab fair bhi hai. Get referred by verified employees at top Indian startups. Join the waitlist.",
  openGraph: {
    title: "GetNudgd",
    description: "Get referred by someone on the inside.",
    url: "https://getnudgd.com",
    siteName: "GetNudgd",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${inter.variable}`}
    >
      <body className="seeker-scope">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
