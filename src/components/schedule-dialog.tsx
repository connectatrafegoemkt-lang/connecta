"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, CircleCheck, ListOrdered, Loader2, Mic, Square, Trash2, TriangleAlert, X } from "lucide-react";
import { whatsappSendAction } from "@/app/(app)/actions";
import { brDateTime, INTERVAL_PRESETS } from "@/shared/schedule";
import { useVoiceRecorder } from "./use-voice-recorder";

export type ScheduleMode = "agendar" | "rodizio";

/** Data/hora sugerida (agora + 1h, horário de Brasília) para o campo datetime-local. */
function suggestion() {
  return new Date(Date.now() + 3600_000 - 3 * 3600_000).toISOString().slice(0, 16);
}

/**
 * Botões "Agendar" e "Rodízio" de um contato. Abrem uma janela para agendar
 * texto ou áudio: numa data/hora, ou em rodízio (X minutos depois da última
 * mensagem agendada).
 */
export function ScheduleButtons({ contactId, name, compact = false }: { contactId: string; name: string; compact?: boolean }) {
  const [open, setOpen] = useState<ScheduleMode | null>(null);
  const size = compact ? "h-8 w-8" : "h-9 w-9";
  return (
    <>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" className={`icon-btn ${size}`} title={`Agendar mensagem para ${name}`} aria-label={`Agendar mensagem para ${name}`} onClick={() => setOpen("agendar")}>
          <AlarmClock className="h-4 w-4" />
        </button>
        <button type="button" className={`icon-btn ${size}`} title={`Rodízio: agendar para ${name} depois da última mensagem agendada`} aria-label={`Rodízio para ${name}`} onClick={() => setOpen("rodizio")}>
          <ListOrdered className="h-4 w-4" />
        </button>
      </span>
      {open && <ScheduleDialog contactId={contactId} name={name} initialMode={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function ScheduleDialog({ contactId, name, initialMode, onClose }: { contactId: string; name: string; initialMode: ScheduleMode; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<ScheduleMode>(initialMode);
  const [text, setText] = useState("");
  const [when, setWhen] = useState(suggestion());
  const [interval, setIntervalMin] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rec = useVoiceRecorder();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    setError(null);
    setDone(null);
    const body = text.trim();
    if (!body && !rec.audio) return setError("Escreva a mensagem ou grave um áudio.");
    if (mode === "agendar" && !when) return setError("Escolha a data e a hora.");
    start(async () => {
      if (rec.audio) {
        const fd = new FormData();
        fd.set("contact_id", contactId);
        fd.set("caption", "");
        fd.set("voice", "1");
        fd.set("file", new File([rec.audio], "audio.webm", { type: rec.audio.type || "audio/webm" }));
        if (mode === "agendar") fd.set("scheduled_at", new Date(`${when}:00-03:00`).toISOString());
        else fd.set("intervalo", interval);
        const res = await fetch("/api/whatsapp/media", { method: "POST", body: fd });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return setError(j.error ?? "Falha ao agendar");
        setDone(j.scheduled_at ? `Áudio agendado para ${brDateTime(j.scheduled_at)}.` : "Áudio agendado.");
        rec.discard();
      } else {
        const fd = new FormData();
        fd.set("contact_id", contactId);
        fd.set("body", body);
        if (mode === "agendar") fd.set("scheduled_at", when);
        else fd.set("intervalo", interval);
        const r = await whatsappSendAction({}, fd);
        if (r.error) return setError(r.error);
        setDone(r.message ?? "Mensagem agendada.");
        setText("");
      }
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Agendar mensagem para ${name}`}>
      <button type="button" className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" aria-label="Fechar" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl">
        <header className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: "#008069" }}>
          {mode === "agendar" ? <AlarmClock className="h-5 w-5" /> : <ListOrdered className="h-5 w-5" />}
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-medium">{name}</p>
            <p className="text-xs opacity-80">{mode === "agendar" ? "Agendar mensagem" : "Rodízio de mensagens"}</p>
          </div>
          <button type="button" className="rounded-full p-1.5 hover:bg-white/10" aria-label="Fechar" onClick={onClose}><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-3 p-4">
          <div className="flex gap-2 text-sm">
            <button type="button" aria-pressed={mode === "agendar"} onClick={() => setMode("agendar")} className={`chip gap-1.5 ${mode === "agendar" ? "border-brand-500 bg-brand-500/10 text-accent-strong" : ""}`}>
              <AlarmClock className="h-3.5 w-3.5" /> Data e hora
            </button>
            <button type="button" aria-pressed={mode === "rodizio"} onClick={() => setMode("rodizio")} className={`chip gap-1.5 ${mode === "rodizio" ? "border-brand-500 bg-brand-500/10 text-accent-strong" : ""}`}>
              <ListOrdered className="h-3.5 w-3.5" /> Rodízio
            </button>
          </div>

          {mode === "agendar" ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Enviar em</span>
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="input w-auto py-1.5 text-sm" aria-label="Data e hora do envio" />
            </label>
          ) : (
            <div className="rounded-lg bg-brand-500/5 p-2 text-sm">
              <label className="flex flex-wrap items-center gap-2">
                <span>Enviar</span>
                <select value={interval} onChange={(e) => setIntervalMin(e.target.value)} className="input w-auto py-1 text-sm" aria-label="Intervalo do rodízio">
                  {INTERVAL_PRESETS.map((n) => <option key={n} value={n}>{n} min</option>)}
                  <option value="45">45 min</option>
                  <option value="60">1 hora</option>
                </select>
                <span>depois da última mensagem agendada</span>
              </label>
              <p className="mt-1 text-xs text-muted">Ex.: a última está para 11:40 → esta vai para 11:50 (com 10 min). Sem nenhuma agendada, conta a partir de agora.</p>
            </div>
          )}

          {rec.recording ? (
            <div className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
              <span className="text-sm font-medium tabular-nums text-danger">Gravando {rec.mmss}</span>
              <button type="button" onClick={rec.stop} className="btn-secondary btn-sm ml-auto"><Square className="h-3.5 w-3.5" /> Parar</button>
            </div>
          ) : rec.audio ? (
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
              <audio controls src={rec.audioSrc ?? undefined} className="h-9 flex-1" />
              <button type="button" className="icon-btn hover:text-danger" aria-label="Apagar áudio" onClick={rec.discard}><Trash2 className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="relative">
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4096} placeholder="Mensagem…" className="input pr-12" aria-label="Mensagem" autoFocus />
              <button type="button" onClick={rec.start} className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full text-white hover:brightness-110" style={{ background: "#00a884" }} title="Gravar áudio" aria-label="Gravar áudio">
                <Mic className="h-4 w-4" />
              </button>
            </div>
          )}

          {(error || rec.error) && <p className="flex items-center gap-1.5 text-sm text-danger"><TriangleAlert className="h-4 w-4 shrink-0" /> {error ?? rec.error}</p>}
          {done && <p className="flex items-center gap-1.5 text-sm text-success"><CircleCheck className="h-4 w-4 shrink-0" /> {done}</p>}

          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button type="button" className="btn-ghost" onClick={onClose}>Fechar</button>
            <button type="button" className="btn-primary" style={{ background: "#00a884" }} disabled={pending || rec.recording || (!text.trim() && !rec.audio)} onClick={submit}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "agendar" ? <AlarmClock className="h-4 w-4" /> : <ListOrdered className="h-4 w-4" />}
              {rec.audio ? "Agendar áudio" : "Agendar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
