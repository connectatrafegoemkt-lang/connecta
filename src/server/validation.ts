import { z } from "zod";
import { PERMISSION_KEYS, type Permission } from "@/shared/permissions";
import { FIELD_TYPES, NICHE_KEYS, SETUP_GROUPS } from "@/shared/niches";

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
  department_id: uuid.nullable().optional(),
  tag_ids: z.array(uuid).max(50).optional(),
  /** Campos extras da ficha; validados contra contact_fields do tenant no servidor. */
  custom_fields: z
    .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]))
    .refine((o) => Object.keys(o).length <= 40, "Campos demais")
    .optional(),
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
  department_id: uuid.optional(),
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

const profileEnum = z.enum(["admin", "gerente", "atendente", "leitura"]);
const permissionList = z.array(z.enum(PERMISSION_KEYS as [Permission, ...Permission[]])).max(PERMISSION_KEYS.length);
const departmentIds = z.array(uuid).max(50);

export const memberInviteSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(10).max(200),
  display_name: z.string().trim().min(1).max(100),
  profile: profileEnum,
  /** Ajuste fino; se ausente, usa as permissões padrão do perfil. */
  permissions: permissionList.optional(),
  department_ids: departmentIds.optional(),
});
export const memberUpdateSchema = z.strictObject({
  profile: profileEnum.optional(),
  permissions: permissionList.optional(),
  department_ids: departmentIds.optional(),
  display_name: z.string().trim().min(1).max(100).optional(),
});

export const departmentSchema = z.strictObject({
  name: z.string().trim().min(1).max(60),
  color: hex.optional(),
});

export const idSchema = uuid;

export const whatsappSendSchema = z.strictObject({
  contact_id: uuid,
  body: z.string().trim().min(1).max(4096),
});

export const quickReplySchema = z.strictObject({
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^\//, ""))
    .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,29}$/, "Atalho: só letras minúsculas, números, - e _")),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4096),
});

// Painel da CONNECTA: novo cliente + administrador dele
export const platformTenantCreateSchema = z.strictObject({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, "use letras minúsculas, números e hífen")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  admin_email: z.email(),
  admin_password: z.string().min(10).max(200),
  admin_name: z.string().trim().min(1).max(100),
  /** Nicho pré-marcado para o assistente do primeiro acesso (opcional). */
  niche: z.enum(NICHE_KEYS).optional().or(z.literal("").transform(() => undefined)),
});

export const platformSuspendSchema = z.strictObject({
  suspenso: z.boolean(),
  motivo: z.string().trim().max(300).optional(),
});

export const platformDeleteSchema = z.strictObject({
  confirmacao: z.string().trim().min(1).max(60),
});

// Troca de senha (própria) e redefinição de senha provisória
const newPassword = z.string().min(10, "A senha precisa ter pelo menos 10 caracteres").max(200);
export const passwordChangeSchema = z
  .strictObject({ senha: newPassword, confirmacao: z.string().max(200) })
  .refine((v) => v.senha === v.confirmacao, { message: "As senhas não conferem", path: ["confirmacao"] });
export const passwordResetSchema = z.strictObject({ senha: newPassword });
export const platformPasswordResetSchema = z.strictObject({ email: z.email(), senha: newPassword });

// Assistente de primeiro acesso: só as RESPOSTAS vêm do front; o conteúdo
// (etapas, etiquetas, textos) é montado no servidor a partir do modelo.
export const nicheSetupSchema = z.strictObject({
  niche: z.enum(NICHE_KEYS),
  answers: z
    .record(z.string().regex(/^[a-z_]{1,30}$/), z.union([z.string().max(600), z.array(z.string().max(40)).max(20)]))
    .refine((o) => Object.keys(o).length <= 20, "Respostas demais"),
  include: z.array(z.enum(SETUP_GROUPS)).max(SETUP_GROUPS.length),
});

export const contactFieldSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
});
