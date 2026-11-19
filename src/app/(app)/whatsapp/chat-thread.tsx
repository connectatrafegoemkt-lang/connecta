"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Bot, Check, CheckCheck, Clock, Download, FileText, Sparkles, TriangleAlert, X } from "lucide-react";
import { dateTime, dayLabel, sameDay, timeOnly } from "@/components/format";
import { cancelScheduledAction, setSuggestionStatusAction } from "../actions";
import { Composer, type QuickReplyItem } from "./composer";

function StatusIcon({ status }: { status: string | null }) {
  if (status === "lido") return <CheckCheck className="h-4 w-4" style={{ color: "var(--wa-tick-read)" }} aria-label="lida" />;
  if (status === "entregue") return <CheckCheck className="h-4 w-4" aria-label="entregue" />;
  if (status === "enviado") return <Check className="h-4 w-4" aria-label="enviada" />;
  if (status === "erro") return <TriangleAlert className="h-3.5 w-3.5 text-danger" aria-label="erro" />;
  return null;
}

export function ChatThread({
  contactId,
  canSend,
  canWrite = true,
  messages,
  pending,
  suggestion = null,
  quickReplies = [],
  connected = true,
}: {
  contactId: string;
  canSend: boolean;
  /** Permissão "Enviar mensagens no WhatsApp". */
  canWrite?: boolean;
  messages: {
    id: string;
    direction: string;
    body: string;
    status: string | null;
    occurred_at: string;
    metadata?: { ai?: boolean; media?: { kind: string; mime: string | null; filename: string | null } } | null;
    media_url?: string | null;
  }[];
  pending: { id: string; body: string; status: string; error: string | null; scheduled_at?: string | null; media_kind?: string | null; media_filename?: string | null }[];
  suggestion?: { id: string; body: string } | null;
  quickReplies?: QuickReplyItem[];
  connected?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const [, start] = useTransition();
  const showSuggestion = suggestion && suggestion.id !== hidden;

  function applySuggestion() {
    if (!suggestion) return;
    setPrefill({ text: suggestion.body, nonce: Date.now() });
    inputRef.current?.focus();
    setHidden(suggestion.id);
    start(async () => {
      await setSuggestionStatusAction(suggestion.id, "usada");
    });
  }
  function discard() {
    if (!suggestion) return;
    setHidden(suggestion.id);
    start(async () => {
      await setSuggestionStatusAction(suggestion.id, "descartada");
    });
  }
  // Bloco com chaves: o efeito NÃO pode devolver o retorno do scrollIntoView.
  // No Chrome novo ele devolve uma Promise, e o React tentaria chamá-la como
  // limpeza ("i is not a function") ao chegar mensagem ou ao sair da tela.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending.length]);

  return (
    <>
      <div className="wa-chat-bg min-h-0 flex-1 overflow-y-auto px-[4%] py-4">
        {messages.map((m, i) => {
          const out = m.direction === "saida";
          const prev = messages[i - 1];
          const newDay = !prev || !sameDay(prev.occurred_at, m.occurred_at);
          const firstOfGroup = newDay || !prev || prev.direction !== m.direction;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 flex justify-center">
                  <span className="wa-day">{dayLabel(m.occurred_at)}</span>
                </div>
              )}
              <div className={`flex ${out ? "justify-end" : "justify-start"} ${firstOfGroup ? "mt-2" : "mt-0.5"}`}>
                <div className={`wa-bubble ${out ? "wa-out" : "wa-in"} ${firstOfGroup ? (out ? "wa-tail-out" : "wa-tail-in") : ""}`}>
                  {out && m.metadata?.ai && (
                    <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--wa-green)" }}>
                      <Bot className="h-3 w-3" /> Resposta da IA
                    </span>
                  )}
                  <MediaView media={m.metadata?.media} url={m.media_url} />
                  {messageText(m) && (
                    <span className="whitespace-pre-wrap break-words">
                      {messageText(m)}
                      {/* espaço reservado para a hora, como no WhatsApp */}
                      <span className="inline-block w-16" aria-hidden />
                    </span>
                  )}
                  <span className="wa-meta float-right -mb-0.5 ml-2 mt-1 flex items-center gap-1 leading-none" title={dateTime(m.occurred_at)}>
                    {timeOnly(m.occurred_at)} {out && <StatusIcon status={m.status} />}
                  </span>
                  <span className="clear-both block" />
                </div>
              </div>
            </div>
          );
        })}
        {pending.map((p) => {
          const scheduled = !!p.scheduled_at && p.status === "pendente";
          return (
            <div key={p.id} className="mt-2 flex justify-end">
              <div className={`wa-bubble wa-out ${scheduled ? "opacity-80 ring-1 ring-dashed ring-[var(--wa-green)]" : ""}`}>
                {p.media_kind && <p className="mb-1 flex items-center gap-1 text-xs" style={{ color: "var(--wa-meta)" }}><FileText className="h-3.5 w-3.5" /> {p.media_filename ?? { audio: "Áudio", image: "Imagem", video: "Vídeo", document: "Documento" }[p.media_kind] ?? "Arquivo"}</p>}
                {p.body && <span className="whitespace-pre-wrap break-words">{p.body}</span>}
                <span className="wa-meta mt-1 flex items-center justify-end gap-2">
                  {p.status === "erro" ? (
                    <span className="flex items-center gap-1 text-danger"><TriangleAlert className="h-3 w-3" /> Falhou: {p.error ?? ""}</span>
                  ) : scheduled ? (
                    <>
                      <AlarmClock className="h-3 w-3" /> Agendada para {dateTime(p.scheduled_at)}
                      <button type="button" className="font-semibold underline-offset-2 hover:underline"
                        onClick={() => start(async () => { await cancelScheduledAction(p.id); router.refresh(); })}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <><Clock className="h-3 w-3" /> Enviando…</>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && pending.length === 0 && (
          <div className="my-6 flex justify-center">
            <span className="wa-day">Nenhuma mensagem ainda. Diga olá! 👋</span>
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="px-3 py-2" style={{ background: "var(--wa-panel)" }}>
        {showSuggestion && canSend && canWrite && (
          <div className="mb-3 rounded-xl border border-brand-500/40 bg-accent-soft p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-accent-strong">
              <Sparkles className="h-3.5 w-3.5" /> Sugestão da IA
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{suggestion!.body}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={applySuggestion} className="btn-primary btn-sm">
                <Check className="h-3.5 w-3.5" /> Usar e revisar
              </button>
              <button type="button" onClick={discard} className="btn-ghost btn-sm">
                <X className="h-3.5 w-3.5" /> Descartar
              </button>
            </div>
          </div>
        )}
        {!canWrite ? (
          <p className="text-sm text-muted">Você pode ver esta conversa, mas não tem permissão para enviar mensagens.</p>
        ) : canSend ? (
          <Composer contactId={contactId} quickReplies={quickReplies} connected={connected} inputRef={inputRef} prefill={prefill} />
        ) : (
          <p className="text-sm text-muted">Cadastre o telefone do contato para enviar mensagens.</p>
        )}
      </div>
    </>
  );
}

function MediaView({
  media,
  url,
}: {
  media?: { kind: string; mime: string | null; filename: string | null } | null;
  url?: string | null;
}) {
  if (!media) return null;
  if (!url) return <p className="mb-1 text-xs opacity-70">[arquivo indisponível]</p>;
  if (media.kind === "image")
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Imagem enviada" className="max-h-80 rounded-md object-cover" loading="lazy" />
      </a>
    );
  if (media.kind === "audio") return <audio controls src={url} className="mb-1 h-10 w-64 max-w-full" />;
  if (media.kind === "video") return <video controls src={url} className="mb-1 max-h-80 rounded-md" />;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">{media.filename ?? "Documento"}</span>
      <Download className="ml-auto h-4 w-4 shrink-0" />
    </a>
  );
}

/** Texto da mensagem sem o marcador de mídia ("[imagem]"...) e sem repetir o nome do arquivo. */
function messageText(m: { body: string; metadata?: { media?: { filename: string | null } } | null }): string {
  if (!m.metadata?.media) return m.body;
  const t = m.body.replace(/^\[(imagem|vídeo|áudio|documento|figurinha)\]\s*/, "").trim();
  return t === (m.metadata.media.filename ?? "") ? "" : t;
}
