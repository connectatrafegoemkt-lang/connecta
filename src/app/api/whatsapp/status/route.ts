import { withTenant } from "@/server/http";
import { getWhatsappQr, getWhatsappSession } from "@/server/data/whatsapp";

export const GET = withTenant(async (_req, ctx) => ({
  ...(await getWhatsappSession(ctx)),
  qr: await getWhatsappQr(ctx),
}));
