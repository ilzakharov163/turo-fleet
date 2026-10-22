import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"] });

export const metadata: Metadata = {
  title: "Fleet Manager — Turo",
  description: "Управление автопарком Turo",
  appleWebApp: { capable: true, title: "Fleet", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#161C2E' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="h-full" suppressHydrationWarning>
      <head>
        {/* Тёмная тема по настройке системы — до первой отрисовки, без белой вспышки */}
        <script dangerouslySetInnerHTML={{ __html: "if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')" }} />
      </head>
      <body className={`${inter.className} min-h-full`}>{children}</body>
    </html>
  );
}
