"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
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
}

export function KanbanBoard({ stages, contacts }: { stages: Stage[]; contacts: Card[] }) {
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((s) => {
          const column = cards
            .filter((c) => c.stage_id === s.id)
            .sort((a, b) => a.stage_position - b.stage_position);
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
              className={`flex w-72 shrink-0 flex-col rounded-xl bg-slate-100 p-3 ${over === s.id ? "ring-2 ring-sky-400" : ""}`}
            >
              <header className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                  <span className="text-slate-400">{column.length}</span>
                </h2>
                <span className="text-xs tabular-nums text-slate-500">{brl(total)}</span>
              </header>
              <ul className="flex min-h-16 flex-col gap-2">
                {column.map((c, idx) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={() => setDragging(c.id)}
                    onDragEnd={() => setDragging(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      drop(s.id, idx);
                    }}
                    className={`cursor-grab rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 active:cursor-grabbing ${dragging === c.id ? "opacity-50" : ""}`}
                  >
                    <Link href={`/contatos/${c.id}`} className="text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                    {c.company && <p className="text-xs text-slate-500">{c.company}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <TagBadge key={t.id} {...t} />
                        ))}
                      </div>
                      {c.value_cents > 0 && <span className="text-xs tabular-nums text-slate-600">{brl(c.value_cents)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
