import { withTenant, readJson, parseId } from "@/server/http";
import { contactUpdateSchema } from "@/server/validation";
import { deleteContact, getContact, updateContact } from "@/server/data/contacts";

type P = { id: string };

export const GET = withTenant<P>(async (_req, ctx, { id }) => getContact(ctx, parseId(id)));

export const PATCH = withTenant<P>(async (req, ctx, { id }) =>
  updateContact(ctx, parseId(id), await readJson(req, contactUpdateSchema)),
);

export const DELETE = withTenant<P>(async (_req, ctx, { id }) => {
  await deleteContact(ctx, parseId(id));
});
