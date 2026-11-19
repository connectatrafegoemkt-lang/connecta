import { describe, expect, it, vi } from "vitest";
import { INTERRUPTED_MESSAGE, recoverStuckOutbox } from "../outbox-recovery";

function repo(stuck: { id: string; contact_id: string; body: string; created_at: string }[], sentIds: Record<string, string | null>) {
  return {
    listStuckOutbox: vi.fn().mockResolvedValue(stuck),
    findSentInteraction: vi.fn(async (contactId: string, body: string) => {
      const id = sentIds[`${contactId}:${body}`];
      return id ? { id } : null;
    }),
    finishOutbox: vi.fn().mockResolvedValue(undefined),
  };
}

describe("recoverStuckOutbox", () => {
  it("mensagem que já está na conversa vira 'enviado' (sem reenviar)", async () => {
    const r = repo([{ id: "o1", contact_id: "c1", body: "teste", created_at: "2026-11-19T15:58:00Z" }], { "c1:teste": "i1" });
    const out = await recoverStuckOutbox(r, Date.parse("2026-11-19T16:10:00Z"));
    expect(out).toEqual({ sent: 1, failed: 0 });
    expect(r.finishOutbox).toHaveBeenCalledWith("o1", "enviado", { interaction_id: "i1" });
  });

  it("mensagem que não aparece na conversa vira 'erro' com aviso claro (nunca reenvia)", async () => {
    const r = repo([{ id: "o2", contact_id: "c1", body: "oi", created_at: "2026-11-19T15:58:00Z" }], {});
    await recoverStuckOutbox(r, Date.parse("2026-11-19T16:10:00Z"));
    expect(r.finishOutbox).toHaveBeenCalledWith("o2", "erro", { error: INTERRUPTED_MESSAGE });
  });

  it("só considera presas as linhas paradas há mais de 1 minuto", async () => {
    const r = repo([], {});
    await recoverStuckOutbox(r, Date.parse("2026-11-19T16:10:00Z"));
    expect(r.listStuckOutbox).toHaveBeenCalledWith("2026-11-19T16:09:00.000Z");
  });
});
