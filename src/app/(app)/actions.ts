"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTenantContext, requirePerm } from "@/server/context";
import { localToIso, parseOrThrow, pick, reaisToCents, toActionError, type ActionState } from "@/server/forms";
import {
  contactCreateSchema,
  contactMoveSchema,
  contactUpdateSchema,
  idSchema,
  interactionCreateSchema,
  memberInviteSchema,
  memberUpdateSchema,
  departmentSchema,
  stageCreateSchema,
  stageReorderSchema,
  stageUpdateSchema,
  tagCreateSchema,
  taskCreateSchema,
  taskUpdateSchema,
  whatsappSendSchema,
  quickReplySchema,
  passwordResetSchema,
  contactFieldSchema,
  nicheSetupSchema,
} from "@/server/validation";
import { resetMemberPassword } from "@/server/account";
import { createContactField, deleteContactField } from "@/server/data/contact-fields";
import { applyNicheSetup, skipNicheSetup } from "@/server/data/onboarding";
import { createContact, deleteContact, moveContact, updateContact } from "@/server/data/contacts";
import { createInteraction, deleteInteraction } from "@/server/data/interactions";
import { createTask, deleteTask, updateTask } from "@/server/data/tasks";
import { createStage, deleteStage, reorderStages, updateStage } from "@/server/data/stages";
import { createTag, deleteTag, setPaidTrafficTags } from "@/server/data/tags";
import { inviteMember, removeMember, updateMember } from "@/server/data/members";
import { createDepartment, deleteDepartment } from "@/server/data/departments";
import { queueWhatsappMessage, requestWhatsapp } from "@/server/data/whatsapp";
import { cancelScheduled, createQuickReply, deleteQuickReply, queueTextMessage } from "@/server/data/whatsapp-media";
import { saveAiSettings, setContactAi, setSuggestionStatus, testAiReply } from "@/server/data/ai";

/*
 * Server Actions. Regras:
 * - o tenant SEMPRE vem de getTenantContext() (sessão);
 * - campos são extraídos com pick() (lista fechada) e validados por schemas
 *   estritos — tenant_id enviado no formulário é simplesmente ignorado.
 */

const CONTACT_FIELDS = ["name", "email", "phone", "company", "source", "notes", "stage_id", "department_id", "tag_ids[]"];

function contactInput(fd: FormData) {
  const raw = pick(fd, CONTACT_FIELDS);
  const cents = reaisToCents(fd.get("value"));
  if (cents !== undefined) raw.value_cents = cents;
  if (raw.stage_id === "") raw.stage_id = null;
  if (raw.department_id === "") raw.department_id = null;
  // Campos extras da ficha: inputs "cf.<chave>" (validados contra contact_fields no servidor)
  const custom: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("cf.") && typeof v === "string") custom[k.slice(3)] = v;
  }
  if (Object.keys(custom).length) raw.custom_fields = custom;
  return raw;
}

export async function createContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await getTenantContext();
    const c = await createContact(ctx, parseOrThrow(contactCreateSchema, contactInput(fd)));
    id = c.id;
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/contatos");
  redirect(`/contatos/${id}`);
}

