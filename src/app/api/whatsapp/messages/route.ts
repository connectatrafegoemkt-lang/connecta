import { withTenant, readJson } from "@/server/http";
import { whatsappSendSchema } from "@/server/validation";
import { queueWhatsappMessage } from "@/server/data/whatsapp";

export const POST = withTenant(async (req, ctx) => {
  const { contact_id, body } = await readJson(req, whatsappSendSchema);
  return Response.json(await queueWhatsappMessage(ctx, contact_id, body), { status: 202 });
});
