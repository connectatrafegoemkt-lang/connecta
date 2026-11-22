"use server";

import { revalidatePath } from "next/cache";
import { getPlatformContext, createClientTenant, deleteClientTenant, setClientSuspended } from "@/server/platform";
import { parseOrThrow, pick, toActionError, type ActionState } from "@/server/forms";
import { idSchema, platformPasswordResetSchema, platformTenantCreateSchema } from "@/server/validation";
import { resetClientUserPassword } from "@/server/account";

export async function createClientTenantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const input = parseOrThrow(
      platformTenantCreateSchema,
      pick(fd, ["name", "slug", "admin_email", "admin_password", "admin_name"]),
    );
    await createClientTenant(p, input);
    revalidatePath("/plataforma");
    return { ok: true, message: `Cliente "${input.name}" criado. O administrador entra com o e-mail ${input.admin_email} e a senha provisória, e cria a senha pessoal no primeiro acesso.` };
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

export async function resetClientPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const p = await getPlatformContext();
    const id = parseOrThrow(idSchema, fd.get("id"));
    const input = parseOrThrow(platformPasswordResetSchema, pick(fd, ["email", "senha"]));
    await resetClientUserPassword(p, id, input.email, input.senha);
    return { ok: true, message: `Senha provisória definida para ${input.email}. A troca será pedida no próximo acesso.` };
  } catch (e) {
    return toActionError(e);
  }
}
