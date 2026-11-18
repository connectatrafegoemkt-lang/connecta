"use client";

import { useState, useTransition } from "react";
import { Bot, BotOff, Loader2 } from "lucide-react";
import { setContactAiAction } from "../actions";

/** Liga/pausa a IA nesta conversa. */
export function AiToggle({ contactId, active: initial }: { contactId: string; active: boolean }) {
  const [active, setActive] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setContactAiAction(contactId, !active);
          if (r.ok) setActive(!active);
        })
      }
      title={active ? "Pausar a IA nesta conversa" : "Reativar a IA nesta conversa"}
      className={`btn-sm inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        active ? "border-brand-500/40 bg-accent-soft text-accent-strong" : "border-line text-muted hover:text-fg"
      }`}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : active ? <Bot className="h-3.5 w-3.5" /> : <BotOff className="h-3.5 w-3.5" />}
      {active ? "IA ativa" : "IA pausada"}
    </button>
  );
}
