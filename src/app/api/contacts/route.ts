import { withTenant, readJson, readQuery } from "@/server/http";
import { contactCreateSchema, contactListQuerySchema } from "@/server/validation";
import { createContact, listContacts } from "@/server/data/contacts";

export const GET = withTenant(async (req, ctx) => listContacts(ctx, readQuery(req, contactListQuerySchema)));

export const POST = withTenant(async (req, ctx) => {
  const input = await readJson(req, contactCreateSchema);
  return Response.json(await createContact(ctx, input), { status: 201 });
});
