"use client";

import { useState, useTransition } from "react";
import { ArrowDownUp, ChevronDown, ChevronUp, Loader2, Save } from "lucide-react";
import { reorderStagesAction } from "../actions";

/** Reordena as etapas do funil (somente admin). */
export function StageOrder({ stages }: { stages: { id: string; name: string; color: string }[] }) {
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
    <div className="rounded-xl border border-line bg-surface-2/40 p-4">
      <p className="flex items-center gap-2 text-sm font-medium"><ArrowDownUp className="h-4 w-4 text-brand-600" /> Ordem das etapas</p>
      <ol className="mt-3 space-y-1">
        {order.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-surface-2">
            <span className="w-5 text-xs tabular-nums text-subtle">{i + 1}</span>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="flex-1">{s.name}</span>
            <button type="button" onClick={() => move(i, -1)} className="icon-btn h-7 w-7" aria-label={`Subir ${s.name}`}><ChevronUp className="h-4 w-4" /></button>
            <button type="button" onClick={() => move(i, 1)} className="icon-btn h-7 w-7" aria-label={`Descer ${s.name}`}><ChevronDown className="h-4 w-4" /></button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await reorderStagesAction(order.map((s) => s.id));
              setMsg(r.error ?? "Ordem salva.");
            })
          }
          className="btn-secondary btn-sm"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Salvar ordem
        </button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </div>
  );
}
