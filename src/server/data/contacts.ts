import "server-only";
import { can, type TenantContext } from "../context";
import { badRequest, fromDbError, notFound } from "../errors";
import type { ContactCreate, ContactUpdate } from "../validation";
import { sanitizeCustomFields } from "@/shared/custom-fields";
import { listContactFields } from "./contact-fields";

export interface Contact {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  notes: string | null;
  value_cents: number;
  stage_id: string | null;
  stage_position: number;
  owner_id: string | null;
  department_id: string | null;
  last_interaction_at: string | null;
  ai_paused_until?: string | null;
  ai_enabled?: boolean;
  avatar_path?: string | null;
  whatsapp_name?: string | null;
  whatsapp_about?: string | null;
  custom_fields?: Record<string, unknown>;
  /** Preenchido pelo worker quando o lead veio de anúncio (Click-to-WhatsApp). */
  ad_source?: { title?: string | null; source_url?: string | null; source_id?: string | null } | null;
  ad_at?: string | null;
  created_at: string;
  updated_at: string;
  tags?: { id: string; name: string; color: string }[];
}

const COLUMNS =
  "id, tenant_id, name, email, phone, company, source, notes, value_cents, stage_id, stage_position, owner_id, department_id, last_interaction_at, ai_enabled, ai_paused_until, avatar_path, whatsapp_name, whatsapp_about, custom_fields, ad_source, ad_at, created_at, updated_at";
const WITH_TAGS = `${COLUMNS}, contact_tags(tags(id, name, color))`;

type RawContact = Contact & { contact_tags?: { tags: { id: string; name: string; color: string } | null }[] };

function mapTags(row: RawContact): Contact {
  const { contact_tags, ...rest } = row;
  return { ...rest, tags: (contact_tags ?? []).map((ct) => ct.tags).filter((t) => t !== null) };
}

