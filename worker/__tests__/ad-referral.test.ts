import { describe, expect, it } from "vitest";
import { adSourceLabel, extractAdReferral } from "../ad-referral";

describe("lead de anúncio (Click-to-WhatsApp)", () => {
  it("reconhece a primeira mensagem vinda de anúncio do Instagram", () => {
    const ref = extractAdReferral({
      extendedTextMessage: {
        text: "Olá! Quero mais informações.",
        contextInfo: {
          externalAdReply: {
            title: "Seus direitos trabalhistas",
            body: "Fale com um advogado",
            sourceType: "ad",
            sourceId: "120210000000001",
            sourceUrl: "https://www.instagram.com/p/abc/",
            ctwaClid: "ARAkLk...",
            showAdAttribution: true,
          },
          conversionSource: "FB_Ads",
        },
      },
    });
    expect(ref).toMatchObject({ title: "Seus direitos trabalhistas", source_id: "120210000000001", ctwa_clid: "ARAkLk..." });
    expect(adSourceLabel(ref!)).toBe("Anúncio Instagram");
  });

  it("funciona em mensagens temporárias e com imagem", () => {
    const ref = extractAdReferral({
      ephemeralMessage: { message: { imageMessage: { contextInfo: { externalAdReply: { sourceType: "ad", sourceId: "9", sourceUrl: "https://fb.me/x" } } } } },
    });
    expect(ref?.source_id).toBe("9");
    expect(adSourceLabel(ref!)).toBe("Anúncio Facebook");
  });

  it("mensagem comum, link compartilhado ou resposta citada não contam como anúncio", () => {
    expect(extractAdReferral({ conversation: "oi" })).toBeNull();
    expect(extractAdReferral({ extendedTextMessage: { text: "olha", contextInfo: { externalAdReply: { title: "Notícia", sourceType: "link" } } } })).toBeNull();
    expect(extractAdReferral({ extendedTextMessage: { text: "ok", contextInfo: { stanzaId: "x", quotedMessage: {} } } })).toBeNull();
    expect(extractAdReferral(null)).toBeNull();
  });
});
