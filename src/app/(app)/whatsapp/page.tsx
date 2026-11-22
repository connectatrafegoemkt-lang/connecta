import { redirect } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { can, getTenantContext } from "@/server/context";
import { getContact } from "@/server/data/contacts";
import {
  getWhatsappQr,
  getWhatsappSession,
  listConversations,
  listPendingOutbox,
  listThread,
} from "@/server/data/whatsapp";
import { idSchema } from "@/server/validation";
import { getAiSettings, listPendingSuggestion } from "@/server/data/ai";
import { listQuickReplies, signedUrlsFor } from "@/server/data/whatsapp-media";
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

export const metadata = { title: "WhatsApp" };

export default async function WhatsappPage({ searchParams }: PageProps<"/whatsapp">) {
  const ctx = await getTenantContext();
  if (!can(ctx, "whatsapp.ver")) redirect("/dashboard");
  const sp = await searchParams;
  const selected = idSchema.safeParse(sp.contato).success ? (sp.contato as string) : null;
  const tagFilter = idSchema.safeParse(sp.etiqueta).success ? (sp.etiqueta as string) : undefined;

  const [session, qr, conversations, aiSettings, quickReplies, tags] = await Promise.all([
    getWhatsappSession(ctx),
    getWhatsappQr(ctx),
    listConversations(ctx, { tagId: tagFilter }),
    getAiSettings(ctx),
    listQuickReplies(ctx),
    listTags(ctx),
  ]);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { contato: selected ?? undefined, etiqueta: tagFilter, ...extra };
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

  const tagLinks = [
    { id: null, name: "Todas", href: qs({ etiqueta: undefined }), active: !tagFilter },
    ...tags.map((t) => ({ id: t.id, name: t.name, color: t.color, href: qs({ etiqueta: t.id }), active: tagFilter === t.id })),
  ];

  return (
    <div className="space-y-4">
      <LiveRefresh tenantId={ctx.tenantId} contactId={contact?.id ?? null} pendingCount={pending.filter((p) => p.status !== "erro" && !p.scheduled_at).length} />

      {session.status !== "conectado" && (
        <ConnectionPanel
          isAdmin={can(ctx, "whatsapp.conectar")}
          tenantId={ctx.tenantId}
          initial={{ status: session.status, phone: session.phone, last_error: session.last_error, qr }}
        />
      )}

      <div className="flex h-[calc(100dvh-9rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-line bg-surface shadow-sm md:h-[calc(100dvh-5rem)]">
        {/* Lista de conversas */}
        <aside className={`flex w-full flex-col border-r border-line md:w-[23rem] md:shrink-0 ${contact ? "hidden md:flex" : "flex"}`}>
          <header className="flex h-[3.75rem] items-center justify-between px-4" style={{ background: "var(--wa-panel)" }}>
            <h1 className="text-lg font-semibold">Conversas</h1>
            <MessageCircle className="h-5 w-5 text-muted" />
          </header>
          {session.status === "conectado" && (
            <ConnectionPanel
              compact
              isAdmin={can(ctx, "whatsapp.conectar")}
              tenantId={ctx.tenantId}
              initial={{ status: session.status, phone: session.phone, last_error: session.last_error, qr }}
            />
          )}
          <ConversationList
            selectedId={contact?.id ?? null}
            tagLinks={tagLinks}
            items={conversations.map((c) => ({ ...c, href: qs({ contato: c.contact_id }) }))}
          />
        </aside>

        {/* Conversa */}
        <section className={`min-w-0 flex-1 flex-col ${contact ? "flex" : "hidden md:flex"}`}>
          {contact ? (
            <>
              <header className="flex h-[3.75rem] items-center gap-3 border-l border-line/40 px-4" style={{ background: "var(--wa-panel)" }}>
                <a href={qs({ contato: undefined })} className="icon-btn md:hidden" aria-label="Voltar para as conversas"><ArrowLeft className="h-5 w-5" /></a>
                <Avatar name={contact.name} url={avatarUrl} size={40} zoomable />
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
                    name: contact.name,
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
                connected={session.status === "conectado"}
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
