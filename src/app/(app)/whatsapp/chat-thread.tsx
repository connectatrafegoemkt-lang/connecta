"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Bot, Check, CheckCheck, Clock, Download, FileText, Sparkles, TriangleAlert, X } from "lucide-react";
import { dateTime } from "@/components/format";
import { cancelScheduledAction, setSuggestionStatusAction } from "../actions";
import { Composer, type QuickReplyItem } from "./composer";

function StatusIcon({ status }: { status: string | null }) {
  if (status === "lido") return <CheckCheck className="h-3.5 w-3.5 text-brand-200" aria-label="lida" />;
  if (status === "entregue") return <CheckCheck className="h-3.5 w-3.5" aria-label="entregue" />;
  if (status === "enviado") return <Check className="h-3.5 w-3.5" aria-label="enviada" />;
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
      <div
        className="flex-1 space-y-2 overflow-y-auto px-5 py-5"
        style={{
          maxHeight: "30rem",
          backgroundImage: "radial-gradient(rgb(161 0 255 / 0.10) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        {messages.map((m) => {
          const out = m.direction === "saida";
          return (
            <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                  out
                    ? "rounded-br-md bg-gradient-to-br from-brand-500 to-brand-700 text-white"
                    : "rounded-bl-md border border-line bg-surface text-fg"
                }`}
              >
                <MediaView media={m.metadata?.media} url={m.media_url} out={out} />
                {messageText(m) && <p className="whitespace-pre-wrap break-words">{messageText(m)}</p>}
                <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${out ? "text-brand-100/80" : "text-subtle"}`}>
                  {out && m.metadata?.ai && (
                    <span className="mr-auto inline-flex items-center gap-0.5 rounded-full bg-white/20 px-1.5 py-px font-medium text-white">
                      <Bot className="h-3 w-3" /> IA
                    </span>
                  )}
                  {dateTime(m.occurred_at)} {out && <StatusIcon status={m.status} />}
                </p>
              </div>
            </div>
          );
        })}
        {pending.map((p) => {
          const scheduled = !!p.scheduled_at && p.status === "pendente";
          return (
            <div key={p.id} className="flex justify-end">
              <div className={`max-w-[75%] rounded-2xl rounded-br-md border px-4 py-2.5 text-sm ${scheduled ? "border-dashed border-brand-500/60 bg-surface text-fg" : "border-brand-500/40 bg-accent-soft text-fg"}`}>
                {p.media_kind && <p className="mb-1 flex items-center gap-1 text-xs text-muted"><FileText className="h-3.5 w-3.5" /> {p.media_filename ?? { audio: "Áudio", image: "Imagem", video: "Vídeo", document: "Documento" }[p.media_kind] ?? "Arquivo"}</p>}
                {p.body && <p className="whitespace-pre-wrap break-words">{p.body}</p>}
                <p className="mt-1 flex items-center justify-end gap-2 text-[10px] text-accent-strong">
                  {p.status === "erro" ? (
                    <><TriangleAlert className="h-3 w-3 text-danger" /> Falhou: {p.error ?? ""}</>
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
                </p>
              </div>
            </div>
          );
        })}
        {messages.length === 0 && pending.length === 0 && (
          <p className="py-10 text-center text-sm text-subtle">Nenhuma mensagem ainda. Diga olá! 👋</p>
        )}
        <div ref={end} />
      </div>
      <div className="border-t border-line bg-surface p-3">
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
  out,
}: {
  media?: { kind: string; mime: string | null; filename: string | null } | null;
  url?: string | null;
  out: boolean;
}) {
  if (!media) return null;
  if (!url) return <p className="mb-1 text-xs opacity-70">[arquivo indisponível]</p>;
  if (media.kind === "image")
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Imagem enviada" className="max-h-72 rounded-xl object-cover" loading="lazy" />
      </a>
    );
  if (media.kind === "audio") return <audio controls src={url} className="mb-1 h-10 w-64 max-w-full" />;
  if (media.kind === "video") return <video controls src={url} className="mb-1 max-h-72 rounded-xl" />;
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className={`mb-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${out ? "bg-white/15" : "bg-surface-2"}`}>
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
