"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Recarrega a conversa quando chegam/saem mensagens. O Realtime aplica RLS,
 * então o navegador só recebe eventos de interações/fila do próprio tenant.
 */
export function LiveRefresh({ tenantId, contactId }: { tenantId: string; contactId: string | null }) {
  const router = useRouter();
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
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      sb.removeChannel(ch);
    };
  }, [tenantId, contactId, router]);
  return null;
}
