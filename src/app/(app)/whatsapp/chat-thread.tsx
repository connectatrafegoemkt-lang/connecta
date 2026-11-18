"use client";

import { useEffect, useRef } from "react";
import { Check, CheckCheck, Clock, Send, TriangleAlert } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { dateTime } from "@/components/format";
import { whatsappSendAction } from "../actions";

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
  messages,
  pending,
}: {
  contactId: string;
  canSend: boolean;
  messages: { id: string; direction: string; body: string; status: string | null; occurred_at: string }[];
  pending: { id: string; body: string; status: string; error: string | null }[];
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.length, pending.length]);

  return (
    <>
      <div
        className="flex-1 space-y-2 overflow-y-auto px-5 py-5"
        style={{
          maxHeight: "30rem",
          backgroundImage: "radial-gradient(rgb(161 0 255 / 0.07) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
        }}
      >
        {messages.map((m) => {
          const out = m.direction === "saida";
          return (
            <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-lg ${
                  out
                    ? "rounded-br-md bg-gradient-to-br from-brand-500 to-brand-700 text-white"
                    : "rounded-bl-md border border-line bg-surface-2 text-fg"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${out ? "text-brand-100/80" : "text-subtle"}`}>
                  {dateTime(m.occurred_at)} {out && <StatusIcon status={m.status} />}
                </p>
              </div>
            </div>
          );
        })}
        {pending.map((p) => (
          <div key={p.id} className="flex justify-end">
            <div className="max-w-[75%] rounded-2xl rounded-br-md border border-brand-500/40 bg-brand-500/15 px-4 py-2.5 text-sm text-brand-50">
              <p className="whitespace-pre-wrap break-words">{p.body}</p>
              <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-brand-200/80">
                {p.status === "erro" ? (
                  <><TriangleAlert className="h-3 w-3 text-danger" /> Falhou: {p.error ?? ""}</>
                ) : (
                  <><Clock className="h-3 w-3" /> Enviando…</>
                )}
              </p>
            </div>
          </div>
        ))}
        {messages.length === 0 && pending.length === 0 && (
          <p className="py-10 text-center text-sm text-subtle">Nenhuma mensagem ainda. Diga olá! 👋</p>
        )}
        <div ref={end} />
      </div>
      <div className="border-t border-line bg-surface/60 p-3">
        {canSend ? (
          <ActionForm action={whatsappSendAction} resetOnSuccess className="flex items-center gap-2" submitLabel="Enviar" submitIcon={<Send className="h-4 w-4" />}>
            <input type="hidden" name="contact_id" value={contactId} />
            <input name="body" required maxLength={4096} placeholder="Digite uma mensagem" className="input flex-1 rounded-full px-5" autoComplete="off" />
          </ActionForm>
        ) : (
          <p className="px-2 py-1 text-sm text-muted">Conecte o WhatsApp (e cadastre o telefone do contato) para enviar mensagens.</p>
        )}
      </div>
    </>
  );
}
