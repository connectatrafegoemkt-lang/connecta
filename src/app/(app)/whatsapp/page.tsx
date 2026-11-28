import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarClock, MessageCircle } from "lucide-react";
import { can, getTenantContext } from "@/server/context";
import { getContact } from "@/server/data/contacts";
import {
  getWhatsappLimit,
  getWhatsappQrs,
  listConversations,
  listWhatsappNumbers,
  listPendingOutbox,
  listThread,
} from "@/server/data/whatsapp";
import { idSchema } from "@/server/validation";
import { getAiSettings, listPendingSuggestion } from "@/server/data/ai";
import { countScheduledMessages, listQuickReplies, signedUrlsFor } from "@/server/data/whatsapp-media";
import { listTags } from "@/server/data/tags";
import { listStages } from "@/server/data/stages";
import { listDepartments } from "@/server/data/departments";
import { listTasks } from "@/server/data/tasks";
import { listContactFields } from "@/server/data/contact-fields";
import { isAiPaused } from "@/shared/ai/hours";
import { phoneFmt } from "@/components/format";
import { Avatar } from "@/components/avatar";
import { ConnectionPanel } from "./connection-panel";
import { ChatThread } from "./chat-thread";
import { LiveRefresh } from "./live-refresh";
import { AiToggle } from "./ai-toggle";
import { TagPicker } from "./tag-picker";
import { ConversationList } from "./conversation-list";
import { LeadDrawer } from "./lead-drawer";
import { NumbersManager } from "./numbers-manager";
import { displayName } from "@/shared/contact-name";

export const metadata = { title: "WhatsApp" };

