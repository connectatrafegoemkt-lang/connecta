"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, FileText, Image as ImageIcon, Loader2, Mic, Video, X } from "lucide-react";
import { dateTime, phoneFmt } from "@/components/format";

export interface ScheduledItem {
  id: string;
  body: string;
  scheduled_at: string;
  media_kind: string | null;
  media_filename: string | null;
  contact_id: string;
  contact_name: string;
  contact_phone: string | null;
  number_label?: string | null;
}

const MEDIA = { audio: Mic, image: ImageIcon, video: Video, document: FileText } as const;

/** Já passou do horário (o envio acontece quando o WhatsApp estiver conectado). */
const isLate = (iso: string) => new Date(iso).getTime() < Date.now() - 60_000;

/**
 * Lista de mensagens agendadas com "Cancelar". A ação de cancelar vem de
 * fora (Server Action do CRM), sempre no tenant da sessão.
 */
export function ScheduledList({
  items,
  cancel,
  canCancel,
  hrefs = {},
  empty = "Nenhuma mensagem agendada.",
}: {
  items: ScheduledItem[];
  cancel: (id: string) => Promise<{ ok?: boolean; error?: string | null }>;
  canCancel: boolean;
  /** Link do nome por contato (padrão: a conversa no WhatsApp). */
  hrefs?: Record<string, string>;
  empty?: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return <p className="py-4 text-sm text-subtle">{empty}</p>;
  return (
    <>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <ul className="divide-y divide-line">
        {items.map((m) => {
          const Media = m.media_kind ? MEDIA[m.media_kind as keyof typeof MEDIA] : null;
          const late = isLate(m.scheduled_at);
          return (
            <li key={m.id} className="flex items-start gap-3 py-3 text-sm">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-accent">
                <CalendarClock className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span className={`font-medium ${late ? "text-warning" : "text-fg"}`}>{dateTime(m.scheduled_at)}</span>
                  <Link href={hrefs[m.contact_id] ?? `/whatsapp?contato=${m.contact_id}`} className="font-medium text-accent hover:underline">{m.contact_name}</Link>
                  {m.contact_phone && <span>{phoneFmt(m.contact_phone)}</span>}
                  {m.number_label && <span className="chip py-0 text-[10px]">por {m.number_label}</span>}
                  {late && <span className="text-warning">enviando assim que o WhatsApp estiver conectado</span>}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words">
                  {Media && <Media className="mr-1 inline h-3.5 w-3.5 text-muted" />}
                  {m.body || m.media_filename || <span className="text-subtle">(sem texto)</span>}
                </p>
              </div>
              {canCancel && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusyId(m.id);
                    start(async () => {
                      const r = await cancel(m.id);
                      setError(r.error ?? null);
                      setBusyId(null);
                      router.refresh();
                    });
                  }}
                  className="btn-ghost btn-sm shrink-0 hover:text-danger"
                >
                  {busy && busyId === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Cancelar
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
