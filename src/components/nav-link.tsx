"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  LayoutDashboard,
  ListTodo,
  MessageCircle,
  Settings,
  SquareKanban,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

export const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/contatos", label: "Contatos", icon: Users },
  { href: "/funil", label: "Funil", icon: SquareKanban },
  { href: "/tarefas", label: "Tarefas", icon: ListTodo },
  { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
  { href: "/atendimento-ia", label: "Atendimento IA", icon: Bot },
  { href: "/equipe", label: "Equipe", icon: UserCog },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

function useActive(href: string) {
  const path = usePathname();
  return path === href || path.startsWith(`${href}/`);
}

export function SideNavLink({ href, label, icon: Icon }: (typeof NAV)[number]) {
  const active = useActive(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "bg-gradient-to-r from-brand-500/20 to-brand-500/5 text-fg"
          : "text-muted hover:bg-surface-2 hover:text-fg"
      }`}
    >
      {active && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand-500 shadow-[0_0_12px_rgb(161_0_255)]" />}
      <Icon className={`h-[18px] w-[18px] ${active ? "text-accent" : "text-subtle group-hover:text-accent"}`} />
      {label}
    </Link>
  );
}

export function MobileNavLink({ href, label, icon: Icon }: (typeof NAV)[number]) {
  const active = useActive(href);
  return (
    <Link
      href={href}
      className={`flex shrink-0 flex-col items-center gap-1 rounded-xl px-3 py-2 text-[11px] font-medium ${
        active ? "bg-brand-500/15 text-accent-strong" : "text-muted"
      }`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </Link>
  );
}

/** `allowed`: hrefs que o usuário pode ver (calculado no servidor pelas permissões). */
export function SideNav({ allowed }: { allowed: string[] }) {
  return (
    <nav className="space-y-1">
      {NAV.filter((i) => allowed.includes(i.href)).map((item) => (
        <SideNavLink key={item.href} {...item} />
      ))}
    </nav>
  );
}

export function MobileNav({ allowed }: { allowed: string[] }) {
  return (
    <nav className="flex gap-1 overflow-x-auto">
      {NAV.filter((i) => allowed.includes(i.href)).map((item) => (
        <MobileNavLink key={item.href} {...item} />
      ))}
    </nav>
  );
}
