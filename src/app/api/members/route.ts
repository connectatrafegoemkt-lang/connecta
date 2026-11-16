import { withTenant, readJson } from "@/server/http";
import { memberInviteSchema } from "@/server/validation";
import { inviteMember, listMembers } from "@/server/data/members";

export const GET = withTenant(async (_req, ctx) => listMembers(ctx));
export const POST = withTenant(async (req, ctx) =>
  Response.json(await inviteMember(ctx, await readJson(req, memberInviteSchema)), { status: 201 }),
);
