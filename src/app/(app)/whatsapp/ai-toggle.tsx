"use client";

import { useState, useTransition } from "react";
import { Bot, BotOff, Loader2, PauseCircle } from "lucide-react";
import { setContactAiAction } from "../actions";

/**
 * IA neste número: a IA só atende contatos em que alguém ativou aqui.
 * "Em pausa" = ativada, mas um humano respondeu há pouco (volta sozinha).
 */
export function AiToggle({ contactId, active: initial, paused = false, compact = false }: { contactId: string; active: boolean; paused?: boolean; compact?: boolean }) {
  const [active, setActive] = useState(initial);
  const [isPaused, setPaused] = useState(paused);
  const [pending, start] = useTransition();
  const Icon = pending ? Loader2 : !active ? BotOff : isPaused ? PauseCircle : Bot;
  const label = !active ? "Ativar IA neste número" : isPaused ? "IA em pausa (você respondeu)" : "IA atendendo este número";
  const onClick = () =>
    start(async () => {
      const r = await setContactAiAction(contactId, !active);
      if (r.ok) {
        setActive(!active);
        setPaused(false);
      }
    });
  if (compact) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        title={`${label}. ${active ? "Clique para a IA parar de atender este número." : "Clique para a IA passar a atender este número."}`}
        aria-label={label}
        aria-pressed={active}
        className="icon-btn h-10 w-10"
        style={active ? { color: isPaused ? "var(--color-warning)" : "var(--wa-green)" } : undefined}
      >
        <Icon className={`h-5 w-5 ${pending ? "animate-spin" : ""}`} />
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setContactAiAction(contactId, !active);
          if (r.ok) {
            setActive(!active);
            setPaused(false);
          }
        })
      }
      title={active ? "Clique para a IA parar de atender este número" : "Clique para a IA passar a atender este número"}
      className={`btn-sm inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        active ? "border-brand-500/40 bg-accent-soft text-accent-strong" : "border-line text-muted hover:text-fg"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
      {label}
    </button>
  );
}
