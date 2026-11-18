import { withTenant, readJson, parseId } from "@/server/http";
import { memberUpdateSchema } from "@/server/validation";
import { removeMember, updateMember } from "@/server/data/members";

type P = { id: string };
export const PATCH = withTenant<P>(async (req, ctx, { id }) => {
  await updateMember(ctx, parseId(id), await readJson(req, memberUpdateSchema));
});
export const DELETE = withTenant<P>(async (_req, ctx, { id }) => {
  await removeMember(ctx, parseId(id));
});
