import { describe, expect, it, vi } from "vitest";
import { AiResponder } from "../ai-responder";
import { DEFAULT_AI_SETTINGS } from "../../src/shared/ai/settings";

function setup(opts: { mode?: string; enabled?: boolean; paused?: string | null; history?: { direction: "entrada" | "saida"; body: string }[]; handoff?: boolean } = {}) {
  const repo = {
    tenantId: "t-a",
    getAiSettingsRow: vi.fn().mockResolvedValue({ ...DEFAULT_AI_SETTINGS, mode: opts.mode ?? "automatico" }),
    getCompanyName: vi.fn().mockResolvedValue("Empresa A"),
    getContactAiState: vi.fn().mockResolvedValue({ id: "c1", name: "Maria", ai_enabled: opts.enabled ?? true, ai_paused_until: opts.paused ?? null }),
    listWhatsappHistory: vi.fn().mockResolvedValue(opts.history ?? [{ direction: "entrada", body: "Oi, qual o horário?" }]),
    recordAiUsage: vi.fn().mockResolvedValue(undefined),
    insertSuggestion: vi.fn().mockResolvedValue(undefined),
    enqueueAiMessage: vi.fn().mockResolvedValue(undefined),
    setContactAiPause: vi.fn().mockResolvedValue(undefined),
    createHandoffTask: vi.fn().mockResolvedValue(undefined),
  };
  const create = vi.fn().mockResolvedValue({
    model: "gpt-5.5",
    usage: { prompt_tokens: 50, completion_tokens: 10 },
    choices: [{
      finish_reason: "stop",
      message: { role: "assistant", refusal: null, content: JSON.stringify({ resposta: "Atendemos das 8h às 18h.", transferir_para_humano: !!opts.handoff, motivo: "faq" }) },
    }],
  });
  const client = { chat: { completions: { create } } };
  const flushed = vi.fn();
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const ai = new AiResponder(repo as never, client as never, log as never, flushed);
  return { repo, create, flushed, ai };
}

describe("AiResponder (atendimento por IA de um tenant)", () => {
  it("modo automático: enfileira a resposta, registra consumo e dispara o envio", async () => {
    const { ai, repo, flushed } = setup();
    await ai.run("c1");
    expect(repo.enqueueAiMessage).toHaveBeenCalledWith("c1", "Atendemos das 8h às 18h.");
    expect(repo.recordAiUsage).toHaveBeenCalledWith(expect.objectContaining({ contact_id: "c1", kind: "resposta" }));
    expect(flushed).toHaveBeenCalled();
    expect(repo.insertSuggestion).not.toHaveBeenCalled();
  });

  it("modo sugerir: só cria sugestão, nunca envia", async () => {
    const { ai, repo } = setup({ mode: "sugerir" });
    await ai.run("c1");
    expect(repo.insertSuggestion).toHaveBeenCalledWith("c1", "Atendemos das 8h às 18h.");
    expect(repo.enqueueAiMessage).not.toHaveBeenCalled();
  });

  it("modo desligado: não chama a IA", async () => {
    const { ai, create } = setup({ mode: "desligado" });
    await ai.run("c1");
    expect(create).not.toHaveBeenCalled();
  });

  it("conversa pausada (humano assumiu) não recebe resposta da IA", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    for (const paused of ["infinity", future]) {
      const { ai, create } = setup({ paused });
      await ai.run("c1");
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("pausa vencida volta a responder", async () => {
    const { ai, repo } = setup({ paused: new Date(Date.now() - 1000).toISOString() });
    await ai.run("c1");
    expect(repo.enqueueAiMessage).toHaveBeenCalled();
  });

  it("se a última mensagem já foi respondida, não responde de novo", async () => {
    const { ai, create } = setup({ history: [{ direction: "entrada", body: "oi" }, { direction: "saida", body: "olá" }] });
    await ai.run("c1");
    expect(create).not.toHaveBeenCalled();
  });

  it("transferência: envia aviso, pausa a IA até reativarem e cria tarefa para a equipe", async () => {
    const { ai, repo } = setup({ handoff: true });
    await ai.run("c1");
    expect(repo.enqueueAiMessage).toHaveBeenCalled();
    expect(repo.setContactAiPause).toHaveBeenCalledWith("c1", "infinity");
    expect(repo.createHandoffTask).toHaveBeenCalledWith("c1", "faq");
  });

  it("número sem IA ativada: não chama a IA nem envia nada", async () => {
    const { ai, create, repo } = setup({ enabled: false });
    await ai.run("c1");
    expect(create).not.toHaveBeenCalled();
    expect(repo.enqueueAiMessage).not.toHaveBeenCalled();
    expect(repo.insertSuggestion).not.toHaveBeenCalled();
  });

  it("número sem IA ativada: humano respondendo não mexe na pausa", async () => {
    const { ai, repo } = setup({ enabled: false });
    await ai.pauseForHuman("c1");
    expect(repo.setContactAiPause).not.toHaveBeenCalled();
  });

  it("humano respondeu: pausa pelo tempo configurado", async () => {
    const { ai, repo } = setup();
    await ai.pauseForHuman("c1");
    const until = new Date(repo.setContactAiPause.mock.calls[0][1]).getTime();
    expect(until).toBeGreaterThan(Date.now() + 11 * 3600_000);
  });

  it("sem chave da API, a IA fica desligada", async () => {
    const { repo } = setup();
    const ai = new AiResponder(repo as never, null, { error: vi.fn() } as never, vi.fn());
    await ai.run("c1");
    expect(repo.getAiSettingsRow).not.toHaveBeenCalled();
  });
});
