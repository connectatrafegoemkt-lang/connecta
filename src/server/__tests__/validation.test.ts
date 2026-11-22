import { describe, expect, it } from "vitest";
import {
  contactCreateSchema,
  contactUpdateSchema,
  interactionCreateSchema,
  taskCreateSchema,
  tagCreateSchema,
  stageCreateSchema,
} from "../validation";

const OTHER = "22222222-2222-4222-8222-222222222222";

describe("schemas de entrada rejeitam tenant_id do cliente", () => {
  it.each([
    ["contactCreate", contactCreateSchema, { name: "x" }],
    ["contactUpdate", contactUpdateSchema, { name: "x" }],
    ["interaction", interactionCreateSchema, { contact_id: OTHER, type: "nota", body: "x" }],
    ["task", taskCreateSchema, { title: "x" }],
    ["tag", tagCreateSchema, { name: "x" }],
    ["stage", stageCreateSchema, { name: "x" }],
  ] as const)("%s", (_n, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, tenant_id: OTHER }).success).toBe(false);
  });

  it("normaliza telefone para dígitos", () => {
    const r = contactCreateSchema.parse({ name: "x", phone: "+55 (11) 98888-7777" });
    expect(r.phone).toBe("5511988887777");
  });

  it("interações do tipo whatsapp não podem ser forjadas pela API", () => {
    expect(interactionCreateSchema.safeParse({ contact_id: OTHER, type: "whatsapp", body: "x" }).success).toBe(false);
  });
});

describe("planilha do relatório mensal", () => {
  it("escapa ; e aspas e neutraliza fórmulas", async () => {
    const { monthlyReportCsv } = await import("../platform");
    const csv = monthlyReportCsv([
      {
        id: "x", name: '=HYPERLINK("x")', slug: "a;b", suspended: false, members: 1, contacts_total: 2, leads_new: 3, leads_won: 1,
        won_value_cents: 123456, leads_lost: 0, open_value_cents: 0, wa_in: 0, wa_out: 0, wa_conversations: 0, ai_responses: 0,
        ai_suggestions: 0, ai_tokens: 0, tasks_created: 0, tasks_done: 0, interactions_other: 0, top_sources: [{ source: "Instagram", count: 3 }],
        paid_leads_new: 4, ad_leads_new: 3, paid_leads_won: 1, paid_won_value_cents: 500000, spend_meta_cents: 80000,
        spend_google_cents: 20000, spend_other_cents: 0, top_campaigns: [{ campaign: "Campanha INSS", count: 3 }],
      },
    ]);
    const line = csv.split("\r\n")[1]!;
    expect(line.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(line).toContain('"a;b"');
    expect(line).toContain("1234,56");
    expect(line).toContain("Instagram (3)");
    // tráfego pago vem primeiro: investimento 1.000, CPL 250, ROAS 5
    expect(line).toContain("1000,00;800,00;200,00;0,00;4;3;250,00;1;5000,00;5,00;Campanha INSS (3)");
  });
});

describe("senha provisória / troca de senha", () => {
  it("exige 10+ caracteres e confirmação igual", async () => {
    const { passwordChangeSchema, passwordResetSchema, platformPasswordResetSchema } = await import("../validation");
    expect(passwordChangeSchema.safeParse({ senha: "curta", confirmacao: "curta" }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ senha: "senha-longa-123", confirmacao: "outra-senha-123" }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ senha: "senha-longa-123", confirmacao: "senha-longa-123" }).success).toBe(true);
    expect(passwordChangeSchema.safeParse({ senha: "senha-longa-123", confirmacao: "senha-longa-123", user_id: "x" }).success).toBe(false);
    expect(passwordResetSchema.safeParse({ senha: "provisoria-1" }).success).toBe(true);
    expect(platformPasswordResetSchema.safeParse({ email: "a@b.com", senha: "provisoria-1", tenant_id: "x" }).success).toBe(false);
  });
});
