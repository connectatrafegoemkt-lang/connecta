"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/server/context";
import { localToIso, parseOrThrow, pick, reaisToCents, toActionError, type ActionState } from "@/server/forms";
import {
  contactCreateSchema,
  contactMoveSchema,
  contactUpdateSchema,
  idSchema,
  interactionCreateSchema,
  memberInviteSchema,
  memberUpdateSchema,
  stageCreateSchema,
  stageReorderSchema,
  stageUpdateSchema,
  tagCreateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from "@/server/validation";
import { createContact, deleteContact, moveContact, updateContact } from "@/server/data/contacts";
import { createInteraction, deleteInteraction } from "@/server/data/interactions";
import { createTask, deleteTask, updateTask } from "@/server/data/tasks";
import { createStage, deleteStage, reorderStages, updateStage } from "@/server/data/stages";
import { createTag, deleteTag } from "@/server/data/tags";
import { inviteMember, removeMember, updateMember } from "@/server/data/members";

/*
 * Server Actions. Regras:
 * - o tenant SEMPRE vem de getTenantContext() (sessão);
 * - campos são extraídos com pick() (lista fechada) e validados por schemas
 *   estritos — tenant_id enviado no formulário é simplesmente ignorado.
 */

const CONTACT_FIELDS = ["name", "email", "phone", "company", "source", "notes", "stage_id", "tag_ids[]"];

function contactInput(fd: FormData) {
  const raw = pick(fd, CONTACT_FIELDS);
  const cents = reaisToCents(fd.get("value"));
  if (cents !== undefined) raw.value_cents = cents;
  if (raw.stage_id === "") raw.stage_id = null;
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

export async function inviteMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await inviteMember(ctx, parseOrThrow(memberInviteSchema, pick(fd, ["email", "password", "display_name", "role"])));
    revalidatePath("/configuracoes");
    return { ok: true, message: "Usuário criado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateMemberRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await updateMember(ctx, parseOrThrow(idSchema, fd.get("id")), parseOrThrow(memberUpdateSchema, pick(fd, ["role"])));
    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await getTenantContext();
    await removeMember(ctx, parseOrThrow(idSchema, fd.get("id")));
    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
