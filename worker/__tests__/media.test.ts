import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describeMedia, extFromMime, safeName, toOggOpus } from "../media";
import { handleIncoming } from "../inbound";
import type { InboundRepo } from "../repo";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("utilitários de mídia", () => {
  it("nome de arquivo seguro não permite sair da pasta", () => {
    expect(safeName("../../outro-tenant/contrato.pdf")).not.toContain("/");
    expect(safeName("../../x")).not.toMatch(/^\./);
    expect(safeName("Relatório final (v2).pdf")).toBe("Relatorio_final_v2_.pdf");
  });
  it("extensão pelo nome ou pelo tipo", () => {
    expect(extFromMime("application/pdf", "Contrato.PDF")).toBe("pdf");
    expect(extFromMime("audio/ogg; codecs=opus")).toBe("ogg");
    expect(extFromMime("application/x-desconhecido")).toBe("bin");
  });
  it("identifica o tipo de mídia recebida", () => {
    expect(describeMedia({ imageMessage: { mimetype: "image/jpeg", fileLength: 100 } })?.kind).toBe("image");
    expect(describeMedia({ audioMessage: { mimetype: "audio/ogg" } })?.kind).toBe("audio");
    expect(describeMedia({ documentMessage: { fileName: "a.pdf", mimetype: "application/pdf" } })).toMatchObject({ kind: "document", filename: "a.pdf" });
    expect(describeMedia({ conversation: "oi" })).toBeNull();
  });
});

describe.runIf(hasFfmpeg)("conversão de áudio (ffmpeg real)", () => {
  it("converte webm do navegador para OGG/Opus", async () => {
    const webm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", "-f", "webm", "pipe:1"]);
    const ogg = await toOggOpus(webm);
    expect(ogg.subarray(0, 4).toString()).toBe("OggS");
    expect(ogg.length).toBeGreaterThan(500);
  });
  it("falha de forma controlada com arquivo inválido", async () => {
    await expect(toOggOpus(Buffer.from("isso não é áudio"))).rejects.toThrow();
  });
});

describe("mídia recebida vai para a pasta do tenant da sessão", () => {
  it("chama saveMedia com o contato do tenant e grava o caminho na interação", async () => {
    const saved: unknown[] = [];
    const repo: InboundRepo = {
      tenantId: "tenant-a",
      findContactByPhones: async () => ({ id: "contato-a" }),
      createContact: async () => ({ id: "novo" }),
      insertInteraction: async (input) => {
        saved.push(input);
        return { id: randomUUID() };
      },
      updateInteractionStatus: async () => undefined,
    };
    const calls: unknown[] = [];
    await handleIncoming(
      repo,
      { key: { id: "M1", remoteJid: "5511988887777@s.whatsapp.net" }, message: { imageMessage: { caption: "comprovante" } } },
      {
        saveMedia: async (info) => {
          calls.push(info);
          return { kind: "image", path: "tenant-a/whatsapp/contato-a/1-M1.jpg", mime: "image/jpeg", filename: null };
        },
      },
    );
    expect(calls).toEqual([{ contactId: "contato-a", externalId: "M1" }]);
    expect(saved[0]).toMatchObject({ body: "[imagem] comprovante", metadata: { media: { path: "tenant-a/whatsapp/contato-a/1-M1.jpg" } } });
  });
});
