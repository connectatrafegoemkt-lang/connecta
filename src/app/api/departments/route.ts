import { withTenant, readJson } from "@/server/http";
import { departmentSchema } from "@/server/validation";
import { createDepartment, listDepartments } from "@/server/data/departments";

export const GET = withTenant(async (_req, ctx) => listDepartments(ctx));
export const POST = withTenant(async (req, ctx) =>
  Response.json(await createDepartment(ctx, await readJson(req, departmentSchema)), { status: 201 }),
);
