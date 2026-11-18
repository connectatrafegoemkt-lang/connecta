import { withTenant, readJson, parseId } from "@/server/http";
import { departmentSchema } from "@/server/validation";
import { deleteDepartment, updateDepartment } from "@/server/data/departments";

type P = { id: string };
export const PATCH = withTenant<P>(async (req, ctx, { id }) => {
  await updateDepartment(ctx, parseId(id), await readJson(req, departmentSchema.partial()));
});
export const DELETE = withTenant<P>(async (_req, ctx, { id }) => {
  await deleteDepartment(ctx, parseId(id));
});