export async function listContacts(
  ctx: TenantContext,
  opts: { q?: string; stage_id?: string; tag_id?: string; department_id?: string; limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let query = ctx.db
    .select("contacts", opts.tag_id ? `${WITH_TAGS}, filter_tags:contact_tags!inner(tag_id)` : WITH_TAGS, {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (opts.q) {
    const q = opts.q.replace(/[%,()*\\]/g, " ");
    query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,company.ilike.%${q}%`);
  }
  if (opts.stage_id) query = query.eq("stage_id", opts.stage_id);
  if (opts.tag_id) query = query.eq("filter_tags.tag_id", opts.tag_id);
  if (opts.department_id) query = query.eq("department_id", opts.department_id);
  const { data, error, count } = await query;
  if (error) throw fromDbError(error);
  return { items: (data as unknown as RawContact[]).map(mapTags), total: count ?? 0 };
}

export async function listContactsForBoard(ctx: TenantContext) {
  const { data, error } = await ctx.db
    .select("contacts", WITH_TAGS)
    .order("stage_position", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw fromDbError(error);
  return (data as unknown as RawContact[]).map(mapTags);
}

export async function getContact(ctx: TenantContext, id: string): Promise<Contact> {
  const { data, error } = await ctx.db.select("contacts", WITH_TAGS).eq("id", id).maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) throw notFound("Contato não encontrado");
  return mapTags(data as unknown as RawContact);
}

async function replaceTags(ctx: TenantContext, contactId: string, tagIds: string[]) {
  const del = await ctx.db.delete("contact_tags").eq("contact_id", contactId);
  if (del.error) throw fromDbError(del.error);
  if (tagIds.length === 0) return;
  const ins = await ctx.db.insert(
    "contact_tags",
    [...new Set(tagIds)].map((tag_id) => ({ contact_id: contactId, tag_id })),
  );
  if (ins.error) throw fromDbError(ins.error);
}

/** Garante que todas as tags pertencem ao tenant da sessão. */
async function assertOwnTags(ctx: TenantContext, tagIds: string[] | undefined) {
  if (!tagIds?.length) return;
  const unique = [...new Set(tagIds)];
  const { count, error } = await ctx.db.select("tags", "id", { count: "exact", head: true }).in("id", unique);
  if (error) throw fromDbError(error);
  if (count !== unique.length) throw badRequest("Tag inválida");
}

/** Valida os campos extras contra os definidos pelo tenant (contact_fields). */
async function customFieldsFor(ctx: TenantContext, input: Record<string, unknown>, current: Record<string, unknown> = {}) {
  const defs = await listContactFields(ctx);
  const { values, errors } = sanitizeCustomFields(defs, input, current);
  if (errors.length) throw badRequest(errors.join("; "));
  return values;
}

export async function createContact(ctx: TenantContext, input: ContactCreate): Promise<Contact> {
  const { tag_ids, custom_fields, ...rest } = input;
  const fields: Record<string, unknown> & typeof rest = { ...rest };
  await assertOwnTags(ctx, tag_ids);
  if (custom_fields) fields.custom_fields = await customFieldsFor(ctx, custom_fields);
  // Quem só enxerga os próprios setores cria o contato no seu (primeiro) setor,
  // senão o contato ficaria "sem setor" e visível a todos.
  if (fields.department_id === undefined && !can(ctx, "setores.todos") && ctx.departmentIds.length) {
    fields.department_id = ctx.departmentIds[0];
  }
  if (!fields.stage_id) {
    const first = await ctx.db.select("pipeline_stages", "id").order("position").limit(1).maybeSingle();
    if (first.data) fields.stage_id = (first.data as unknown as { id: string }).id;
  }
  const { data, error } = await ctx.db.insert("contacts", fields).select("id").single();
  if (error) throw fromDbError(error);
  const id = (data as { id: string }).id;
  if (tag_ids?.length) await replaceTags(ctx, id, tag_ids);
  return getContact(ctx, id);
}

export async function updateContact(ctx: TenantContext, id: string, input: ContactUpdate): Promise<Contact> {
  const { tag_ids, custom_fields, ...rest } = input;
  const fields: Record<string, unknown> & typeof rest = { ...rest };
  await assertOwnTags(ctx, tag_ids);
  if (custom_fields) {
    const current = await getContact(ctx, id);
    fields.custom_fields = await customFieldsFor(ctx, custom_fields, current.custom_fields ?? {});
  }
  if (Object.keys(fields).length > 0) {
    const { data, error } = await ctx.db.update("contacts", fields).eq("id", id).select("id");
    if (error) throw fromDbError(error);
    if (!data?.length) throw notFound("Contato não encontrado");
  } else {
    await getContact(ctx, id); // garante que existe no tenant
  }
  if (tag_ids) await replaceTags(ctx, id, tag_ids);
  return getContact(ctx, id);
}

export async function moveContact(ctx: TenantContext, id: string, stageId: string, position: number) {
  const { data, error } = await ctx.db
    .update("contacts", { stage_id: stageId, stage_position: position })
    .eq("id", id)
    .select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Contato não encontrado");
}

export async function deleteContact(ctx: TenantContext, id: string) {
  const { data, error } = await ctx.db.delete("contacts").eq("id", id).select("id");
  if (error) throw fromDbError(error);
  if (!data?.length) throw notFound("Contato não encontrado");
}

/** Variantes do telefone brasileiro com e sem o 9º dígito. */
function phoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  const out = new Set([d]);
  const br = /^55(\d{2})(\d{8,9})$/.exec(d);
  if (br) {
    const [, ddd, num] = br;
    if (num!.length === 9 && num!.startsWith("9")) out.add(`55${ddd}${num!.slice(1)}`);
    if (num!.length === 8 && /^[6-9]/.test(num!)) out.add(`55${ddd}9${num}`);
  }
  return [...out];
}

/**
 * Acha o contato pelo telefone NO TENANT DA SESSÃO ou cria um novo.
 * Usado pela prospecção da CONNECTA para conversar pelo WhatsApp da própria
 * empresa (o contato fica no tenant de quem está logado, com RLS).
 */
export async function findOrCreateContactByPhone(
  ctx: TenantContext,
  input: { name: string; phone: string; company?: string | null; source?: string | null },
): Promise<string> {
  const { data, error } = await ctx.db
    .select("contacts", "id")
    .in("phone", phoneVariants(input.phone))
    .order("created_at")
    .limit(1);
  if (error) throw fromDbError(error);
  const found = (data as unknown as { id: string }[] | null)?.[0];
  if (found) return found.id;
  const c = await createContact(ctx, {
    name: input.name.slice(0, 200),
    phone: input.phone,
    company: input.company ?? null,
    source: input.source ?? null,
  });
  return c.id;
}
