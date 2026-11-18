import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { currentTheme } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "CONNECTA CRM", template: "%s · CONNECTA CRM" },
  description: "CRM multi-cliente da CONNECTA",
};

export const viewport: Viewport = { themeColor: "#a100ff" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await currentTheme();
  return (
    <html lang="pt-BR" data-theme={theme} className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
