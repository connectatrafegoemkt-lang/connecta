import { phoneCandidates, phoneToJid } from "./phone";

type Lookup = (...numbers: string[]) => Promise<{ jid: string; exists: unknown }[] | undefined>;

/**
 * Descobre o JID REAL de um número no WhatsApp antes de enviar.
 *
 * No Brasil muitos números estão registrados no WhatsApp SEM o 9º dígito
 * (ex.: 5531988887777 é 553188887777@s.whatsapp.net). Enviar para o JID
 * "montado" com o 9 cria uma conversa que não é a do contato: a mensagem não
 * aparece no celular nem chega direito. Aqui perguntamos ao WhatsApp qual
 * variante existe e guardamos a resposta.
 *
 * Devolve o JID real; null se o número não tem WhatsApp; e, se a consulta
 * falhar, o JID montado (comportamento antigo) para não travar o envio.
 */
export class JidResolver {
  private cache = new Map<string, { jid: string | null; until: number }>();

  constructor(
    private readonly lookup: Lookup,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(phone: string): Promise<string | null> {
    const key = phone.replace(/\D/g, "");
    const hit = this.cache.get(key);
    if (hit && hit.until > this.now()) return hit.jid;
    const candidates = phoneCandidates(key);
    let found: { jid: string; exists: unknown }[] | undefined;
    try {
      found = await this.lookup(...candidates);
    } catch {
      return phoneToJid(key);
    }
    if (!found) return phoneToJid(key);
    const existing = found.filter((r) => r.exists && r.jid);
    const exact = existing.find((r) => r.jid.split("@")[0].split(":")[0] === key);
    const jid = (exact ?? existing[0])?.jid ?? null;
    // achou: guarda 12h; "não tem WhatsApp": guarda só 10 min
    this.cache.set(key, { jid, until: this.now() + (jid ? 12 * 3600_000 : 10 * 60_000) });
    return jid;
  }
}