export async function updateContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const input = contactInput(fd);
    if (!fd.has("tag_ids[]") && fd.get("tags_present") === "1") input.tag_ids = [];
    await updateContact(ctx, id, parseOrThrow(contactUpdateSchema, input));
    revalidatePath(`/contatos/${id}`);
    return { ok: true, message: "Contato salvo." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteContactAction(fd: FormData) {
  const ctx = await getTenantContext();
  await deleteContact(ctx, parseOrThrow(idSchema, fd.get("id")));
  revalidatePath("/contatos");
  redirect("/contatos");
}

export async function moveContactAction(id: string, stageId: string, position: number): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    const input = parseOrThrow(contactMoveSchema, { stage_id: stageId, position });
    await moveContact(ctx, parseOrThrow(idSchema, id), input.stage_id, input.position);
    revalidatePath("/funil");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createInteractionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    const raw = pick(fd, ["contact_id", "type", "direction", "body"]);
    const occurred = localToIso(fd.get("occurred_at"));
    if (occurred) raw.occurred_at = occurred;
    const input = parseOrThrow(interactionCreateSchema, raw);
    await createInteraction(ctx, input);
    revalidatePath(`/contatos/${input.contact_id}`);
    return { ok: true, message: "Interação registrada." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteInteractionAction(fd: FormData) {
  const ctx = await getTenantContext();
  await deleteInteraction(ctx, parseOrThrow(idSchema, fd.get("id")));
  revalidatePath(`/contatos/${String(fd.get("contact_id"))}`);
}

function taskInput(fd: FormData) {
  const raw = pick(fd, ["title", "description", "contact_id", "assigned_to"]);
  for (const k of ["contact_id", "assigned_to"]) if (raw[k] === "") raw[k] = null;
  if (fd.has("due_at")) raw.due_at = localToIso(fd.get("due_at"));
  if (fd.has("remind_at")) raw.remind_at = localToIso(fd.get("remind_at"));
  return raw;
}

export async function createTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await createTask(ctx, parseOrThrow(taskCreateSchema, taskInput(fd)));
    revalidatePath("/tarefas");
    if (fd.get("contact_id")) revalidatePath(`/contatos/${String(fd.get("contact_id"))}`);
    return { ok: true, message: "Tarefa criada." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setTaskStatusAction(fd: FormData) {
  const ctx = await getTenantContext();
  const id = parseOrThrow(idSchema, fd.get("id"));
  const { status } = parseOrThrow(taskUpdateSchema, { status: fd.get("status") });
  await updateTask(ctx, id, { status });
  revalidatePath("/tarefas");
  revalidatePath("/dashboard");
}

export async function deleteTaskAction(fd: FormData) {
  const ctx = await getTenantContext();
  await deleteTask(ctx, parseOrThrow(idSchema, fd.get("id")));
  revalidatePath("/tarefas");
}

export async function createStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await createStage(ctx, parseOrThrow(stageCreateSchema, pick(fd, ["name", "color"])));
    revalidatePath("/configuracoes");
    revalidatePath("/funil");
    return { ok: true, message: "Etapa criada." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const raw: Record<string, unknown> = pick(fd, ["name", "color"]);
    raw.is_won = fd.get("kind") === "won";
    raw.is_lost = fd.get("kind") === "lost";
    await updateStage(ctx, id, parseOrThrow(stageUpdateSchema, raw));
    revalidatePath("/configuracoes");
    revalidatePath("/funil");
    return { ok: true, message: "Etapa salva." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reorderStagesAction(ids: string[]): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await reorderStages(ctx, parseOrThrow(stageReorderSchema, { ids }).ids);
    revalidatePath("/configuracoes");
    revalidatePath("/funil");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteStageAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await deleteStage(ctx, parseOrThrow(idSchema, fd.get("id")));
    revalidatePath("/configuracoes");
    revalidatePath("/funil");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createTagAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await createTag(ctx, parseOrThrow(tagCreateSchema, pick(fd, ["name", "color"])));
    revalidatePath("/configuracoes");
    return { ok: true, message: "Tag criada." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteTagAction(fd: FormData) {
  const ctx = await getTenantContext();
  await deleteTag(ctx, parseOrThrow(idSchema, fd.get("id")));
  revalidatePath("/configuracoes");
}

const MEMBER_FIELDS = ["display_name", "profile", "permissions[]", "department_ids[]"];

export async function inviteMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await inviteMember(ctx, parseOrThrow(memberInviteSchema, pick(fd, ["email", "password", ...MEMBER_FIELDS])));
    revalidatePath("/equipe");
    return { ok: true, message: "Usuário criado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await updateMember(ctx, parseOrThrow(idSchema, fd.get("id")), parseOrThrow(memberUpdateSchema, pick(fd, MEMBER_FIELDS)));
    revalidatePath("/equipe");
    return { ok: true, message: "Acessos salvos." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await removeMember(ctx, parseOrThrow(idSchema, fd.get("id")));
    revalidatePath("/equipe");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetMemberPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const { senha } = parseOrThrow(passwordResetSchema, pick(fd, ["senha"]));
    await resetMemberPassword(ctx, id, senha);
    return { ok: true, message: "Senha provisória definida. A pessoa vai criar a senha dela no próximo acesso." };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- Setores

export async function createDepartmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await createDepartment(ctx, parseOrThrow(departmentSchema, pick(fd, ["name", "color"])));
    revalidatePath("/equipe");
    return { ok: true, message: "Setor criado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteDepartmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await deleteDepartment(ctx, parseOrThrow(idSchema, fd.get("id")));
    revalidatePath("/equipe");
    revalidatePath("/contatos");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------- WhatsApp

export async function whatsappConnectAction(): Promise<ActionState> {
  try {
    await requestWhatsapp(await getTenantContext(), "conectar");
    revalidatePath("/whatsapp");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/** "Gerar novo QR code": recomeça o pareamento do zero. */
export async function whatsappResetAction(): Promise<ActionState> {
  try {
    await requestWhatsapp(await getTenantContext(), "reiniciar");
    revalidatePath("/whatsapp");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function whatsappDisconnectAction(): Promise<ActionState> {
  try {
    await requestWhatsapp(await getTenantContext(), "desconectar");
    revalidatePath("/whatsapp");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function whatsappSendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    const { contact_id, body } = parseOrThrow(whatsappSendSchema, pick(fd, ["contact_id", "body"]));
    const scheduled = localToIso(fd.get("scheduled_at"));
    if (scheduled) await queueTextMessage(ctx, contact_id, body, scheduled);
    else await queueWhatsappMessage(ctx, contact_id, body);
    revalidatePath("/whatsapp");
    return { ok: true, message: scheduled ? "Mensagem agendada." : null };
  } catch (e) {
    return toActionError(e);
  }
}

// ------------------------------------------------------- Atendimento por IA
export async function saveAiSettingsAction(input: unknown): Promise<ActionState> {
  try {
    await saveAiSettings(await getTenantContext(), input);
    revalidatePath("/atendimento-ia");
    return { ok: true, message: "Configuração salva." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function testAiAction(
  settings: unknown,
  history: { direction: "entrada" | "saida"; body: string }[],
): Promise<ActionState & { reply?: string; handoff?: boolean; reason?: string }> {
  try {
    const safe = (Array.isArray(history) ? history : [])
      .slice(-20)
      .map((h) => ({ direction: h?.direction === "saida" ? ("saida" as const) : ("entrada" as const), body: String(h?.body ?? "").slice(0, 2000) }));
    const r = await testAiReply(await getTenantContext(), settings, safe);
    return { ok: true, ...r };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setContactAiAction(contactId: string, active: boolean): Promise<ActionState> {
  try {
    await setContactAi(await getTenantContext(), parseOrThrow(idSchema, contactId), active);
    revalidatePath("/whatsapp");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setSuggestionStatusAction(id: string, status: "usada" | "descartada"): Promise<ActionState> {
  try {
    await setSuggestionStatus(await getTenantContext(), parseOrThrow(idSchema, id), status === "usada" ? "usada" : "descartada");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ------------------------------------------- WhatsApp: agendamentos, rápidas, etiquetas
export async function cancelScheduledAction(id: string): Promise<ActionState> {
  try {
    await cancelScheduled(await getTenantContext(), parseOrThrow(idSchema, id));
    revalidatePath("/whatsapp");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createQuickReplyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await createQuickReply(await getTenantContext(), parseOrThrow(quickReplySchema, pick(fd, ["shortcut", "title", "body"])));
    revalidatePath("/configuracoes");
    revalidatePath("/whatsapp");
    return { ok: true, message: "Mensagem rápida criada." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteQuickReplyAction(fd: FormData) {
  await deleteQuickReply(await getTenantContext(), parseOrThrow(idSchema, fd.get("id")));
  revalidatePath("/configuracoes");
}

export async function setContactTagsAction(contactId: string, tagIds: string[]): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    const input = parseOrThrow(contactUpdateSchema, { tag_ids: Array.isArray(tagIds) ? tagIds : [] });
    await updateContact(ctx, parseOrThrow(idSchema, contactId), input);
    revalidatePath("/whatsapp");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Campos extras da ficha do lead
// ---------------------------------------------------------------------------

export async function createContactFieldAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    const raw: Record<string, unknown> = pick(fd, ["label", "type"]);
    const opts = String(fd.get("options") ?? "");
    if (raw.type === "opcoes") raw.options = opts.split(/[,;\n]/).map((o) => o.trim()).filter(Boolean);
    await createContactField(ctx, parseOrThrow(contactFieldSchema, raw));
    revalidatePath("/configuracoes");
    return { ok: true, message: "Campo criado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteContactFieldAction(fd: FormData) {
  const ctx = await getTenantContext();
  await deleteContactField(ctx, parseOrThrow(idSchema, fd.get("id")));
  revalidatePath("/configuracoes");
}

// ---------------------------------------------------------------------------
// Assistente de primeiro acesso (nicho)
// ---------------------------------------------------------------------------

export async function applyNicheSetupAction(input: unknown): Promise<ActionState & { result?: Record<string, number | boolean> }> {
  try {
    const ctx = await getTenantContext();
    const result = await applyNicheSetup(ctx, parseOrThrow(nicheSetupSchema, input));
    revalidatePath("/", "layout");
    return { ok: true, result };
  } catch (e) {
    return toActionError(e);
  }
}

export async function skipNicheSetupAction(): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await skipNicheSetup(ctx);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setPaidTrafficTagsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    requirePerm(ctx, "configuracoes.gerenciar");
    const ids = fd.getAll("paid[]").map(String).filter(Boolean).slice(0, 200);
    await setPaidTrafficTags(ctx, ids.map((id) => parseOrThrow(idSchema, id)));
    revalidatePath("/configuracoes");
    return { ok: true, message: "Etiquetas de tráfego pago salvas." };
  } catch (e) {
    return toActionError(e);
  }
}
