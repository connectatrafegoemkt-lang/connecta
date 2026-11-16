"use client";

import { useState, useTransition } from "react";
import { reorderStagesAction } from "../actions";

/** Reordena as etapas do funil (somente admin). */
export function StageOrder({ stages }: { stages: { id: string; name: string }[] }) {
  const [order, setOrder] = useState(stages);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  return (
    <div className="mt-6 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-medium">Ordem das etapas</p>
      <ol className="mt-2 space-y-1">
        {order.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-slate-400">{i + 1}.</span>
            <span className="flex-1">{s.name}</span>
            <button type="button" onClick={() => move(i, -1)} className="btn-secondary px-2 py-0.5">↑</button>
            <button type="button" onClick={() => move(i, 1)} className="btn-secondary px-2 py-0.5">↓</button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await reorderStagesAction(order.map((s) => s.id));
            setMsg(r.error ?? "Ordem salva.");
          })
        }
        className="btn-secondary mt-3"
      >
        Salvar ordem
      </button>
      {msg && <span className="ml-3 text-sm text-slate-500">{msg}</span>}
    </div>
  );
}
