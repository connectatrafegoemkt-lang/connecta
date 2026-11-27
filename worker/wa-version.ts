import { fetchLatestBaileysVersion, fetchLatestWaWebVersion, type WAVersion } from "@whiskeysockets/baileys";

/**
 * Versão do WhatsApp Web usada na conexão. A versão que vem embutida na
 * biblioteca envelhece; quando o WhatsApp deixa de aceitá-la, a conexão cai
 * antes de gerar o QR code (fica "Conectando…" para sempre). Por isso
 * buscamos a versão atual e guardamos por 6 horas.
 */
let cached: { version: WAVersion; at: number } | null = null;
const TTL = 6 * 3600_000;

export async function currentWaVersion(log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }): Promise<WAVersion | undefined> {
  if (cached && Date.now() - cached.at < TTL) return cached.version;
  for (const [name, fn] of [
    ["web.whatsapp.com", fetchLatestWaWebVersion],
    ["baileys", fetchLatestBaileysVersion],
  ] as const) {
    try {
      const r = await fn({ signal: AbortSignal.timeout(8_000) });
      // em falha a biblioteca devolve a versão embutida com isLatest=false
      if (r?.isLatest && !r.error && r.version?.length === 3 && r.version.every((n) => Number.isFinite(n))) {
        cached = { version: r.version as WAVersion, at: Date.now() };
        log?.info({ version: r.version.join("."), source: name }, "versão do WhatsApp Web");
        return cached.version;
      }
    } catch (e) {
      log?.warn({ err: e, source: name }, "não consegui buscar a versão do WhatsApp Web");
    }
  }
  return cached?.version; // última conhecida, ou a embutida na biblioteca
}

/** Mensagem clara para cada motivo de queda da conexão. */
export function disconnectMessage(code: number | undefined): string {
  switch (code) {
    case 405:
      return "O WhatsApp recusou a conexão. Tentando de novo com a versão atual…";
    case 408:
      return "O WhatsApp não respondeu a tempo. Tentando de novo…";
    case 403:
      return "O WhatsApp bloqueou ou restringiu este número. Verifique o aplicativo no celular.";
    case 440:
      return "Outra conexão assumiu este número. Tentando reconectar em 1 minuto…";
    case 500:
      return "A conexão com o WhatsApp oscilou. Reconectando…";
    case 515:
      return "O WhatsApp pediu para reiniciar a conexão. Reconectando…";
    default:
      return `Conexão caiu (código ${code ?? "?"}). Reconectando…`;
  }
}
