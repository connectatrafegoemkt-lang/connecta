import { getTenantContext } from "@/server/context";
import { listContactsForBoard } from "@/server/data/contacts";
import { listStages } from "@/server/data/stages";
import { KanbanBoard } from "./kanban-board";

export const metadata = { title: "Funil — CONNECTA CRM" };

export default async function FunilPage() {
  const ctx = await getTenantContext();
  const [stages, contacts] = await Promise.all([listStages(ctx), listContactsForBoard(ctx)]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Funil</h1>
        <p className="text-sm text-slate-500">Arraste os cards entre as etapas. Edite as etapas em Configurações.</p>
      </div>
      <KanbanBoard
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
