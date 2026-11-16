/** Utilitários de telefone/JID do WhatsApp. */

export function digits(v: string): string {
  return v.replace(/\D/g, "");
}

/** "5511988887777@s.whatsapp.net" ou "5511988887777:12@s.whatsapp.net" → "5511988887777" */
export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [user, server] = jid.split("@");
  if (server !== "s.whatsapp.net" && server !== "c.us") return null;
  const d = digits(user.split(":")[0]);
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export function phoneToJid(phone: string): string {
  return `${digits(phone)}@s.whatsapp.net`;
}

/**
 * Números do Brasil podem aparecer com ou sem o 9º dígito no WhatsApp
 * (ex.: 5511988887777 x 551188887777). Retorna as duas variantes.
 */
export function phoneCandidates(phone: string): string[] {
  const d = digits(phone);
  const out = new Set([d]);
  const br = /^55(\d{2})(\d{8,9})$/.exec(d);
  if (br) {
    const [, ddd, num] = br;
    if (num.length === 9 && num.startsWith("9")) out.add(`55${ddd}${num.slice(1)}`);
    if (num.length === 8 && /^[6-9]/.test(num)) out.add(`55${ddd}9${num}`);
  }
  return [...out];
}

export function isIndividualChat(jid: string | null | undefined): boolean {
  if (!jid) return false;
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid") || jid.endsWith("@c.us");
}
