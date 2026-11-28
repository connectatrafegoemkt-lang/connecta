import { withTenant } from "@/server/http";
import { getAlerts } from "@/server/data/alerts";

/** Situação do WhatsApp + última mensagem recebida (avisos e som de notificação). */
export const GET = withTenant(async (_req, ctx) => getAlerts(ctx));
