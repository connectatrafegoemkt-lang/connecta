"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/error-screen";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-full font-sans">
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
