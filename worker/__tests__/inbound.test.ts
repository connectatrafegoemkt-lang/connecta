import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { extractText, handleIncoming } from "../inbound";
import type { InboundRepo } from "../repo";

/** "Banco" em memória com vários tenants, para provar o isolamento. */
function fakeDb() {
  const contacts: { id: string; tenant_id: string; phone: string; name: string }[] = [];
  const interactions: { id: string; tenant_id: string; contact_id: string; external_id: string; direction: string; body: string }[] = [];
  const repoFor = (tenantId: string): InboundRepo => ({
    tenantId,
    async findContactByPhones(phones) {
      return contacts.find((c) => c.tenant_id === tenantId && phones.includes(c.phone)) ?? null;
    },
    async createContact({ name, phone }) {
      const c = { id: randomUUID(), tenant_id: tenantId, name, phone };
      contacts.push(c);
      return { id: c.id };
    },
    async insertInteraction(input) {
      if (interactions.some((i) => i.tenant_id === tenantId && i.external_id === input.external_id)) return null;
      const contact = contacts.find((c) => c.id === input.contact_id);
      if (!contact || contact.tenant_id !== tenantId) throw new Error("FK composta violada");
      const row = { id: randomUUID(), tenant_id: tenantId, ...input };
      interactions.push(row);
      return { id: row.id };
    },
    async updateInteractionStatus() {},
  });
  return { contacts, interactions, repoFor };
}

const A = "tenant-a";
const B = "tenant-b";
const msg = (over: Partial<{ id: string; jid: string; fromMe: boolean; text: string }> = {}) => ({
  key: { id: over.id ?? randomUUID(), remoteJid: over.jid ?? "5511988887777@s.whatsapp.net", fromMe: over.fromMe ?? false },
  pushName: "Maria",
  messageTimestamp: 1_760_000_000,
  message: { conversation: over.text ?? "Olá!" },
});

describe("mensagens recebidas viram interações SÓ no tenant da sessão", () => {
  it("mesmo telefone em A e B: mensagem recebida pela sessão de A vai para o contato de A", async () => {
    const db = fakeDb();
    const ra = db.repoFor(A);
    const rb = db.repoFor(B);
    const ca = await ra.createContact({ name: "Maria (A)", phone: "5511988887777" });
    const cb = await rb.createContact({ name: "Maria (B)", phone: "5511988887777" });

    expect(await handleIncoming(ra, msg({ text: "mensagem para A" }))).toBe("stored");

    expect(db.interactions).toHaveLength(1);
    expect(db.interactions[0]).toMatchObject({ tenant_id: A, contact_id: ca.id, direction: "entrada", body: "mensagem para A" });
    expect(db.interactions.some((i) => i.contact_id === cb.id)).toBe(false);
  });

  it("número desconhecido cria contato no tenant da sessão (não em outro)", async () => {
    const db = fakeDb();
    await db.repoFor(B).createContact({ name: "Outro", phone: "5521977776666" });
    await handleIncoming(db.repoFor(A), msg({ jid: "5521977776666@s.whatsapp.net" }));
    const created = db.contacts.filter((c) => c.tenant_id === A);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Maria", phone: "5521977776666" });
    expect(db.contacts.filter((c) => c.tenant_id === B)).toHaveLength(1);
  });

  it("encontra contato salvo sem o 9º dígito", async () => {
    const db = fakeDb();
    const ra = db.repoFor(A);
    const c = await ra.createContact({ name: "Antigo", phone: "551188887777" });
    await handleIncoming(ra, msg({ jid: "5511988887777@s.whatsapp.net" }));
    expect(db.interactions[0].contact_id).toBe(c.id);
  });

  it("mensagem duplicada não gera duas interações", async () => {
    const db = fakeDb();
    const ra = db.repoFor(A);
    const m = msg({ id: "MSG1" });
    expect(await handleIncoming(ra, m)).toBe("stored");
    expect(await handleIncoming(ra, m)).toBe("duplicate");
    expect(db.interactions).toHaveLength(1);
  });

  it("mensagem enviada pelo celular (fromMe) vira interação de saída", async () => {
    const db = fakeDb();
    await handleIncoming(db.repoFor(A), msg({ fromMe: true }));
    expect(db.interactions[0].direction).toBe("saida");
  });

  it("ignora grupos, status e mensagens sem conteúdo", async () => {
    const db = fakeDb();
    const ra = db.repoFor(A);
    expect(await handleIncoming(ra, msg({ jid: "123-456@g.us" }))).toBe("ignored");
    expect(await handleIncoming(ra, msg({ jid: "status@broadcast" }))).toBe("ignored");
    expect(await handleIncoming(ra, { key: { id: "x", remoteJid: "5511988887777@s.whatsapp.net" }, message: { protocolMessage: {} } })).toBe("ignored");
    expect(db.interactions).toHaveLength(0);
  });

  it("usa remoteJidAlt quando o chat vem como LID", async () => {
    const db = fakeDb();
    const r = await handleIncoming(db.repoFor(A), {
      key: { id: "L1", remoteJid: "987654321@lid", remoteJidAlt: "5511988887777@s.whatsapp.net" },
      message: { conversation: "oi" },
    });
    expect(r).toBe("stored");
    expect(db.contacts[0].phone).toBe("5511988887777");
  });

  it("extrai textos de mídias", () => {
    expect(extractText({ imageMessage: { caption: "foto" } })).toBe("[imagem] foto");
    expect(extractText({ audioMessage: {} })).toBe("[áudio]");
    expect(extractText({ extendedTextMessage: { text: "link" } })).toBe("link");
  });
});
