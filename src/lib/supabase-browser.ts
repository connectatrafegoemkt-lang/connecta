"use client";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente do navegador: usado APENAS para login/logout e para assinar
 * eventos realtime. Ele usa a chave anon + JWT do usuário, então o RLS
 * se aplica a tudo que ele toca. Leituras/escritas de dados do CRM passam
 * pelo servidor (src/server/data).
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
