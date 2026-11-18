import { withTenant, readJson } from "@/server/http";
import { aiSettingsSchema } from "@/shared/ai/settings";
import { getAiSettings, saveAiSettings } from "@/server/data/ai";

export const GET = withTenant(async (_req, ctx) => getAiSettings(ctx));
export const PUT = withTenant(async (req, ctx) => saveAiSettings(ctx, await readJson(req, aiSettingsSchema)));
