import { withTenant, parseId } from "@/server/http";
import { badRequest } from "@/server/errors";
import { queueMediaMessage } from "@/server/data/whatsapp-media";

/**
 * Envia (ou agenda) áudio/imagem/vídeo/documento para um contato do tenant
 * da sessão. multipart/form-data: file, contact_id, caption?, scheduled_at?, voice?, session_id?
 */
export const POST = withTenant(async (req, ctx) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Envio inválido");
  }
  for (const key of form.keys()) {
    if (!["file", "contact_id", "caption", "scheduled_at", "voice", "session_id"].includes(key)) throw badRequest("Campo não permitido");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Arquivo ausente");
  const scheduled = String(form.get("scheduled_at") ?? "").trim();
  const result = await queueMediaMessage(ctx, {
    contactId: parseId(String(form.get("contact_id") ?? "")),
    file,
    caption: String(form.get("caption") ?? "").trim(),
    scheduledAt: scheduled ? new Date(scheduled).toISOString() : null,
    asVoice: form.get("voice") === "1",
    sessionId: form.get("session_id") ? parseId(String(form.get("session_id"))) : null,
  });
  return Response.json(result, { status: 202 });
});
