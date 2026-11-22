import { redirect } from "next/navigation";
import { can, getTenantContext } from "@/server/context";
import { allowedGroups, getSetupState } from "@/server/data/onboarding";
import { LogoMark } from "@/components/logo";
import { NicheWizard } from "./wizard";

export const metadata = { title: "Configurar o CRM" };

/**
 * Assistente de primeiro acesso: o admin do cliente escolhe o nicho e
 * responde algumas perguntas; o CRM monta funil, etiquetas, mensagens
 * rápidas, setores, campos da ficha e instruções da IA.
 */
export default async function PrimeiroAcessoPage() {
  let ctx;
  try {
    ctx = await getTenantContext();
  } catch {
    redirect("/dashboard"); // o layout do app mostra login/suspenso/sem acesso
  }
  if (!can(ctx, "configuracoes.gerenciar")) redirect("/dashboard");
  const state = await getSetupState(ctx);

  return (
    <main className="min-h-screen bg-page px-4 py-8 md:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <LogoMark size={44} />
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-accent">CONNECTA CRM</p>
            <h1 className="text-xl font-semibold">Vamos deixar o CRM com a cara de {ctx.tenantName}</h1>
          </div>
        </div>
        <NicheWizard
          companyName={ctx.tenantName}
          initialNiche={state.niche}
          allowed={allowedGroups(ctx)}
          firstTime={!state.onboardedAt}
        />
      </div>
    </main>
  );
}
