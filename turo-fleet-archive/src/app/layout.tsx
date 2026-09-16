import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Fleet Manager — Turo",
  description: "Управление автопарком Turo",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="h-full" suppressHydrationWarning>
      <body className={`${inter.className} min-h-full`}>{children}</body>
    </html>
  );
}
