"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

const PENDING_POLL_MS = 2_500; // há mensagem "Enviando…": confere rápido até sair
const IDLE_POLL_MS = 15_000; // rede de segurança se o Realtime cair

/**
 * Mantém a conversa atualizada.
 * 1) Realtime (instantâneo): o RLS garante que o navegador só recebe eventos
 *    do próprio tenant.
 * 2) Conferência periódica (rede de segurança): mais rápida enquanto houver
 *    mensagem na fila, lenta no resto do tempo e só com a aba visível.
 * Se a assinatura Realtime falhar, o motivo vai para o log do servidor.
 */
export function LiveRefresh({ tenantId, contactId, pendingCount = 0 }: { tenantId: string; contactId: string | null; pendingCount?: number }) {
  const router = useRouter();
  const reported = useRef(false);

  useEffect(() => {
    const sb = supabaseBrowser();
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => router.refresh(), 150);
    };
    const ch = sb
      .channel(`wa-live-${tenantId}-${contactId ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "interactions", filter: `tenant_id=eq.${tenantId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_outbox", filter: `tenant_id=eq.${tenantId}` }, refresh)
      .subscribe((status, err) => {
        if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !reported.current) {
          reported.current = true;
          void fetch("/api/erro-cliente", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: `realtime ${status}: ${err?.message ?? ""}`.slice(0, 500), path: window.location.pathname.slice(0, 300) }),
            keepalive: true,
          }).catch(() => undefined);
        }
      });
    return () => {
      if (t) clearTimeout(t);
      void sb.removeChannel(ch);
    };
  }, [tenantId, contactId, router]);

  useEffect(() => {
    const every = pendingCount > 0 ? PENDING_POLL_MS : IDLE_POLL_MS;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, every);
    return () => clearInterval(id);
  }, [pendingCount, router]);

  return null;
}
