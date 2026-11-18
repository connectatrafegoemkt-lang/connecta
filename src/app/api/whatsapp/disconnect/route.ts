import { withTenant } from "@/server/http";
import { requestWhatsapp } from "@/server/data/whatsapp";

export const POST = withTenant(async (_req, ctx) => {
  await requestWhatsapp(ctx, "desconectar");
});
