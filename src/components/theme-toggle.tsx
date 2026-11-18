"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "light" | "dark";

function applyTheme(next: Theme) {
  document.documentElement.setAttribute("data-theme", next);
  document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
}

/** Alterna entre fundo claro e escuro; a escolha fica salva num cookie (1 ano). */
export function ThemeToggle({ initial, compact = false }: { initial: Theme; compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>(initial);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Claro", icon: Sun },
    { value: "dark", label: "Escuro", icon: Moon },
  ];

  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-xl border border-line bg-surface-2 p-1">
      {options.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={`Tema ${label.toLowerCase()}`}
            onClick={() => choose(value)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
              active ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg"
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${active ? "text-accent" : ""}`} />
            {!compact && label}
          </button>
        );
      })}
    </div>
  );
}
