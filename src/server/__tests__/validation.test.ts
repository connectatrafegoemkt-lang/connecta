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
