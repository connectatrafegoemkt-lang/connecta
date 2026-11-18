import { z } from "zod";

/** Configuração do atendente de IA de um tenant (validada no app e no worker). */
const service = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  price: z.string().trim().max(60).default(""),
});
const faqItem = z.strictObject({
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(1500),
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const aiSettingsSchema = z.strictObject({
  mode: z.enum(["desligado", "sugerir", "automatico"]),
  assistant_name: z.string().trim().min(1).max(60),
  niche: z.string().trim().max(120).nullable().default(null),
  business_area: z.string().trim().max(300).nullable().default(null),
  company_description: z.string().trim().max(4000).nullable().default(null),
  services: z.array(service).max(60).default([]),
  faq: z.array(faqItem).max(60).default([]),
  tone: z.enum(["formal", "amigavel", "descontraido"]),
  rules: z.string().trim().max(4000).nullable().default(null),
  greeting: z.string().trim().max(500).nullable().default(null),
  handoff_message: z.string().trim().min(1).max(500),
  business_hours: z.strictObject({
    enabled: z.boolean(),
    start: hhmm,
    end: hhmm,
    days: z.array(z.number().int().min(0).max(6)).max(7),
  }),
  only_outside_hours: z.boolean(),
  human_pause_hours: z.number().int().min(1).max(720),
});

export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  mode: "desligado",
  assistant_name: "Assistente virtual",
  niche: null,
  business_area: null,
  company_description: null,
  services: [],
  faq: [],
  tone: "amigavel",
  rules: null,
  greeting: null,
  handoff_message: "Vou chamar uma pessoa da nossa equipe para continuar o seu atendimento. Só um instante!",
  business_hours: { enabled: false, start: "08:00", end: "18:00", days: [1, 2, 3, 4, 5] },
  only_outside_hours: false,
  human_pause_hours: 12,
};

/** Converte a linha do banco (campos extras ignorados) em AiSettings válido. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): AiSettings {
  if (!row) return DEFAULT_AI_SETTINGS;
  const picked = Object.fromEntries(
    Object.keys(DEFAULT_AI_SETTINGS).map((k) => [k, row[k] ?? DEFAULT_AI_SETTINGS[k as keyof AiSettings]]),
  );
  const parsed = aiSettingsSchema.safeParse(picked);
  return parsed.success ? parsed.data : DEFAULT_AI_SETTINGS;
}

/** Sugestões prontas por nicho (o admin pode editar depois). */
export const NICHE_PRESETS: Record<string, { label: string; rules: string }> = {
  advocacia: {
    label: "Advocacia (regras da OAB)",
    rules: [
      "Não prometa resultados, ganho de causa ou prazos de decisões judiciais.",
      "Não dê parecer jurídico definitivo: explique de forma geral e ofereça uma consulta com o advogado.",
      "Não informe valores de honorários que não estejam na lista de serviços; diga que o advogado vai apresentar a proposta.",
      "Não faça captação agressiva nem compare o escritório com outros.",
      "Se o assunto for urgente (prisão, prazo vencendo, audiência marcada), transfira imediatamente para um humano.",
    ].join("\n"),
  },
  saude: {
    label: "Saúde / clínicas",
    rules: [
      "Não faça diagnósticos nem indique medicamentos ou doses.",
      "Em sintomas graves ou emergência, oriente a procurar atendimento de urgência (SAMU 192) e transfira para um humano.",
      "Não compartilhe dados de outros pacientes.",
    ].join("\n"),
  },
  comercio: {
    label: "Comércio / loja",
    rules: [
      "Só informe preços e prazos que estejam na lista de produtos.",
      "Não confirme estoque nem entrega sem consultar a equipe: diga que vai verificar.",
    ].join("\n"),
  },
};
