import { Bot } from "lucide-react";
import { getTenantContext } from "@/server/context";
import { aiUsageSummary, getAiSettings } from "@/server/data/ai";
import { PageHeader } from "@/components/page-header";
import { AiSettingsForm } from "./ai-settings-form";

export const metadata = { title: "Atendimento IA" };

export default async function AtendimentoIaPage() {
  const ctx = await getTenantContext();
  const isAdmin = ctx.role === "admin";
  const [settings, usage] = await Promise.all([getAiSettings(ctx), isAdmin ? aiUsageSummary(ctx) : Promise.resolve(null)]);
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bot}
        title="Atendimento por IA"
        subtitle="Configure um atendente virtual que conhece o seu negócio e conversa com os clientes no WhatsApp."
      />
      <AiSettingsForm
        initial={settings}
        isAdmin={isAdmin}
        usage={usage}
        aiAvailable={Boolean(process.env.OPENAI_API_KEY)}
      />
    </div>
  );
}
