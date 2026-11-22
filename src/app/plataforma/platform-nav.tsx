"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, Target } from "lucide-react";

const ITEMS = [
  { href: "/plataforma", label: "Clientes", icon: Building2, exact: true },
  { href: "/plataforma/relatorios", label: "Relatórios mensais", icon: BarChart3 },
  { href: "/plataforma/prospeccao", label: "Prospecção", icon: Target },
];

export function PlatformNav() {
  const path = usePathname();
  return (
    <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-2 md:px-8 print:hidden">
      {ITEMS.map((it) => {
        const active = it.exact ? path === it.href : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active ? "bg-brand-500/15 text-accent-strong" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <it.icon className="h-4 w-4" /> {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
