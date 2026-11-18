"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Atualiza o histórico em tempo real quando chega uma nova interação
 * (ex.: mensagem de WhatsApp). O Realtime aplica RLS: o navegador só
 * recebe eventos de linhas do próprio tenant.
 */
export function LiveTimeline({ contactId }: { contactId: string }) {
  const router = useRouter();
  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`contact-${contactId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "interactions", filter: `contact_id=eq.${contactId}` },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [contactId, router]);
  return null;
}
