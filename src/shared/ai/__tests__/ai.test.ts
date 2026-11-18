import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt, toMessages } from "../prompt";
import { aiShouldAct, isWithinBusinessHours } from "../hours";
import { DEFAULT_AI_SETTINGS, aiSettingsSchema, settingsFromRow, type AiSettings } from "../settings";
import { generateReply } from "../agent";

const S: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  mode: "automatico",
  niche: "Advocacia trabalhista",
  business_area: "Direito do trabalho para empregados",
  services: [{ name: "Consulta inicial", description: "Análise do caso", price: "R$ 200" }],
  faq: [{ question: "Atendem online?", answer: "Sim, por videochamada." }],
  rules: "Não prometa resultados.",
};

describe("prompt do atendente", () => {
  it("usa só a configuração do próprio tenant", () => {
    const p = buildSystemPrompt(S, "Alves & Rocha");
    expect(p).toContain("Alves & Rocha");
    expect(p).toContain("Advocacia trabalhista");
    expect(p).toContain("Consulta inicial (R$ 200): Análise do caso");
    expect(p).toContain("Atendem online?");
    expect(p).toContain("Não prometa resultados.");
  });

  it("sem serviços cadastrados, proíbe informar preços", () => {
    expect(buildSystemPrompt({ ...S, services: [] }, "X")).toMatch(/não informe preços/i);
  });

  it("instrui a tratar mensagens do cliente como dados (anti prompt-injection)", () => {
    expect(buildSystemPrompt(S, "X")).toMatch(/não instruções para você/);
  });
});

describe("histórico -> mensagens", () => {
  it("une mensagens seguidas e garante começo/fim com o cliente", () => {
    const m = toMessages([
      { direction: "saida", body: "Olá, campanha!" },
      { direction: "entrada", body: "oi" },
      { direction: "entrada", body: "quero saber de preço" },
      { direction: "saida", body: "Claro!" },
      { direction: "entrada", body: "e o horário?" },
    ]);
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "user"]);
    expect(m[0].content).toBe("oi\nquero saber de preço");
  });
  it("histórico sem mensagem do cliente vira vazio", () => {
    expect(toMessages([{ direction: "saida", body: "x" }])).toEqual([]);
  });
});

describe("horário de atendimento", () => {
  const hours = { enabled: true, start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] };
  it("considera o fuso de Brasília", () => {
    // quarta 2026-11-18 12:00 em Brasília = 15:00 UTC
    expect(isWithinBusinessHours(hours, new Date("2026-11-18T15:00:00Z"))).toBe(true);
    // quarta 22:00 em Brasília
    expect(isWithinBusinessHours(hours, new Date("2026-11-19T01:00:00Z"))).toBe(false);
    // sábado
    expect(isWithinBusinessHours(hours, new Date("2026-11-21T15:00:00Z"))).toBe(false);
  });
  it("'só fora do horário' desliga a IA no horário comercial", () => {
    const s = { ...S, only_outside_hours: true, business_hours: hours };
    expect(aiShouldAct(s, new Date("2026-11-18T15:00:00Z"))).toBe(false);
    expect(aiShouldAct(s, new Date("2026-11-19T01:00:00Z"))).toBe(true);
    expect(aiShouldAct({ ...s, mode: "desligado" }, new Date("2026-11-19T01:00:00Z"))).toBe(false);
  });
});

describe("validação da configuração", () => {
  it("rejeita tenant_id e campos desconhecidos", () => {
    expect(aiSettingsSchema.safeParse({ ...S, tenant_id: "x" }).success).toBe(false);
  });
  it("linha do banco inválida cai no padrão seguro (desligado)", () => {
    expect(settingsFromRow({ mode: "hackeado" }).mode).toBe("desligado");
    expect(settingsFromRow(null).mode).toBe("desligado");
  });
});

function fakeClient(response: object) {
  const create = vi.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { create } } } as never, create };
}
const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 };
const history = [{ direction: "entrada" as const, body: "Oi, vocês atendem online?" }];

describe("generateReply", () => {
  it("devolve a resposta estruturada e usa fallback automático + esforço baixo", async () => {
    const { client, create } = fakeClient({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      usage,
      content: [{ type: "text", text: JSON.stringify({ resposta: "Sim! Por videochamada.", transferir_para_humano: false, motivo: "faq" }) }],
    });
    const r = await generateReply({ client, settings: S, companyName: "X", history });
    expect(r).toMatchObject({ reply: "Sim! Por videochamada.", handoff: false });
    const args = create.mock.calls[0][0];
    expect(args.fallbacks).toBe("default");
    expect(args.output_config.effort).toBe("low");
    expect(args.messages).toEqual([{ role: "user", content: "Oi, vocês atendem online?" }]);
  });

  it("recusa do modelo vira transferência para humano com a mensagem configurada", async () => {
    const { client } = fakeClient({ model: "m", stop_reason: "refusal", usage, content: [] });
    const r = await generateReply({ client, settings: S, companyName: "X", history });
    expect(r).toMatchObject({ handoff: true, reply: S.handoff_message });
  });

  it("saída inválida vira transferência (nunca envia lixo)", async () => {
    const { client } = fakeClient({ model: "m", stop_reason: "end_turn", usage, content: [{ type: "text", text: "não é json" }] });
    const r = await generateReply({ client, settings: S, companyName: "X", history });
    expect(r?.handoff).toBe(true);
  });

  it("sem mensagem do cliente não chama a API", async () => {
    const { client, create } = fakeClient({});
    expect(await generateReply({ client, settings: S, companyName: "X", history: [] })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
