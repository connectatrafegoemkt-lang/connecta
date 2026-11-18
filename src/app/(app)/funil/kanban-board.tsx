"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { Building2, GripVertical, Inbox, TriangleAlert, Trophy, Ban } from "lucide-react";
import { moveContactAction } from "../actions";
import { brl } from "@/components/format";
import { TagBadge } from "@/components/tag-badge";

interface Card {
  id: string;
  name: string;
  company: string | null;
  value_cents: number;
  stage_id: string | null;
  stage_position: number;
  tags: { id: string; name: string; color: string }[];
}
interface Stage {
  id: string;
  name: string;
  color: string;
  is_won?: boolean;
  is_lost?: boolean;
}

export function KanbanBoard({ stages, contacts, readOnly = false }: { stages: Stage[]; contacts: Card[]; readOnly?: boolean }) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [cards, applyMove] = useOptimistic(contacts, (state, m: { id: string; stage: string; pos: number }) => {
    const moved = state.find((c) => c.id === m.id);
    if (!moved) return state;
    const rest = state.filter((c) => c.id !== m.id);
    const column = rest.filter((c) => c.stage_id === m.stage).sort((a, b) => a.stage_position - b.stage_position);
    column.splice(m.pos, 0, { ...moved, stage_id: m.stage });
    const reindexed = new Map(column.map((c, i) => [c.id, { ...c, stage_position: i }]));
    return [...rest.filter((c) => c.stage_id !== m.stage), ...reindexed.values()];
  });

  function drop(stageId: string, pos: number) {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;
    startTransition(async () => {
      applyMove({ id, stage: stageId, pos });
      const r = await moveContactAction(id, stageId, pos);
      setError(r.error ?? null);
    });
  }

  return (
    <>
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-danger">
          <TriangleAlert className="h-4 w-4" /> {error}
        </p>
      )}
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
        {stages.map((s) => {
          const column = cards.filter((c) => c.stage_id === s.id).sort((a, b) => a.stage_position - b.stage_position);
          const total = column.reduce((acc, c) => acc + c.value_cents, 0);
          return (
            <section
              key={s.id}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s.id);
              }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(s.id, column.length);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-2xl border bg-surface-2/70 p-3 transition ${
                over === s.id ? "border-brand-500/60 shadow-[0_0_0_1px_rgb(161_0_255/0.3),0_0_32px_-8px_rgb(161_0_255/0.6)]" : "border-line"
              }`}
            >
              <div className="mb-3 h-1 rounded-full" style={{ backgroundColor: s.color }} />
              <header className="mb-3 flex items-center justify-between px-1">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  {s.is_won ? <Trophy className="h-4 w-4 text-success" /> : s.is_lost ? <Ban className="h-4 w-4 text-danger" /> : <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />}
                  {s.name}
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">{column.length}</span>
                </h2>
                <span className="text-xs tabular-nums text-muted">{brl(total)}</span>
              </header>
              <ul className="flex min-h-24 flex-1 flex-col gap-2">
                {column.map((c, idx) => (
                  <li
                    key={c.id}
                    draggable={!readOnly}
                    onDragStart={() => setDragging(c.id)}
                    onDragEnd={() => setDragging(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      drop(s.id, idx);
                    }}
                    className={`group cursor-grab rounded-xl border border-line bg-surface p-3 shadow-sm transition hover:border-brand-500/40 hover:shadow-md active:cursor-grabbing ${dragging === c.id ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/contatos/${c.id}`} className="text-sm font-medium text-fg hover:text-accent-strong">
                        {c.name}
                      </Link>
                      <GripVertical className="h-4 w-4 shrink-0 text-subtle opacity-0 transition group-hover:opacity-100" />
                    </div>
                    {c.company && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                        <Building2 className="h-3 w-3" /> {c.company}
                      </p>
                    )}
                    {(c.tags.length > 0 || c.value_cents > 0) && (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1">
                          {c.tags.slice(0, 3).map((t) => (
                            <TagBadge key={t.id} {...t} />
                          ))}
                        </div>
                        {c.value_cents > 0 && <span className="text-xs font-medium tabular-nums text-accent-strong">{brl(c.value_cents)}</span>}
                      </div>
                    )}
                  </li>
                ))}
                {column.length === 0 && (
                  <li className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line py-6 text-xs text-subtle">
                    <Inbox className="h-4 w-4" /> Solte um card aqui
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
