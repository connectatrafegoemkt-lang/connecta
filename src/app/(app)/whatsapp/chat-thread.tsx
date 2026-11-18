"use client";

import { useEffect, useRef } from "react";
import { ActionForm } from "@/components/action-form";
import { dateTime } from "@/components/format";
import { whatsappSendAction } from "../actions";

const STATUS_ICON: Record<string, string> = { enviado: "✓", entregue: "✓✓", lido: "✓✓", erro: "!" };

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
      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4" style={{ maxHeight: "28rem" }}>
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "saida" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                m.direction === "saida" ? "bg-emerald-100 text-emerald-950" : "bg-white text-slate-900"
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className="mt-1 text-right text-[10px] text-slate-500">
                {dateTime(m.occurred_at)}{" "}
                {m.direction === "saida" && m.status && (
                  <span className={m.status === "lido" ? "text-sky-600" : ""}>{STATUS_ICON[m.status] ?? ""}</span>
                )}
              </p>
            </div>
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.id} className="flex justify-end">
            <div className="max-w-[75%] rounded-2xl bg-emerald-50 px-3 py-2 text-sm opacity-70 shadow-sm">
              <p className="whitespace-pre-wrap break-words">{p.body}</p>
              <p className="mt-1 text-right text-[10px] text-slate-500">
                {p.status === "erro" ? `Falhou: ${p.error ?? ""}` : "Enviando…"}
              </p>
            </div>
          </div>
        ))}
        {messages.length === 0 && pending.length === 0 && (
          <p className="text-center text-sm text-slate-400">Nenhuma mensagem ainda.</p>
        )}
        <div ref={end} />
      </div>
      <div className="border-t border-slate-100 p-3">
        {canSend ? (
          <ActionForm action={whatsappSendAction} resetOnSuccess className="flex gap-2" submitLabel="Enviar">
            <input type="hidden" name="contact_id" value={contactId} />
            <input name="body" required maxLength={4096} placeholder="Digite uma mensagem" className="input flex-1" autoComplete="off" />
          </ActionForm>
        ) : (
          <p className="text-sm text-slate-500">Conecte o WhatsApp (e cadastre o telefone do contato) para enviar mensagens.</p>
        )}
      </div>
    </>
  );
}
