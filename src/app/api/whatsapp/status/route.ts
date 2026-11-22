import { withTenant } from "@/server/http";
import { getWhatsappQr, getWhatsappQrs, getWhatsappSession, listWhatsappNumbers } from "@/server/data/whatsapp";

/** Situação geral (compatível com antes) + cada número com seu QR. */
export const GET = withTenant(async (_req, ctx) => {
  const [session, qr, numbers, qrs] = await Promise.all([getWhatsappSession(ctx), getWhatsappQr(ctx), listWhatsappNumbers(ctx), getWhatsappQrs(ctx)]);
  return { ...session, qr, numbers: numbers.map((n) => ({ ...n, qr: qrs[n.id] ?? null })) };
});
