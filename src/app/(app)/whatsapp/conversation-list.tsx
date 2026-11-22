"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, CheckCheck, Inbox, Search, Smartphone } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { listTime } from "@/components/format";

export interface ConversationItem {
  contact_id: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  last_at: string;
  last_body: string;
  last_direction: string;
  last_status: string | null;
  session_id?: string | null;
  tags: { id: string; name: string; color: string }[];
  href: string;
}

function Ticks({ status }: { status: string | null }) {
  if (status === "lido") return <CheckCheck className="h-4 w-4 shrink-0" style={{ color: "var(--wa-tick-read)" }} aria-label="lida" />;
  if (status === "entregue") return <CheckCheck className="h-4 w-4 shrink-0" aria-label="entregue" />;
  return <Check className="h-4 w-4 shrink-0" aria-label="enviada" />;
}

/** Lista de conversas no estilo WhatsApp, com busca instantânea. */
export function ConversationList({
  items,
  selectedId,
  tagLinks,
  numberLinks = [],
}: {
  items: ConversationItem[];
  selectedId: string | null;
  tagLinks: { id: string | null; name: string; color?: string; href: string; active: boolean }[];
  /** Filtro por número de WhatsApp (só quando o cliente tem mais de um). */
  numberLinks?: { id: string | null; name: string; href: string; active: boolean }[];
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    const digits = t.replace(/\D/g, "");
    return items.filter(
      (c) =>
        c.name.toLowerCase().includes(t) ||
        c.last_body.toLowerCase().includes(t) ||
        (digits.length >= 3 && (c.phone ?? "").includes(digits)),
    );
  }, [q, items]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 py-2">
        <label className="flex items-center gap-3 rounded-lg px-3 py-1.5" style={{ background: "var(--wa-panel)" }}>
          <Search className="h-4 w-4 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pesquisar ou começar uma nova conversa"
            className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-subtle"
            aria-label="Pesquisar conversas"
          />
        </label>
      </div>
      {numberLinks.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
          {numberLinks.map((n) => (
            <Link
              key={n.id ?? "todos"}
              href={n.href}
              className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition ${
                n.active ? "border-[var(--wa-green)] text-fg" : "border-line text-muted hover:text-fg"
              }`}
            >
              <Smartphone className="h-3 w-3" /> {n.name}
            </Link>
          ))}
        </div>
      )}
      {tagLinks.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
          {tagLinks.map((t) => (
            <Link
              key={t.id ?? "todas"}
              href={t.href}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                t.active ? "text-white" : "text-muted hover:text-fg"
              }`}
              style={{ background: t.active ? "var(--wa-green)" : "var(--wa-panel)" }}
            >
              {t.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />}
              {t.name}
            </Link>
          ))}
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {filtered.map((c) => {
          const active = c.contact_id === selectedId;
          return (
            <li key={c.contact_id}>
              <Link
                href={c.href}
                aria-current={active ? "true" : undefined}
                className="flex items-center gap-3 px-3 transition hover:bg-[var(--wa-active)]"
                style={active ? { background: "var(--wa-active)" } : undefined}
              >
                <Avatar name={c.name} url={c.avatar_url} size={49} />
                <span className="min-w-0 flex-1 border-b border-line/70 py-3">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[0.95rem] text-fg">{c.name}</span>
                    <span className="shrink-0 text-xs text-subtle">{listTime(c.last_at)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                    {c.last_direction === "saida" && <Ticks status={c.last_status} />}
                    <span className="truncate">{c.last_body}</span>
                  </span>
                  {c.tags.length > 0 && (
                    <span className="mt-1 flex gap-1">
                      {c.tags.slice(0, 3).map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium text-muted" style={{ background: "var(--wa-panel)" }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color }} /> {t.name}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted">
            <Inbox className="h-8 w-8 text-subtle" />
            {q ? "Nenhuma conversa encontrada." : "As conversas aparecem aqui quando chegarem mensagens."}
          </li>
        )}
      </ul>
    </div>
  );
}
