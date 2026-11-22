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
