import { redirect } from "next/navigation";
import { getTenantContext } from "@/server/context";
import { HttpError } from "@/server/errors";
import Link from "next/link";
import { NavLink } from "@/components/nav-link";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  let ctx;
  try {
    ctx = await getTenantContext();
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) {
      return (
        <main className="flex min-h-screen items-center justify-center p-6 text-center">
          <div>
            <h1 className="text-xl font-semibold">Sem acesso</h1>
            <p className="mt-2 text-slate-500">Seu usuário não está vinculado a nenhuma empresa.</p>
            <form action="/auth/signout" method="post" className="mt-4">
              <button className="btn-secondary">Sair</button>
            </form>
          </div>
        </main>
      );
    }
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 px-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-600">CONNECTA CRM</p>
          <p className="mt-1 truncate font-semibold" title={ctx.tenantName}>
            {ctx.tenantName}
          </p>
        </div>
        <nav className="space-y-1">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/contatos">Contatos</NavLink>
          <NavLink href="/funil">Funil</NavLink>
          <NavLink href="/tarefas">Tarefas</NavLink>
          <NavLink href="/whatsapp">WhatsApp</NavLink>
          <NavLink href="/configuracoes">Configurações</NavLink>
        </nav>
        <div className="mt-auto border-t border-slate-200 px-3 pt-4 text-sm">
          <p className="truncate font-medium">{ctx.displayName ?? "Usuário"}</p>
          <p className="text-xs text-slate-500">{ctx.role === "admin" ? "Administrador" : "Atendente"}</p>
          <form action="/auth/signout" method="post" className="mt-3">
            <button className="text-sm text-slate-500 hover:text-slate-800">Sair</button>
          </form>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 text-sm md:hidden">
          <span className="font-semibold">{ctx.tenantName}</span>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/contatos">Contatos</Link>
          <Link href="/funil">Funil</Link>
          <Link href="/tarefas">Tarefas</Link>
          <Link href="/whatsapp">WhatsApp</Link>
          <Link href="/configuracoes">Config.</Link>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
