import "server-only";
import { createUserClient } from "./supabase/user-client";

export async function signOut() {
  const sb = await createUserClient();
  await sb.auth.signOut();
}
