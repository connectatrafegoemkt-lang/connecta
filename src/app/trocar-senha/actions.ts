"use server";

import { redirect } from "next/navigation";
import { changeOwnPassword } from "@/server/account";
import { parseOrThrow, pick, toActionError, type ActionState } from "@/server/forms";
import { passwordChangeSchema } from "@/server/validation";

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const input = parseOrThrow(passwordChangeSchema, pick(fd, ["senha", "confirmacao"]));
    await changeOwnPassword(input.senha);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/dashboard");
}
