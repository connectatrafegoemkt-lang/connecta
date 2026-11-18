import { redirect } from "next/navigation";
import { can, getTenantContext } from "@/server/context";
import { listContactsForBoard } from "@/server/data/contacts";
import { listStages } from "@/server/data/stages";
import { SquareKanban } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KanbanBoard } from "./kanban-board";

export const metadata = { title: "Funil" };

export default async function FunilPage() {
  const ctx = await getTenantContext();
  if (!can(ctx, "contatos.ver")) redirect("/dashboard");
  const [stages, contacts] = await Promise.all([listStages(ctx), listContactsForBoard(ctx)]);
  return (
    <div className="space-y-6">
      <PageHeader icon={SquareKanban} title="Funil de vendas" subtitle="Arraste os cards entre as etapas. As etapas são editadas em Configurações." />
      <KanbanBoard
        readOnly={!can(ctx, "contatos.editar")}
        stages={stages}
        contacts={contacts.map((c) => ({
          id: c.id,
          name: c.name,
          company: c.company,
          value_cents: c.value_cents,
          stage_id: c.stage_id,
          stage_position: c.stage_position,
          tags: c.tags ?? [],
        }))}
      />
    </div>
  );
}
