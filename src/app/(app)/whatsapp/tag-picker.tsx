"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Tag } from "lucide-react";
import { TagBadge } from "@/components/tag-badge";
import { setContactTagsAction } from "../actions";

type T = { id: string; name: string; color: string };

/** Etiquetas da conversa (as mesmas tags do contato). */
export function TagPicker({ contactId, all, selected }: { contactId: string; all: T[]; selected: T[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState(() => new Set(selected.map((t) => t.id)));
  const [pending, start] = useTransition();

  const toggle = (id: string) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setIds(next);
    start(async () => {
      await setContactTagsAction(contactId, [...next]);
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {all.filter((t) => ids.has(t.id)).map((t) => <TagBadge key={t.id} {...t} />)}
        <button type="button" onClick={() => setOpen((v) => !v)} className="btn-ghost btn-sm" aria-expanded={open}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />} Etiquetas
        </button>
      </div>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-lg">
          {all.length === 0 && <p className="px-3 py-2 text-xs text-muted">Crie etiquetas em Configurações → Tags.</p>}
          {all.map((t) => (
            <button key={t.id} type="button" onClick={() => toggle(t.id)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="flex-1">{t.name}</span>
              {ids.has(t.id) && <Check className="h-4 w-4 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
