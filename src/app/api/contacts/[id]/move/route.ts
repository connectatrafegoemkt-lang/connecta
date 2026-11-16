import { withTenant, readJson, parseId } from "@/server/http";
import { contactMoveSchema } from "@/server/validation";
import { moveContact } from "@/server/data/contacts";

export const POST = withTenant<{ id: string }>(async (req, ctx, { id }) => {
  const { stage_id, position } = await readJson(req, contactMoveSchema);
  await moveContact(ctx, parseId(id), stage_id, position);
});
