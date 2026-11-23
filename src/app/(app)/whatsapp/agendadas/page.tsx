import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { can, getTenantContext } from "@/server/context";
import { listScheduledMessages } from "@/server/data/whatsapp-media";
import { listWhatsappNumbers } from "@/server/data/whatsapp";
import { PageHeader } from "@/components/page-header";
import { ScheduledList } from "@/components/scheduled-list";
import { cancelScheduledAction } from "../../actions";

export const metadata = { title: "Mensagens agendadas" };

/** Todas as mensagens de WhatsApp agendadas da empresa, em um só lugar. */
export default async function AgendadasPage() {
  const ctx = await getTenantContext();
  if (!can(ctx, "whatsapp.ver")) redirect("/dashboard");
  const [items, numbers] = await Promise.all([listScheduledMessages(ctx), listWhatsappNumbers(ctx)]);
  const label = new Map(numbers.map((n) => [n.id, n.label]));
  const primary = numbers.find((n) => n.is_primary)?.label ?? null;

  return (
    <div className="space-y-6">
      <Link href="/whatsapp" className="btn-ghost btn-sm"><ArrowLeft className="h-4 w-4" /> Conversas</Link>
      <PageHeader
        icon={CalendarClock}
        title="Mensagens agendadas"
        subtitle={`${items.length} mensagem(ns) esperando a data de envio. Para mudar o texto ou o horário, cancele e agende de novo.`}
      />
      <section className="card">
        <ScheduledList
          items={items.map((m) => ({ ...m, number_label: numbers.length > 1 ? (m.session_id ? label.get(m.session_id) : primary) ?? null : null }))}
          cancel={cancelScheduledAction}
          canCancel={can(ctx, "whatsapp.enviar")}
          empty="Nenhuma mensagem agendada. Para agendar, abra uma conversa e use o relógio ao lado do campo de mensagem."
        />
      </section>
    </div>
  );
}
