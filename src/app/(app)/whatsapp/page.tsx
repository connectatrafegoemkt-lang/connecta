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
import { dateTime, phoneFmt } from "@/components/format";
import { ConnectionPanel } from "./connection-panel";
import { ChatThread } from "./chat-thread";
import { LiveRefresh } from "./live-refresh";

export const metadata = { title: "WhatsApp — CONNECTA CRM" };

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
      <h1 className="text-2xl font-semibold">WhatsApp</h1>

      <ConnectionPanel
        isAdmin={ctx.role === "admin"}
        tenantId={ctx.tenantId}
        initial={{ status: session.status, phone: session.phone, last_error: session.last_error, qr }}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <aside className="card p-0 lg:col-span-1">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Conversas</h2>
          <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto">
            {conversations.map((c) => (
              <li key={c.contact_id}>
                <Link
                  href={`/whatsapp?contato=${c.contact_id}`}
                  className={`block px-4 py-3 hover:bg-slate-50 ${c.contact_id === contact?.id ? "bg-sky-50" : ""}`}
                >
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{dateTime(c.last_at)}</span>
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {c.last_direction === "saida" ? "Você: " : ""}
                    {c.last_body}
                  </p>
                </Link>
              </li>
            ))}
            {conversations.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">
                Nenhuma conversa ainda. As mensagens recebidas aparecem aqui automaticamente.
              </li>
            )}
          </ul>
        </aside>

        <section className="card flex min-h-[32rem] flex-col p-0 lg:col-span-2">
          {contact ? (
            <>
              <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <Link href={`/contatos/${contact.id}`} className="font-semibold hover:underline">
                    {contact.name}
                  </Link>
                  <p className="text-xs text-slate-500">{phoneFmt(contact.phone)}</p>
                </div>
              </header>
              <ChatThread
                contactId={contact.id}
                canSend={session.status === "conectado" && !!contact.phone}
                messages={thread}
                pending={pending}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-slate-500">
              Selecione uma conversa, ou abra um contato e clique em “Conversar no WhatsApp”.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
