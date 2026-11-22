import "server-only";
import { can, requirePerm, type TenantContext } from "../context";
import { fromDbError } from "../errors";
import { buildNicheSetup, isNicheKey, type Answers, type NicheKey, type SetupGroup } from "@/shared/niches";

export interface SetupState {
  niche: NicheKey | null;
  onboardedAt: string | null;
}

/** Nicho e situação do assistente de primeiro acesso do tenant da sessão. */
export async function getSetupState(ctx: TenantContext): Promise<SetupState> {
  // tenants é a linha do próprio tenant (RLS: id = current_tenant_id()).
  const { data, error } = await ctx.supabase
    .from("tenants")
    .select("niche, onboarded_at")
    .eq("id", ctx.tenantId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  const row = (data ?? {}) as { niche?: string | null; onboarded_at?: string | null };
  return { niche: isNicheKey(row.niche) ? row.niche : null, onboardedAt: row.onboarded_at ?? null };
}

/** Grupos que o usuário pode aplicar, de acordo com as permissões dele. */
export function allowedGroups(ctx: TenantContext): SetupGroup[] {
  const groups: SetupGroup[] = ["stages", "tags", "quick_replies", "contact_fields"];
  if (can(ctx, "equipe.gerenciar")) groups.push("departments");
  if (can(ctx, "ia.configurar")) groups.push("ai");
  return groups;
}

/**
 * Aplica o modelo do nicho. O conteúdo é montado AQUI a partir das respostas
 * (nunca vem pronto do front) e gravado numa transação pelo banco, com RLS.
 */
export async function applyNicheSetup(
  ctx: TenantContext,
  input: { niche: NicheKey; answers: Answers; include: SetupGroup[] },
) {
  requirePerm(ctx, "configuracoes.gerenciar");
  const allowed = new Set(allowedGroups(ctx));
  const include = input.include.filter((g) => allowed.has(g));
  const setup = buildNicheSetup(input.niche, input.answers, ctx.tenantName, include);
  const { data, error } = await ctx.db.rpc("apply_niche_setup", { p_niche: input.niche, p_setup: setup as Record<string, unknown> });
  if (error) throw fromDbError(error);
  return data as Record<string, number | boolean>;
}

/** "Pular por enquanto": marca como configurado sem criar nada. */
export async function skipNicheSetup(ctx: TenantContext) {
  requirePerm(ctx, "configuracoes.gerenciar");
  const { error } = await ctx.db.rpc("apply_niche_setup", { p_niche: null, p_setup: {} });
  if (error) throw fromDbError(error);
}
