/**
 * Lead de anúncio (Click-to-WhatsApp do Meta: Instagram/Facebook).
 *
 * Quando alguém clica num anúncio "Enviar mensagem", a primeira mensagem
 * chega com `contextInfo.externalAdReply` (id do anúncio, título, link) e
 * às vezes `conversionSource`. Usamos isso para marcar o contato como lead
 * de TRÁFEGO PAGO automaticamente, com a campanha/anúncio de origem.
 */
export interface AdReferral {
  source_type: string | null;
  source_id: string | null;
  source_url: string | null;
  source_app: string | null;
  title: string | null;
  body: string | null;
  ctwa_clid: string | null;
  conversion_source: string | null;
}

const MESSAGE_KEYS = [
  "extendedTextMessage",
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
  "buttonsResponseMessage",
  "listResponseMessage",
  "templateButtonReplyMessage",
  "interactiveResponseMessage",
];

const str = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractAdReferral(message: Record<string, any> | null | undefined): AdReferral | null {
  if (!message) return null;
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  for (const k of MESSAGE_KEYS) {
    const ctx = m?.[k]?.contextInfo;
    if (!ctx) continue;
    const ad = ctx.externalAdReply;
    const conv = str(ctx.conversionSource ?? ctx.entryPointConversionSource, 100);
    const isAd =
      (ad && (ad.sourceType === "ad" || ad.showAdAttribution || ad.ctwaClid || ad.sourceId)) ||
      (conv !== null && /ad|ctwa|fb_|ig_/i.test(conv));
    if (!isAd) continue;
    return {
      source_type: str(ad?.sourceType, 40),
      source_id: str(ad?.sourceId, 100),
      source_url: str(ad?.sourceUrl, 1000),
      source_app: str(ad?.sourceApp ?? ctx.entryPointConversionApp, 40),
      title: str(ad?.title, 300),
      body: str(ad?.body, 500),
      ctwa_clid: str(ad?.ctwaClid, 200),
      conversion_source: conv,
    };
  }
  return null;
}

/** Nome legível da origem ("Anúncio Instagram", "Anúncio Facebook"...). */
export function adSourceLabel(ref: AdReferral): string {
  const hint = `${ref.source_app ?? ""} ${ref.source_url ?? ""} ${ref.conversion_source ?? ""}`.toLowerCase();
  if (hint.includes("instagram") || /\big_/.test(hint)) return "Anúncio Instagram";
  if (hint.includes("facebook") || hint.includes("fb.") || /\bfb_/.test(hint)) return "Anúncio Facebook";
  return "Anúncio Meta";
}
