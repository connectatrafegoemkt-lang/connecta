import { describe, expect, it } from "vitest";
import { classifyUpload } from "../data/whatsapp-media";
import { quickReplySchema } from "../validation";
import { safeName } from "@/shared/media-names";

describe("upload de mídia do WhatsApp", () => {
  it("classifica tipos permitidos", () => {
    expect(classifyUpload("image/png")).toBe("image");
    expect(classifyUpload("audio/webm;codecs=opus")).toBe("audio");
    expect(classifyUpload("video/mp4")).toBe("video");
    expect(classifyUpload("application/pdf")).toBe("document");
  });
  it("recusa tipos perigosos ou desconhecidos", () => {
    for (const m of ["text/html", "application/x-msdownload", "image/svg+xml", "application/javascript", ""]) {
      expect(() => classifyUpload(m)).toThrow();
    }
  });
  it("gravação de áudio precisa ser áudio de verdade", () => {
    expect(() => classifyUpload("image/png", true)).toThrow();
  });
  it("nome do arquivo nunca contém barras (não escapa da pasta do tenant)", () => {
    expect(safeName("../../outro/contrato.pdf")).not.toMatch(/[/\\]/);
  });
});

describe("mensagens rápidas", () => {
  it("normaliza o atalho e rejeita tenant_id", () => {
    expect(quickReplySchema.parse({ shortcut: "/BoasVindas", title: "x", body: "y" }).shortcut).toBe("boasvindas");
    expect(quickReplySchema.safeParse({ shortcut: "x", title: "x", body: "y", tenant_id: "z" }).success).toBe(false);
    expect(quickReplySchema.safeParse({ shortcut: "com espaço", title: "x", body: "y" }).success).toBe(false);
  });
});
