import type { NextRequest } from "next/server";
import { parseId, readJson, withPlatform } from "@/server/http";
import { platformDeleteSchema } from "@/server/validation";
import { deleteClientTenant } from "@/server/platform";

/** Exclui definitivamente um cliente (só equipe CONNECTA; travas no banco). */
export const DELETE = (req: NextRequest, route: { params: Promise<{ id: string }> }) =>
  withPlatform(async (r, p) => {
    const { id } = await route.params;
    const body = await readJson(r, platformDeleteSchema);
    return deleteClientTenant(p, parseId(id), body.confirmacao);
  })(req);
