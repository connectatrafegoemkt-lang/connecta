import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  // CRM autenticado: todas as páginas são dinâmicas por usuário/tenant.
  // Não usamos Cache Components para evitar qualquer risco de cache
  // compartilhado entre tenants.
  poweredByHeader: false,
  // Gera um servidor enxuto em .next/standalone para rodar em container (VPS).
  output: "standalone",
  serverExternalPackages: ["@whiskeysockets/baileys", "pg"],
  experimental: {
    // envio de áudios/arquivos pelo WhatsApp (limite do app: 20 MB por arquivo)
    proxyClientMaxBodySize: "25mb",
    // áudio gravado na Prospecção vai por server action
    serverActions: { bodySizeLimit: "21mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
