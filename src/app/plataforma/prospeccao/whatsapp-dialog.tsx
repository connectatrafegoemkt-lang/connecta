"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, CircleCheck, ExternalLink, ListOrdered, Loader2, MessageCircle, Mic, Send, Square, Trash2, TriangleAlert, X, Zap } from "lucide-react";
import { INTERVAL_PRESETS } from "@/shared/schedule";
import { openProspectChatAction, sendProspectAudioAction, sendProspectWhatsappAction } from "./actions";

type Modo = "agora" | "agendar" | "sequencia";
const MODOS: { id: Modo; label: string; icon: typeof Send }[] = [
  { id: "agora", label: "Enviar agora", icon: Send },
  { id: "agendar", label: "Agendar", icon: CalendarClock },
  { id: "sequencia", label: "Em sequência", icon: ListOrdered },
];

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
  const [mode, setMode] = useState<Modo>("agora");
  const [interval, setIntervalMin] = useState("10");
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof sendProspectWhatsappAction>>, fd: FormData) => {
    const r = await sendProspectWhatsappAction(prev, fd);
    if (r.ok) setText("");
    return r;
  }, {});
  const [chatState, chatAction, chatPending] = useActionState(openProspectChatAction, {});
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // áudio gravado
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [audioState, setAudioState] = useState<{ ok?: boolean; error?: string | null; message?: string | null }>({});
  const [audioPending, startAudio] = useTransition();
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);
  useEffect(() => () => {
    if (audioSrc) URL.revokeObjectURL(audioSrc);
  }, [audioSrc]);

  async function startRecording() {
    setAudioState({});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
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
      timer.current = setInterval(() => setSeconds((v) => v + 1), 1000);
    } catch {
      setAudioState({ ok: false, error: "Não foi possível acessar o microfone. Libere a permissão no navegador (ícone de cadeado ao lado do endereço)." });
    }
  }

  function stopRecording() {
    recorder.current?.stop();
    setRecording(false);
    if (timer.current) clearInterval(timer.current);
  }

  function discardAudio() {
    setAudio(null);
    setAudioSrc(null);
  }

  function sendAudio() {
    if (!audio || !formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.delete("body");
    fd.set("audio", new File([audio], "audio.webm", { type: audio.type || "audio/webm" }));
    startAudio(async () => {
      const r = await sendProspectAudioAction({}, fd);
      setAudioState(r);
      if (r.ok) discardAudio();
    });
  }
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

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

            <form ref={formRef} action={action} className="space-y-3 p-4">
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

              {recording ? (
                <div className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
                  <span className="text-sm font-medium tabular-nums text-danger">Gravando {mmss}</span>
                  <button type="button" onClick={stopRecording} className="btn-secondary btn-sm ml-auto"><Square className="h-3.5 w-3.5" /> Parar</button>
                </div>
              ) : audio ? (
                <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
                  <audio controls src={audioSrc ?? undefined} className="h-9 flex-1" />
                  <button type="button" className="icon-btn hover:text-danger" aria-label="Apagar áudio" onClick={discardAudio}><Trash2 className="h-4 w-4" /></button>
                </div>
              ) : (
                <div className="relative">
                  <textarea
                    ref={areaRef}
                    name="body"
                    maxLength={4096}
                    rows={5}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={`Olá, ${first}! Tudo bem? Aqui é da CONNECTA…`}
                    className="input pr-12"
                    aria-label="Mensagem"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={connected === null}
                    className="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:brightness-110 disabled:opacity-50"
                    style={{ background: "#00a884" }}
                    title="Gravar áudio"
                    aria-label="Gravar áudio"
                  >
                    <Mic className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-sm">
                {MODOS.map(({ id: m, label, icon: Icon }) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={`chip gap-1.5 ${mode === m ? "border-brand-500 bg-brand-500/10 text-accent-strong" : ""}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
                {mode === "agendar" && (
                  <input type="datetime-local" name="scheduled_at" required defaultValue={suggestion()} className="input w-auto py-1.5 text-sm" aria-label="Data e hora do envio" />
                )}
              </div>
              {mode === "sequencia" && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-500/5 p-2 text-sm">
                  <ListOrdered className="h-4 w-4 shrink-0 text-accent" />
                  <span>Enviar</span>
                  <select name="intervalo" value={interval} onChange={(e) => setIntervalMin(e.target.value)} className="input w-auto py-1 text-sm" aria-label="Intervalo entre mensagens">
                    {INTERVAL_PRESETS.map((n) => <option key={n} value={n}>{n} min</option>)}
                    <option value="45">45 min</option>
                    <option value="60">1 hora</option>
                  </select>
                  <span>depois da última mensagem agendada</span>
                  <span className="w-full text-xs text-muted">Ex.: se a última está para 11:40, esta vai para 11:50 (com 10 min). Sem nenhuma agendada, conta a partir de agora.</span>
                </div>
              )}

              {state.error && <p className="flex items-center gap-1.5 text-sm text-danger"><TriangleAlert className="h-4 w-4" /> {state.error}</p>}
              {state.ok && state.message && <p className="flex items-center gap-1.5 text-sm text-success"><CircleCheck className="h-4 w-4" /> {state.message}</p>}
              {audioState.error && <p className="flex items-center gap-1.5 text-sm text-danger"><TriangleAlert className="h-4 w-4" /> {audioState.error}</p>}
              {audioState.ok && audioState.message && <p className="flex items-center gap-1.5 text-sm text-success"><CircleCheck className="h-4 w-4" /> {audioState.message}</p>}

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
                {audio ? (
                  <button type="button" onClick={sendAudio} className="btn-primary" disabled={audioPending || connected === null} style={{ background: "#00a884" }}>
                    {audioPending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "agora" ? <Send className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
                    {mode === "agora" ? "Enviar áudio" : "Agendar áudio"}
                  </button>
                ) : (
                  <button type="submit" className="btn-primary" disabled={pending || recording || connected === null || !text.trim()} style={{ background: "#00a884" }}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "agora" ? <Send className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
                    {mode === "agora" ? "Enviar" : "Agendar envio"}
                  </button>
                )}
              </div>
              {chatState.error && <p className="text-xs text-danger">{chatState.error}</p>}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
