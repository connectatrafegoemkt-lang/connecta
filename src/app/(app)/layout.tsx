import { redirect } from "next/navigation";
import { Building2, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { getTenantContext } from "@/server/context";
import { HttpError } from "@/server/errors";
import { MobileNav, SideNav } from "@/components/nav-link";
import { LogoMark, Wordmark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { currentTheme } from "@/lib/theme";

function initials(name: string | null) {
  if (!name) return "U";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  let ctx;
  try {
    ctx = await getTenantContext();
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6 text-center">
          <div className="card max-w-sm">
            <LogoMark size={72} className="mx-auto" />
            <h1 className="mt-4 text-xl font-semibold">Sem acesso</h1>
            <p className="mt-2 text-sm text-muted">Seu usuário não está vinculado a nenhuma empresa.</p>
            <form action="/auth/signout" method="post" className="mt-5">
              <button className="btn-secondary w-full">
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </form>
          </div>
        </main>
      );
    }
    redirect("/login");
  }

  const isAdmin = ctx.role === "admin";
  const theme = await currentTheme();

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface px-4 py-6 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <LogoMark size={40} />
          <div className="leading-tight">
            <Wordmark className="text-sm" />
            <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-accent">CRM</p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-2 rounded-xl border border-line bg-surface-2/70 px-3 py-2.5">
          <Building2 className="h-4 w-4 shrink-0 text-accent" />
          <span className="truncate text-sm font-medium" title={ctx.tenantName}>
            {ctx.tenantName}
          </span>
        </div>

        <div className="mt-6">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle">Menu</p>
          <SideNav />
        </div>

        <div className="mt-auto flex justify-center pb-3">
          <ThemeToggle initial={theme} />
        </div>
        <div className="rounded-2xl border border-line bg-surface-2/60 p-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-xs font-semibold text-white">
              {initials(ctx.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{ctx.displayName ?? "Usuário"}</p>
              <p className="flex items-center gap-1 text-xs text-muted">
                {isAdmin ? <ShieldCheck className="h-3 w-3 text-accent" /> : <UserRound className="h-3 w-3" />}
                {isAdmin ? "Administrador" : "Atendente"}
              </p>
            </div>
            <form action="/auth/signout" method="post">
              <button className="icon-btn" title="Sair" aria-label="Sair">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-page/85 px-3 pb-2 pt-3 backdrop-blur-xl md:hidden">
          <div className="mb-2 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <LogoMark size={34} />
              <span className="truncate text-sm font-semibold">{ctx.tenantName}</span>
            </div>
            <div className="flex items-center gap-1">
            <ThemeToggle initial={theme} compact />
            <form action="/auth/signout" method="post">
              <button className="icon-btn" aria-label="Sair">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
            </div>
          </div>
          <MobileNav />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
