import Link from "next/link";
import { getTenantContext } from "@/server/context";
import { getContact } from "@/server/data/contacts";
import {
  getWhatsappQr,
  getWhatsappSession,
  listConversations,
  listPendingOutbox,
  listThread,
} from "@/server/data/whatsapp";
import { idSchema } from "@/server/validation";
import { ExternalLink, Inbox, MessageCircle, MessageSquareText, Phone } from "lucide-react";
import { dateTime, phoneFmt } from "@/components/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ConnectionPanel } from "./connection-panel";
import { ChatThread } from "./chat-thread";
import { LiveRefresh } from "./live-refresh";

export const metadata = { title: "WhatsApp" };

export default async function WhatsappPage({ searchParams }: PageProps<"/whatsapp">) {
  const ctx = await getTenantContext();
  const sp = await searchParams;
  const selected = idSchema.safeParse(sp.contato).success ? (sp.contato as string) : null;

  const [session, qr, conversations] = await Promise.all([
    getWhatsappSession(ctx),
    getWhatsappQr(ctx),
    listConversations(ctx),
  ]);

  let contact = null;
  let thread: Awaited<ReturnType<typeof listThread>> = [];
  let pending: Awaited<ReturnType<typeof listPendingOutbox>> = [];
  if (selected) {
    try {
      contact = await getContact(ctx, selected);
      [thread, pending] = await Promise.all([listThread(ctx, selected), listPendingOutbox(ctx, selected)]);
    } catch {
      contact = null; // contato inexistente ou de outro tenant
    }
  }

  return (
    <div className="space-y-6">
      <LiveRefresh tenantId={ctx.tenantId} contactId={contact?.id ?? null} />
      <PageHeader icon={MessageCircle} title="WhatsApp" subtitle="Conecte o número da empresa e converse com os contatos em tempo real." />

      <ConnectionPanel
        isAdmin={ctx.role === "admin"}
        tenantId={ctx.tenantId}
        initial={{ status: session.status, phone: session.phone, last_error: session.last_error, qr }}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <aside className="card flex flex-col p-0 lg:col-span-1">
          <h2 className="section-title border-b border-line px-5 py-4">
            <MessageSquareText className="h-4 w-4 text-accent" /> Conversas
          </h2>
          <ul className="max-h-[34rem] flex-1 overflow-y-auto p-2">
            {conversations.map((c) => {
              const active = c.contact_id === contact?.id;
              return (
                <li key={c.contact_id}>
                  <Link
                    href={`/whatsapp?contato=${c.contact_id}`}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 transition ${active ? "bg-brand-500/15 shadow-[inset_0_0_0_1px_rgb(161_0_255/0.35)]" : "hover:bg-surface-2"}`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong text-xs font-semibold">
                      {c.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2">
                        <span className="truncate text-sm font-medium">{c.name}</span>
                        <span className="shrink-0 text-[11px] text-subtle">{dateTime(c.last_at)}</span>
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {c.last_direction === "saida" ? "Você: " : ""}
                        {c.last_body}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
            {conversations.length === 0 && (
              <li>
                <EmptyState icon={Inbox} title="Nenhuma conversa ainda" hint="As mensagens recebidas aparecem aqui automaticamente." />
              </li>
            )}
          </ul>
        </aside>

        <section className="card flex min-h-[34rem] flex-col overflow-hidden p-0 lg:col-span-2">
          {contact ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-semibold text-white">
                    {contact.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <Link href={`/contatos/${contact.id}`} className="font-semibold hover:text-accent-strong">
                      {contact.name}
                    </Link>
                    <p className="flex items-center gap-1 text-xs text-muted"><Phone className="h-3 w-3" /> {phoneFmt(contact.phone)}</p>
                  </div>
                </div>
                <Link href={`/contatos/${contact.id}`} className="btn-ghost btn-sm">
                  Ver contato <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </header>
              <ChatThread
                contactId={contact.id}
                canSend={session.status === "conectado" && !!contact.phone}
                messages={thread}
                pending={pending}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState icon={MessageCircle} title="Selecione uma conversa" hint="Ou abra um contato e clique em “Conversar no WhatsApp”." />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
