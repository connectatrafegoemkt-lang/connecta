"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CalendarClock, CircleCheck, ExternalLink, Loader2, MessageCircle, Send, TriangleAlert, X, Zap } from "lucide-react";
import { openProspectChatAction, sendProspectWhatsappAction } from "./actions";

export interface QuickReplyOpt {
  shortcut: string;
  title: string;
  body: string;
}

/** Fuso de Brasília: "agora + 1h" para sugerir no agendamento. */
function suggestion() {
  const d = new Date(Date.now() + 3600_000 - 3 * 3600_000);
  return d.toISOString().slice(0, 16);
}

/**
 * Botão "WhatsApp" da prospecção: abre uma janela para enviar ou agendar a
 * mensagem pelo WhatsApp da CONNECTA conectado no CRM (sem sair da tela).
 */
export function WhatsappDialog({
  id,
  name,
  phone,
  quickReplies,
  connected,
  variant = "icon",
}: {
  id: string;
  name: string;
  phone: string | null;
  quickReplies: QuickReplyOpt[];
  /** null = usuário sem empresa no CRM (não dá para enviar). */
  connected: boolean | null;
  variant?: "icon" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"agora" | "agendar">("agora");
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof sendProspectWhatsappAction>>, fd: FormData) => {
    const r = await sendProspectWhatsappAction(prev, fd);
    if (r.ok) setText("");
    return r;
  }, {});
  const [chatState, chatAction, chatPending] = useActionState(openProspectChatAction, {});
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!phone) return null;
  const first = name.split(/\s+/)[0] ?? "";
  const fill = (body: string) => setText(body.replace(/\{nome\}/gi, first));

  return (
    <>
      {variant === "icon" ? (
        <button type="button" onClick={() => setOpen(true)} className="icon-btn h-8 w-8 text-success" title={`WhatsApp para ${name}`} aria-label={`WhatsApp para ${name}`}>
          <MessageCircle className="h-4 w-4" />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn-primary btn-sm" style={{ background: "#00a884" }}>
          <MessageCircle className="h-4 w-4" /> Mensagem no WhatsApp
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`WhatsApp para ${name}`}>
          <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" aria-label="Fechar" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
            <header className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: "#008069" }}>
              <MessageCircle className="h-5 w-5" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate font-medium">{name}</p>
                <p className="text-xs opacity-80">+{phone}</p>
              </div>
              <button type="button" className="rounded-full p-1.5 hover:bg-white/10" aria-label="Fechar" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </header>

            <form action={action} className="space-y-3 p-4">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="modo" value={mode} />

              {connected === null && (
                <p className="flex items-start gap-2 rounded-lg bg-danger/10 p-2 text-xs text-danger">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Seu usuário não está ligado à empresa CONNECTA no CRM; não é possível enviar daqui.
                </p>
              )}
              {connected === false && (
                <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-2 text-xs text-warning">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  O WhatsApp da CONNECTA não está conectado agora. Você ainda pode agendar; para enviar na hora, conecte em WhatsApp no CRM.
                </p>
              )}

              {quickReplies.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <Zap className="h-4 w-4 shrink-0 text-accent" />
                  <select
                    className="input py-1.5 text-sm"
                    defaultValue=""
                    onChange={(e) => {
                      const q = quickReplies.find((x) => x.shortcut === e.target.value);
                      if (q) fill(q.body);
                      e.target.value = "";
                      areaRef.current?.focus();
                    }}
                    aria-label="Usar mensagem rápida"
                  >
                    <option value="">Usar uma mensagem rápida…</option>
                    {quickReplies.map((q) => (
                      <option key={q.shortcut} value={q.shortcut}>/{q.shortcut} · {q.title}</option>
                    ))}
                  </select>
                </label>
              )}

              <textarea
                ref={areaRef}
                name="body"
                required
                maxLength={4096}
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Olá, ${first}! Tudo bem? Aqui é da CONNECTA…`}
                className="input"
                aria-label="Mensagem"
                autoFocus
              />

              <div className="flex flex-wrap gap-2 text-sm">
                {(["agora", "agendar"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={`chip gap-1.5 ${mode === m ? "border-brand-500 bg-brand-500/10 text-accent-strong" : ""}`}
                  >
                    {m === "agora" ? <Send className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
                    {m === "agora" ? "Enviar agora" : "Agendar"}
                  </button>
                ))}
                {mode === "agendar" && (
                  <input type="datetime-local" name="scheduled_at" required defaultValue={suggestion()} className="input w-auto py-1.5 text-sm" aria-label="Data e hora do envio" />
                )}
              </div>

              {state.error && <p className="flex items-center gap-1.5 text-sm text-danger"><TriangleAlert className="h-4 w-4" /> {state.error}</p>}
              {state.ok && state.message && <p className="flex items-center gap-1.5 text-sm text-success"><CircleCheck className="h-4 w-4" /> {state.message}</p>}

              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <button
                  type="submit"
                  formAction={chatAction}
                  formNoValidate
                  className="btn-ghost btn-sm"
                  disabled={chatPending || connected === null}
                  title="Abrir a conversa completa (áudio, arquivos e histórico) na tela de WhatsApp"
                >
                  {chatPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Abrir conversa completa
                </button>
                <button type="submit" className="btn-primary" disabled={pending || connected === null || !text.trim()} style={{ background: "#00a884" }}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "agora" ? <Send className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
                  {mode === "agora" ? "Enviar" : "Agendar envio"}
                </button>
              </div>
              {chatState.error && <p className="text-xs text-danger">{chatState.error}</p>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
