"use client";

import { useEffect, useState, useTransition } from "react";
import QRCode from "qrcode";
import { Loader2, Lock, QrCode, RefreshCw, Smartphone, Wifi, WifiOff } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { whatsappConnectAction, whatsappDisconnectAction, whatsappResetAction } from "../actions";

type Status = "desconectado" | "aguardando_qr" | "conectando" | "conectado" | "erro";
interface State {
  status: Status;
  phone: string | null;
  last_error: string | null;
  qr: string | null;
}

const LABEL: Record<Status, string> = {
  desconectado: "Desconectado",
  aguardando_qr: "Aguardando leitura do QR code",
  conectando: "Conectando…",
  conectado: "Conectado",
  erro: "Erro",
};
const TONE: Record<Status, string> = {
  desconectado: "border-line bg-surface-2 text-muted",
  aguardando_qr: "border-warning/40 bg-warning/10 text-warning",
  conectando: "border-brand-500/40 bg-brand-500/10 text-accent-strong",
  conectado: "border-success/40 bg-success/10 text-success",
  erro: "border-danger/40 bg-danger/10 text-danger",
};

/**
 * Status e QR em tempo real. O QR chega por Realtime da tabela whatsapp_qr,
 * cujo RLS só entrega linhas ao ADMIN do próprio tenant.
 */
export function ConnectionPanel({ initial, isAdmin, tenantId, compact = false }: { initial: State; isAdmin: boolean; tenantId: string; compact?: boolean }) {
  const [state, setState] = useState(initial);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const ch = sb
      .channel(`wa-session-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_sessions", filter: `tenant_id=eq.${tenantId}` },
        (p) => {
          const row = p.new as Partial<State>;
          setState((s) => ({ ...s, status: (row.status as Status) ?? s.status, phone: row.phone ?? null, last_error: row.last_error ?? null }));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_qr", filter: `tenant_id=eq.${tenantId}` },
        (p) => setState((s) => ({ ...s, qr: (p.new as { qr?: string | null }).qr ?? null })),
      )
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [tenantId]);

  // Reserva do tempo real: enquanto não estiver conectado, consulta o status e
  // o QR a cada 3 s (o QR muda a cada ~20 s). Sem isso, se o Realtime falhar,
  // a tela fica em "Conectando…" e o QR nunca aparece.
  const polling = state.status !== "conectado" && state.status !== "desconectado";
  useEffect(() => {
    if (!polling) return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
        if (!res.ok || stop) return;
        const j = (await res.json()) as Partial<State>;
        setState((s) => ({
          ...s,
          status: (j.status as Status) ?? s.status,
          phone: j.phone ?? null,
          last_error: j.last_error ?? null,
          qr: isAdmin ? (j.qr ?? null) : s.qr,
        }));
      } catch {
        /* rede instável: tenta de novo no próximo ciclo */
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 3000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [polling, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    if (state.qr && state.status !== "conectado") {
      QRCode.toString(state.qr, { type: "svg", margin: 1, width: 256 }).then((svg) => {
        if (!cancelled) setQrSvg(svg);
      });
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQrSvg(null);
    }
    return () => {
      cancelled = true;
    };
  }, [state.qr, state.status]);

  const run = (fn: typeof whatsappConnectAction) =>
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
      if (!r.error && (fn === whatsappConnectAction || fn === whatsappResetAction)) setState((s) => ({ ...s, status: s.status === "conectado" ? s.status : "conectando" }));
    });

  // "Conectando" por muito tempo sem QR: oferece recomeçar o pareamento.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state.status !== "conectando") return;
    const t = setTimeout(() => setSlow(true), 45_000);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [state.status]);

  const StatusIcon = state.status === "conectado" ? Wifi : state.status === "conectando" ? Loader2 : state.status === "aguardando_qr" ? QrCode : WifiOff;

  // Conectado: só uma faixa discreta (como o WhatsApp Web), sem ocupar a tela.
  if (compact && state.status === "conectado") {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs" style={{ background: "var(--wa-panel)" }}>
        <span className="flex items-center gap-1.5 text-muted">
          <Wifi className="h-3.5 w-3.5" style={{ color: "var(--wa-green)" }} />
          Conectado{state.phone ? ` · +${state.phone}` : ""}
        </span>
        {isAdmin && (
          <button disabled={pending} onClick={() => run(whatsappDisconnectAction)} className="font-medium text-muted hover:text-danger">
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Desconectar"}
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="card relative overflow-hidden">
      {state.status === "conectado" && <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-success/10 blur-3xl" />}
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${TONE[state.status]}`}>
            <StatusIcon className={`h-5 w-5 ${state.status === "conectando" ? "animate-spin" : ""}`} />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">Status da conexão</p>
            <p className="text-lg font-semibold">{LABEL[state.status]}</p>
            {state.phone && state.status === "conectado" && <p className="text-sm text-muted">Número conectado: +{state.phone}</p>}
            {state.last_error && state.status !== "conectado" && <p className="text-sm text-warning">{state.last_error}</p>}
          </div>
        </div>
        {isAdmin ? (
          state.status === "desconectado" || state.status === "erro" ? (
            <button disabled={pending} onClick={() => run(whatsappConnectAction)} className="btn-primary">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />} Conectar WhatsApp
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              {state.status !== "conectado" && (
                <button disabled={pending} onClick={() => run(whatsappResetAction)} className="btn-primary" title="Apaga o pareamento incompleto e gera um QR code novo">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Gerar novo QR code
                </button>
              )}
              <button disabled={pending} onClick={() => run(whatsappDisconnectAction)} className="btn-secondary">
                <WifiOff className="h-4 w-4" /> Desconectar
              </button>
            </div>
          )
        ) : (
          <span className="chip"><Lock className="h-3 w-3" /> Somente administradores conectam o número</span>
        )}
      </div>
      {error && <p className="relative mt-3 text-sm text-danger">{error}</p>}
      {isAdmin && slow && state.status === "conectando" && (
        <p className="relative mt-3 rounded-xl bg-warning/10 p-3 text-sm text-warning">
          Está demorando para aparecer o QR code. Clique em <strong>Gerar novo QR code</strong>. Se continuar assim por mais de 2 minutos,
          o serviço de WhatsApp do servidor pode estar parado: fale com a CONNECTA.
        </p>
      )}
      {isAdmin && state.status === "aguardando_qr" && (
        <div className="relative mt-6 grid items-center gap-8 border-t border-line pt-6 md:grid-cols-[auto_1fr]">
          <div className="mx-auto rounded-2xl bg-white p-3 shadow-[0_0_48px_-8px_rgb(161_0_255/0.7)]">
            {qrSvg ? (
              <div className="h-64 w-64 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center text-sm text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin text-accent" />
              </div>
            )}
          </div>
          <div>
            <p className="flex items-center gap-2 font-semibold"><Smartphone className="h-4 w-4 text-accent" /> Conecte o celular da empresa</p>
            <ol className="mt-4 space-y-3 text-sm text-muted">
              {[
                "Abra o WhatsApp no celular da empresa.",
                "Toque em Mais opções (⋮) ou Configurações → Dispositivos conectados.",
                "Toque em Conectar um dispositivo e aponte a câmera para este QR code.",
                "O QR é renovado automaticamente. Mantenha esta tela aberta até conectar.",
              ].map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-semibold text-accent-strong">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
