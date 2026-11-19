"use server";

import { revalidatePath } from "next/cache";
import { getPlatformContext, createClientTenant, deleteClientTenant, setClientSuspended } from "@/server/platform";
import { parseOrThrow, pick, toActionError, type ActionState } from "@/server/forms";
import { idSchema, platformTenantCreateSchema } from "@/server/validation";

export async function createClientTenantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const input = parseOrThrow(
      platformTenantCreateSchema,
      pick(fd, ["name", "slug", "admin_email", "admin_password", "admin_name"]),
    );
    await createClientTenant(p, input);
    revalidatePath("/plataforma");
    return { ok: true, message: `Cliente "${input.name}" criado. O administrador já pode entrar com o e-mail ${input.admin_email}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setClientSuspendedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const suspend = fd.get("acao") === "suspender";
    const reason = String(fd.get("motivo") ?? "").trim().slice(0, 300) || null;
    await setClientSuspended(p, id, suspend, reason);
    revalidatePath("/plataforma");
    return { ok: true, message: suspend ? "Cliente suspenso." : "Cliente reativado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteClientTenantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const confirm = String(fd.get("confirmacao") ?? "").trim().slice(0, 60);
    const r = await deleteClientTenant(p, id, confirm);
    revalidatePath("/plataforma");
    return { ok: true, message: `Cliente excluído (${r.deleted_users} login(s) e ${r.deleted_files} arquivo(s) apagados).` };
  } catch (e) {
    return toActionError(e);
  }
}
