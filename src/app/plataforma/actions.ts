"use server";

import { revalidatePath } from "next/cache";
import { getPlatformContext, createClientTenant } from "@/server/platform";
import { parseOrThrow, pick, toActionError, type ActionState } from "@/server/forms";
import { platformTenantCreateSchema } from "@/server/validation";

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
