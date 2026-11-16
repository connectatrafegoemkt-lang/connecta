"use client";

import { useEffect, useState, useTransition } from "react";
import QRCode from "qrcode";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { whatsappConnectAction, whatsappDisconnectAction } from "../actions";

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
const COLOR: Record<Status, string> = {
  desconectado: "bg-slate-400",
  aguardando_qr: "bg-amber-400",
  conectando: "bg-sky-400",
  conectado: "bg-emerald-500",
  erro: "bg-red-500",
};

/**
 * Status e QR em tempo real. O QR chega por Realtime da tabela whatsapp_qr,
 * cujo RLS só entrega linhas ao ADMIN do próprio tenant.
 */
export function ConnectionPanel({ initial, isAdmin, tenantId }: { initial: State; isAdmin: boolean; tenantId: string }) {
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
      if (!r.error && fn === whatsappConnectAction) setState((s) => ({ ...s, status: s.status === "conectado" ? s.status : "conectando" }));
    });

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-semibold">
            <span className={`h-2.5 w-2.5 rounded-full ${COLOR[state.status]}`} />
            {LABEL[state.status]}
          </p>
          {state.phone && state.status === "conectado" && <p className="text-sm text-slate-500">Número: +{state.phone}</p>}
          {state.last_error && state.status !== "conectado" && <p className="text-sm text-amber-700">{state.last_error}</p>}
        </div>
        {isAdmin ? (
          <div className="flex gap-2">
            {state.status === "desconectado" || state.status === "erro" ? (
              <button disabled={pending} onClick={() => run(whatsappConnectAction)} className="btn-primary">
                Conectar WhatsApp
              </button>
            ) : (
              <button disabled={pending} onClick={() => run(whatsappDisconnectAction)} className="btn-secondary">
                Desconectar
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Somente administradores conectam o número.</p>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {isAdmin && state.status === "aguardando_qr" && (
        <div className="mt-6 flex flex-col items-center gap-3 md:flex-row md:items-start md:gap-8">
          {qrSvg ? (
            <div className="rounded-lg bg-white p-2 ring-1 ring-slate-200" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">Gerando QR…</div>
          )}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Abra o WhatsApp no celular da empresa.</li>
            <li>Toque em <strong>Mais opções</strong> → <strong>Dispositivos conectados</strong>.</li>
            <li>Toque em <strong>Conectar um dispositivo</strong> e aponte para este QR code.</li>
            <li>O QR é renovado automaticamente; mantenha esta tela aberta.</li>
          </ol>
        </div>
      )}
    </section>
  );
}
