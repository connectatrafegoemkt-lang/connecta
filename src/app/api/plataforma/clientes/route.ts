import { readJson, withPlatform } from "@/server/http";
import { platformTenantCreateSchema } from "@/server/validation";
import { createClientTenant, listClientTenants } from "@/server/platform";

export const GET = withPlatform(async (_req, p) => listClientTenants(p));
export const POST = withPlatform(async (req, p) =>
  Response.json(await createClientTenant(p, await readJson(req, platformTenantCreateSchema)), { status: 201 }),
);
