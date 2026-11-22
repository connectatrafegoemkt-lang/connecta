import { describe, expect, it } from "vitest";
import { hexToWaColor, nextLabelId, onLabelEdit, processLabelQueue, waColorToHex, WA_LABEL_COLORS, type LabelQueueItem, type LabelRepo } from "../labels";

function fakeRepo(queue: LabelQueueItem[], tags: Record<string, { id: string; name: string; color: string; wa_label_id: string | null }>) {
  const calls: string[] = [];
  const done: Record<string, boolean> = {};
  const repo: LabelRepo = {
    upsertTagFromWhatsapp: async (l) => void calls.push(`upsert:${l.id}:${l.name}:${l.color}`),
    deleteTagByWaLabel: async (id) => void calls.push(`delete:${id}`),
    setContactLabel: async () => undefined,
    claimLabelQueue: async () => queue,
    finishLabelQueue: async (id, ok) => void (done[id] = ok),
    getTag: async (id) => tags[id] ?? null,
    listWaLabelIds: async () => Object.values(tags).map((t) => t.wa_label_id).filter((x): x is string => !!x),
    setTagWaLabel: async (id, wa) => void (tags[id]!.wa_label_id = wa),
    getContactPhone: async (id) => (id === "c1" ? "5541999998888" : null),
  };
  return { repo, calls, done };
}

function fakeSock() {
  const calls: string[] = [];
  return {
    calls,
    sock: {
      addLabel: async (_j: string, l: { id: string; name?: string; deleted?: boolean }) => void calls.push(`label:${l.id}:${l.deleted ? "del" : l.name}`),
      addChatLabel: async (j: string, id: string) => void calls.push(`add:${j}:${id}`),
      removeChatLabel: async (j: string, id: string) => void calls.push(`rm:${j}:${id}`),
    },
  };
}

describe("etiquetas do WhatsApp", () => {
  it("cores: ida e volta entre as 20 cores do WhatsApp", () => {
    WA_LABEL_COLORS.forEach((hex, i) => expect(hexToWaColor(hex)).toBe(i));
    expect(waColorToHex(3)).toBe(WA_LABEL_COLORS[3]);
    expect(waColorToHex(null)).toBe(WA_LABEL_COLORS[0]);
  });

  it("id de etiqueta nova não colide com as existentes", () => {
    expect(nextLabelId([])).toBe("101");
    expect(nextLabelId(["1", "5", "230", null, "x"])).toBe("231");
  });

  it("WhatsApp → CRM: cria/atualiza e exclui", async () => {
    const { repo, calls } = fakeRepo([], {});
    await onLabelEdit(repo, { id: "3", name: " Cliente novo ", color: 1, deleted: false });
    await onLabelEdit(repo, { id: "4", name: "Antiga", color: 0, deleted: true });
    await onLabelEdit(repo, { id: "5", name: "  ", color: 0, deleted: false });
    expect(calls).toEqual([`upsert:3:Cliente novo:${WA_LABEL_COLORS[1]}`, "delete:4"]);
  });

  it("CRM → WhatsApp: cria a etiqueta no celular na 1ª vez e aplica na conversa", async () => {
    const tags = { t1: { id: "t1", name: "Tráfego pago", color: "#a100ff", wa_label_id: null }, t2: { id: "t2", name: "Urgente", color: "#f74848", wa_label_id: "7" } };
    const queue: LabelQueueItem[] = [
      { id: "q1", kind: "chat_add", contact_id: "c1", tag_id: "t1", wa_label_id: null, attempts: 0 },
      { id: "q2", kind: "chat_remove", contact_id: "c1", tag_id: null, wa_label_id: "7", attempts: 0 },
      { id: "q3", kind: "label_upsert", tag_id: "t2", contact_id: null, wa_label_id: null, attempts: 0 },
      { id: "q4", kind: "label_delete", tag_id: null, contact_id: null, wa_label_id: "9", attempts: 0 },
      { id: "q5", kind: "chat_add", contact_id: "sem-telefone", tag_id: "t2", wa_label_id: null, attempts: 0 },
    ];
    const { repo, done } = fakeRepo(queue, tags);
    const { sock, calls } = fakeSock();
    expect(await processLabelQueue(repo, sock, "eu@s.whatsapp.net")).toBe(5);
    expect(calls).toEqual([
      "label:101:Tráfego pago",
      "add:5541999998888@s.whatsapp.net:101",
      "rm:5541999998888@s.whatsapp.net:7",
      "label:7:Urgente",
      "label:9:del",
    ]);
    expect(tags.t1.wa_label_id).toBe("101");
    expect(Object.values(done).every(Boolean)).toBe(true);
  });

  it("erro no WhatsApp volta para a fila (com tentativa contada)", async () => {
    const { repo, done } = fakeRepo([{ id: "q1", kind: "label_delete", tag_id: null, contact_id: null, wa_label_id: "9", attempts: 0 }], {});
    const sock = { addLabel: async () => { throw new Error("não é conta Business"); }, addChatLabel: async () => undefined, removeChatLabel: async () => undefined };
    await processLabelQueue(repo, sock, "eu@s.whatsapp.net");
    expect(done.q1).toBe(false);
  });
});
