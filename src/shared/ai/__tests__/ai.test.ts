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
  return { client: { chat: { completions: { create } } } as never, create };
}
const usage = { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 0 } };
const reply = (content: string | null, extra: object = {}) => ({
  model: "gpt-5.5",
  usage,
  choices: [{ finish_reason: "stop", message: { role: "assistant", content, refusal: null, ...extra } }],
});
const history = [{ direction: "entrada" as const, body: "Oi, vocês atendem online?" }];

describe("generateReply", () => {
  it("devolve a resposta estruturada (JSON schema estrito) com o prompt do tenant", async () => {
    const { client, create } = fakeClient(
      reply(JSON.stringify({ resposta: "Sim! Por videochamada.", transferir_para_humano: false, motivo: "faq" })),
    );
    const r = await generateReply({ client, settings: S, companyName: "X", history });
    expect(r).toMatchObject({ reply: "Sim! Por videochamada.", handoff: false, usage: { input_tokens: 100, output_tokens: 20 } });
    const args = create.mock.calls[0][0];
    expect(args.response_format.type).toBe("json_schema");
    expect(args.response_format.json_schema.strict).toBe(true);
    expect(args.messages[0].role).toBe("system");
    expect(args.messages[0].content).toContain("Advocacia trabalhista");
    expect(args.messages.slice(1)).toEqual([{ role: "user", content: "Oi, vocês atendem online?" }]);
  });

  it("resposta cortada (limite) vira transferência", async () => {
    const r0 = reply("{\"resposta\": \"Olá");
    r0.choices[0].finish_reason = "length";
    const { client } = fakeClient(r0);
    const r = await generateReply({ client, settings: S, companyName: "X", history });
    expect(r?.handoff).toBe(true);
  });

  it("recusa do modelo vira transferência para humano com a mensagem configurada", async () => {
    const { client } = fakeClient(reply(null, { refusal: "Não posso ajudar com isso." }));
    const r = await generateReply({ client, settings: S, companyName: "X", history });
    expect(r).toMatchObject({ handoff: true, reply: S.handoff_message });
  });

  it("saída inválida vira transferência (nunca envia lixo)", async () => {
    const { client } = fakeClient(reply("não é json"));
    const r = await generateReply({ client, settings: S, companyName: "X", history });
    expect(r?.handoff).toBe(true);
  });

  it("sem mensagem do cliente não chama a API", async () => {
    const { client, create } = fakeClient({});
    expect(await generateReply({ client, settings: S, companyName: "X", history: [] })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("aiEnabledFor (IA por número)", () => {
  it("só atende quando a equipe ativou e não está pausada", async () => {
    const { aiEnabledFor } = await import("../hours");
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(aiEnabledFor({ ai_enabled: false }, now)).toBe(false);
    expect(aiEnabledFor({}, now)).toBe(false);
    expect(aiEnabledFor({ ai_enabled: true, ai_paused_until: null }, now)).toBe(true);
    expect(aiEnabledFor({ ai_enabled: true, ai_paused_until: "infinity" }, now)).toBe(false);
    expect(aiEnabledFor({ ai_enabled: true, ai_paused_until: "2026-11-18T13:00:00Z" }, now)).toBe(false);
    expect(aiEnabledFor({ ai_enabled: true, ai_paused_until: "2026-11-18T11:00:00Z" }, now)).toBe(true);
  });
});
