"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Loader2, Mic, Paperclip, Send, Square, Trash2, TriangleAlert, X, Zap } from "lucide-react";
import { whatsappSendAction } from "../actions";

export interface QuickReplyItem {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

/** Campo de mensagem do WhatsApp: texto, anexo, áudio gravado, agendamento e mensagens rápidas. */
export function Composer({
  contactId,
  quickReplies,
  connected,
  inputRef,
  prefill,
}: {
  contactId: string;
  quickReplies: QuickReplyItem[];
  connected: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Texto colocado no campo por fora (ex.: sugestão da IA). */
  prefill?: { text: string; nonce: number } | null;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [lastPrefill, setLastPrefill] = useState<number | null>(null);
  if (prefill && prefill.nonce !== lastPrefill) {
    setLastPrefill(prefill.nonce);
    setText(prefill.text);
  }
  const [file, setFile] = useState<File | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  // gravação de áudio
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => () => {
    if (audioSrc) URL.revokeObjectURL(audioSrc);
  }, [audioSrc]);

  const slash = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const matches = slash === null ? [] : quickReplies.filter((q) => q.shortcut.startsWith(slash) || q.title.toLowerCase().includes(slash)).slice(0, 6);

  const scheduledIso = scheduleOpen && scheduledAt ? scheduledAt : "";
  const canSchedule = !!scheduledIso;
  const disabledReason = !connected && !canSchedule ? "WhatsApp desconectado: só é possível agendar." : null;

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        setAudioSrc(URL.createObjectURL(blob));
        setAudio(blob);
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setRecording(true);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    setRecording(false);
    if (timer.current) clearInterval(timer.current);
  }

  function reset() {
    setText("");
    setFile(null);
    setAudio(null);
    setAudioSrc(null);
    setScheduleOpen(false);
    setScheduledAt("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function submit() {
    setError(null);
    setNotice(null);
    if (disabledReason) return setError(disabledReason);
    const body = text.trim();
    if (!body && !file && !audio) return;
    start(async () => {
      if (file || audio) {
        const fd = new FormData();
        fd.set("contact_id", contactId);
        fd.set("caption", audio ? "" : body);
        if (scheduledIso) fd.set("scheduled_at", new Date(scheduledIso).toISOString());
        if (audio) {
          fd.set("voice", "1");
          fd.set("file", new File([audio], "audio.webm", { type: audio.type || "audio/webm" }));
        } else if (file) fd.set("file", file);
        const res = await fetch("/api/whatsapp/media", { method: "POST", body: fd });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          return setError(j.error ?? "Falha ao enviar");
        }
      } else {
        const fd = new FormData();
        fd.set("contact_id", contactId);
        fd.set("body", body);
        if (scheduledIso) fd.set("scheduled_at", scheduledIso);
        const r = await whatsappSendAction({}, fd);
        if (r.error) return setError(r.error);
      }
      setNotice(scheduledIso ? "Mensagem agendada." : null);
      reset();
      router.refresh();
    });
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="relative">
      {matches.length > 0 && (
        <ul className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg" role="listbox">
          {matches.map((q) => (
            <li key={q.id}>
              <button type="button" onClick={() => { setText(q.body); inputRef.current?.focus(); }}
                className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-surface-2">
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span className="min-w-0">
                  <span className="text-sm font-medium">/{q.shortcut}</span> <span className="text-xs text-muted">{q.title}</span>
                  <span className="block truncate text-xs text-subtle">{q.body}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(file || audio) && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
          {audio ? (
            <audio controls src={audioSrc ?? undefined} className="h-9 flex-1" />
          ) : (
            <span className="flex flex-1 items-center gap-2 truncate"><Paperclip className="h-4 w-4 text-accent" /> {file!.name} <span className="text-xs text-subtle">({(file!.size / 1024 / 1024).toFixed(1)} MB)</span></span>
          )}
          <button type="button" className="icon-btn hover:text-danger" aria-label="Remover anexo" onClick={() => { setFile(null); setAudio(null); if (fileInput.current) fileInput.current.value = ""; }}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {scheduleOpen && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-accent-soft px-3 py-2 text-sm">
          <AlarmClock className="h-4 w-4 text-accent" />
          <span className="font-medium">Agendar para</span>
          <input type="datetime-local" className="input w-auto py-1.5" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          <button type="button" className="icon-btn ml-auto" aria-label="Cancelar agendamento" onClick={() => { setScheduleOpen(false); setScheduledAt(""); }}><X className="h-4 w-4" /></button>
        </div>
      )}

      {recording ? (
        <div className="flex items-center gap-3 rounded-full border border-danger/40 bg-danger/10 px-4 py-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
          <span className="text-sm font-medium tabular-nums text-danger">Gravando {mmss}</span>
          <button type="button" onClick={stopRecording} className="btn-secondary btn-sm ml-auto"><Square className="h-3.5 w-3.5" /> Parar</button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <input ref={fileInput} type="file" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setAudio(null); }}
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/3gpp,video/quicktime,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" />
          <button type="button" className="icon-btn h-10 w-10" title="Anexar arquivo" aria-label="Anexar arquivo" onClick={() => fileInput.current?.click()} disabled={!!audio}>
            <Paperclip className="h-5 w-5" />
          </button>
          <button type="button" className={`icon-btn h-10 w-10 ${scheduleOpen ? "text-accent" : ""}`} title="Agendar" aria-label="Agendar mensagem" onClick={() => setScheduleOpen((v) => !v)}>
            <AlarmClock className="h-5 w-5" />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            disabled={!!audio}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (matches.length === 1) setText(matches[0].body);
                else submit();
              }
            }}
            placeholder={audio ? "Áudio pronto para enviar" : file ? "Legenda (opcional)" : "Mensagem — digite / para mensagens rápidas"}
            className="input max-h-40 min-h-10 flex-1 resize-none rounded-2xl"
            maxLength={4096}
          />
          {!text.trim() && !file && !audio ? (
            <button type="button" className="btn-primary h-10 w-10 rounded-full p-0" title="Gravar áudio" aria-label="Gravar áudio" onClick={startRecording}>
              <Mic className="h-5 w-5" />
            </button>
          ) : (
            <button type="button" className="btn-primary h-10 rounded-full" disabled={pending} onClick={submit}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : scheduleOpen ? <AlarmClock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {scheduleOpen ? "Agendar" : "Enviar"}
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 flex items-center gap-1.5 text-sm text-danger"><TriangleAlert className="h-4 w-4" /> {error}</p>}
      {notice && <p className="mt-2 text-sm text-success">{notice}</p>}
    </div>
  );
}
