import type { NextRequest } from "next/server";
import { parseId, readJson, withPlatform } from "@/server/http";
import { platformSuspendSchema } from "@/server/validation";
import { setClientSuspended } from "@/server/platform";

export const POST = (req: NextRequest, route: { params: Promise<{ id: string }> }) =>
  withPlatform(async (r, p) => {
    const { id } = await route.params;
    const body = await readJson(r, platformSuspendSchema);
    await setClientSuspended(p, parseId(id), body.suspenso, body.motivo);
  })(req);
