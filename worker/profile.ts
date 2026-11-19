/**
 * Foto de perfil, nome e recado ("status") do contato no WhatsApp.
 * Busca no máximo a cada 24h por contato. A foto é copiada para o bucket
 * privado do tenant (<tenant_id>/avatars/<contato>.jpg): o link do WhatsApp
 * expira e não deve ser exposto ao navegador.
 */
export const PROFILE_TTL_MS = 24 * 3600_000;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export interface ProfileRepo {
  tenantId: string;
  getContactProfileState(contactId: string): Promise<{ profile_checked_at: string | null } | null>;
  uploadMedia(path: string, data: Buffer, contentType: string): Promise<void>;
  saveContactProfile(
    contactId: string,
    p: { avatar_path?: string | null; whatsapp_name?: string | null; whatsapp_about?: string | null },
  ): Promise<void>;
}

export interface ProfileSource {
  pictureUrl(jid: string): Promise<string | null>;
  about(jid: string): Promise<unknown>; // resposta crua do Baileys (extractAbout interpreta)
  download(url: string): Promise<Buffer>;
}

/** Extrai o recado das várias formas de resposta do Baileys. */
export function extractAbout(res: unknown): string | null {
  const first = Array.isArray(res) ? res[0] : res;
  if (!first || typeof first !== "object") return null;
  const s = (first as { status?: unknown }).status;
  if (typeof s === "string") return s.trim() || null;
  if (s && typeof s === "object" && typeof (s as { status?: unknown }).status === "string") {
    return ((s as { status: string }).status).trim() || null;
  }
  return null;
}

export function isProfileStale(checkedAt: string | null | undefined, now = Date.now()) {
  return !checkedAt || now - new Date(checkedAt).getTime() > PROFILE_TTL_MS;
}

export async function refreshContactProfile(
  repo: ProfileRepo,
  src: ProfileSource,
  contactId: string,
  jid: string,
  opts: { force?: boolean; now?: number } = {},
): Promise<"updated" | "fresh" | "missing"> {
  const state = await repo.getContactProfileState(contactId);
  if (!state) return "missing";
  if (!opts.force && !isProfileStale(state.profile_checked_at, opts.now)) return "fresh";

  let avatar_path: string | null = null;
  const url = await src.pictureUrl(jid).catch(() => null); // privacidade do contato pode bloquear
  if (url) {
    const data = await src.download(url).catch(() => null);
    if (data && data.length > 0 && data.length <= MAX_AVATAR_BYTES) {
      avatar_path = `${repo.tenantId}/avatars/${contactId}.jpg`;
      await repo.uploadMedia(avatar_path, data, "image/jpeg");
    }
  }
  const about = await src.about(jid).then(extractAbout).catch(() => null);
  await repo.saveContactProfile(contactId, { avatar_path, whatsapp_about: about });
  return "updated";
}
