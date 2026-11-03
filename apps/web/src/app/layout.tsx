import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Halochime", template: "%s · Halochime" },
  description: "A voice-first support agent for your website. Visitors just talk; it answers from your own knowledge.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fbfaf8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} scroll-smooth`} data-scroll-behavior="smooth">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
