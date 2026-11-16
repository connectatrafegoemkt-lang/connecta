import { z } from "zod";

/**
 * Schemas de entrada das APIs/Server Actions.
 * TODOS são estritos (`z.strictObject`): qualquer campo desconhecido —
 * inclusive `tenant_id` — faz a requisição ser rejeitada com 400.
 */
const uuid = z.uuid();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ""))
  .pipe(z.string().regex(/^[0-9]{8,15}$/, "Telefone inválido (use DDI + DDD + número)"));

export const contactCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320).nullable().optional().or(z.literal("").transform(() => null)),
  phone: phoneSchema.nullable().optional().or(z.literal("").transform(() => null)),
  company: optionalText(200),
  source: optionalText(100),
  notes: optionalText(10000),
  value_cents: z.coerce.number().int().min(0).max(1e13).optional(),
  stage_id: uuid.nullable().optional(),
  owner_id: uuid.nullable().optional(),
  tag_ids: z.array(uuid).max(50).optional(),
});
export const contactUpdateSchema = contactCreateSchema.partial();
export type ContactCreate = z.infer<typeof contactCreateSchema>;
export type ContactUpdate = z.infer<typeof contactUpdateSchema>;

export const contactMoveSchema = z.strictObject({
  stage_id: uuid,
  position: z.number().int().min(0).max(1_000_000),
});

export const contactListQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  stage_id: uuid.optional(),
  tag_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const stageCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  color: hex.optional(),
  position: z.number().int().min(0).max(1000).optional(),
  is_won: z.boolean().optional(),
  is_lost: z.boolean().optional(),
});
export const stageUpdateSchema = stageCreateSchema.partial();
export const stageReorderSchema = z.strictObject({ ids: z.array(uuid).min(1).max(100) });

export const tagCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(50),
  color: hex.optional(),
});
export const tagUpdateSchema = tagCreateSchema.partial();

export const interactionCreateSchema = z.strictObject({
  contact_id: uuid,
  type: z.enum(["nota", "ligacao", "email", "reuniao"]),
  direction: z.enum(["entrada", "saida", "interna"]).optional(),
  body: z.string().trim().min(1).max(20000),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
});

export const taskCreateSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: optionalText(5000),
  contact_id: uuid.nullable().optional(),
  due_at: z.iso.datetime({ offset: true }).nullable().optional(),
  remind_at: z.iso.datetime({ offset: true }).nullable().optional(),
  assigned_to: uuid.nullable().optional(),
});
export const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: z.enum(["pendente", "concluida", "cancelada"]).optional(),
});
export const taskListQuerySchema = z.strictObject({
  status: z.enum(["pendente", "concluida", "cancelada"]).optional(),
  contact_id: uuid.optional(),
});

export const memberInviteSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(10).max(200),
  display_name: z.string().trim().min(1).max(100),
  role: z.enum(["admin", "atendente"]),
});
export const memberUpdateSchema = z.strictObject({
  role: z.enum(["admin", "atendente"]).optional(),
  display_name: z.string().trim().min(1).max(100).optional(),
});

export const idSchema = uuid;

export const whatsappSendSchema = z.strictObject({
  contact_id: uuid,
  body: z.string().trim().min(1).max(4096),
});