export default async function WhatsappPage({ searchParams }: PageProps<"/whatsapp">) {
  const ctx = await getTenantContext();
  if (!can(ctx, "whatsapp.ver")) redirect("/dashboard");
  const sp = await searchParams;
  const selected = idSchema.safeParse(sp.contato).success ? (sp.contato as string) : null;
  const tagFilter = idSchema.safeParse(sp.etiqueta).success ? (sp.etiqueta as string) : undefined;
  const numberFilter = idSchema.safeParse(sp.numero).success ? (sp.numero as string) : undefined;

  const [numbers, qrs, limit, conversations, aiSettings, quickReplies, tags, scheduledCount] = await Promise.all([
    listWhatsappNumbers(ctx),
    getWhatsappQrs(ctx),
    getWhatsappLimit(ctx),
    listConversations(ctx, { tagId: tagFilter, sessionId: numberFilter }),
    getAiSettings(ctx),
    listQuickReplies(ctx),
    listTags(ctx),
    countScheduledMessages(ctx),
  ]);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { contato: selected ?? undefined, etiqueta: tagFilter, numero: numberFilter, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const str = p.toString();
    return str ? `/whatsapp?${str}` : "/whatsapp";
  };

  let contact = null;
  let avatarUrl: string | null = null;
  let thread: Awaited<ReturnType<typeof listThread>> = [];
  let pending: Awaited<ReturnType<typeof listPendingOutbox>> = [];
  let suggestion: Awaited<ReturnType<typeof listPendingSuggestion>> = null;
  let stages: Awaited<ReturnType<typeof listStages>> = [];
  let departments: Awaited<ReturnType<typeof listDepartments>> = [];
  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  let fields: Awaited<ReturnType<typeof listContactFields>> = [];
  if (selected) {
    try {
      contact = await getContact(ctx, selected);
      [thread, pending, suggestion, stages, departments, tasks, fields] = await Promise.all([
        listThread(ctx, selected),
        listPendingOutbox(ctx, selected),
        aiSettings.mode === "sugerir" ? listPendingSuggestion(ctx, selected) : Promise.resolve(null),
        listStages(ctx),
        listDepartments(ctx),
        can(ctx, "tarefas.editar") || can(ctx, "contatos.ver") ? listTasks(ctx, { contact_id: selected }) : Promise.resolve([]),
        listContactFields(ctx),
      ]);
      if (contact.avatar_path) avatarUrl = (await signedUrlsFor(ctx, [contact.avatar_path])).get(contact.avatar_path) ?? null;
    } catch {
      contact = null; // contato inexistente ou de outro tenant
    }
  }

  const canConnect = can(ctx, "whatsapp.conectar");
  const connectedNumbers = numbers.filter((n) => n.status === "conectado");
  const numberLinks =
    numbers.length > 1
      ? [
          { id: null, name: "Todos os números", href: qs({ numero: undefined }), active: !numberFilter },
          ...numbers.map((n) => ({ id: n.id, name: n.label, href: qs({ numero: n.id }), active: numberFilter === n.id })),
        ]
      : [];
  const currentConversation = contact ? conversations.find((c) => c.contact_id === contact.id) : undefined;

  const tagLinks = [
    { id: null, name: "Todas", href: qs({ etiqueta: undefined }), active: !tagFilter },
    ...tags.map((t) => ({ id: t.id, name: t.name, color: t.color, href: qs({ etiqueta: t.id }), active: tagFilter === t.id })),
  ];

  return (
    <div className="space-y-4">
      <LiveRefresh tenantId={ctx.tenantId} contactId={contact?.id ?? null} pendingCount={pending.filter((p) => p.status !== "erro" && !p.scheduled_at).length} />

      {/* Números que ainda não estão conectados: status e QR em destaque */}
      {numbers.length === 0 ? (
        <ConnectionPanel
          isAdmin={canConnect}
          tenantId={ctx.tenantId}
          sessionId={null}
          initial={{ status: "desconectado", phone: null, last_error: null, qr: null }}
        />
      ) : (
        numbers
          .filter((n) => n.status !== "conectado")
          .map((n) => (
            <ConnectionPanel
              key={n.id}
              isAdmin={canConnect}
              tenantId={ctx.tenantId}
              sessionId={n.id}
              label={n.label}
              showLabel={numbers.length > 1}
              initial={{ status: n.status, phone: n.phone, last_error: n.last_error, qr: qrs[n.id] ?? null }}
            />
          ))
      )}

      <div className="flex h-[calc(100dvh-9rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-line bg-surface shadow-sm md:h-[calc(100dvh-5rem)]">
        {/* Lista de conversas */}
        <aside className={`flex w-full flex-col border-r border-line md:w-[23rem] md:shrink-0 ${contact ? "hidden md:flex" : "flex"}`}>
          <header className="flex h-[3.75rem] items-center justify-between px-4" style={{ background: "var(--wa-panel)" }}>
            <h1 className="text-lg font-semibold">Conversas</h1>
            <Link href="/whatsapp/agendadas" className="icon-btn relative" title="Mensagens agendadas" aria-label="Mensagens agendadas">
              <CalendarClock className="h-5 w-5" />
              {scheduledCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white" style={{ background: "var(--wa-green)" }}>
                  {scheduledCount > 99 ? "99+" : scheduledCount}
                </span>
              )}
            </Link>
          </header>
          {numbers
            .filter((n) => n.status === "conectado")
            .map((n) => (
              <ConnectionPanel
                key={n.id}
                compact
                isAdmin={canConnect}
                tenantId={ctx.tenantId}
                sessionId={n.id}
                label={n.label}
                showLabel={numbers.length > 1}
                initial={{ status: n.status, phone: n.phone, last_error: n.last_error, qr: null }}
              />
            ))}
          {canConnect && numbers.length > 0 && (
            <NumbersManager
              numbers={numbers.map((n) => ({ id: n.id, label: n.label, is_primary: n.is_primary, status: n.status, phone: n.phone }))}
              limit={limit}
            />
          )}
          <ConversationList
            selectedId={contact?.id ?? null}
            tagLinks={tagLinks}
            numberLinks={numberLinks}
            items={conversations.map((c) => ({ ...c, href: qs({ contato: c.contact_id }) }))}
          />
        </aside>

        {/* Conversa */}
        <section className={`min-w-0 flex-1 flex-col ${contact ? "flex" : "hidden md:flex"}`}>
          {contact ? (
            <>
              <header className="flex h-[3.75rem] items-center gap-3 border-l border-line/40 px-4" style={{ background: "var(--wa-panel)" }}>
                <a href={qs({ contato: undefined })} className="icon-btn md:hidden" aria-label="Voltar para as conversas"><ArrowLeft className="h-5 w-5" /></a>
                <Avatar name={displayName(contact)} url={avatarUrl} size={40} zoomable />
                <LeadDrawer
                  subtitle={contact.whatsapp_about || phoneFmt(contact.phone)}
                  actions={
                    <>
                      <TagPicker compact contactId={contact.id} all={tags} selected={contact.tags ?? []} />
                      {aiSettings.mode !== "desligado" && (
                        <AiToggle
                          compact
                          contactId={contact.id}
                          active={contact.ai_enabled === true}
                          paused={contact.ai_enabled === true && isAiPaused(contact.ai_paused_until)}
                        />
                      )}
                    </>
                  }
                  contact={{
                    id: contact.id,
                    name: displayName(contact),
                    phone: contact.phone,
                    email: contact.email,
                    company: contact.company,
                    source: contact.source,
                    notes: contact.notes,
                    value_cents: contact.value_cents,
                    stage_id: contact.stage_id,
                    department_id: contact.department_id,
                    avatar_url: avatarUrl,
                    whatsapp_name: contact.whatsapp_name ?? null,
                    whatsapp_about: contact.whatsapp_about ?? null,
                    tags: contact.tags ?? [],
                    custom_fields: contact.custom_fields ?? {},
                    from_ad: Boolean(contact.ad_at),
                    ad_title: contact.ad_source?.title ?? null,
                  }}
                  fields={fields}
                  stages={stages.map((s) => ({ id: s.id, name: s.name }))}
                  departments={departments.map((d) => ({ id: d.id, name: d.name }))}
                  tasks={tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, due_at: t.due_at }))}
                  canEdit={can(ctx, "contatos.editar")}
                  canTasks={can(ctx, "tarefas.editar")}
                  allSectors={can(ctx, "setores.todos")}
                  myDepartmentIds={ctx.departmentIds}
                />
              </header>
              <ChatThread
                contactId={contact.id}
                canSend={!!contact.phone}
                canWrite={can(ctx, "whatsapp.enviar")}
                connected={connectedNumbers.length > 0}
                numbers={connectedNumbers.map((n) => ({ id: n.id, label: n.label, phone: n.phone }))}
                defaultSessionId={currentConversation?.session_id ?? null}
                quickReplies={quickReplies}
                messages={thread}
                pending={pending}
                suggestion={suggestion}
              />
            </>
          ) : (
            <div className="wa-chat-bg flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-full" style={{ background: "var(--wa-panel)" }}>
                <MessageCircle className="h-9 w-9" style={{ color: "var(--wa-green)" }} />
              </span>
              <p className="text-xl font-light">CONNECTA para WhatsApp</p>
              <p className="max-w-sm text-sm text-muted">Escolha uma conversa à esquerda para ver as mensagens, a foto e a ficha do lead.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
