import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import { getPlatformContext } from "@/server/platform";
import { HttpError } from "@/server/errors";
import { LogoMark, Wordmark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { currentTheme } from "@/lib/theme";

export const metadata = { title: "Painel CONNECTA" };

export default async function PlataformaLayout({ children }: LayoutProps<"/plataforma">) {
  try {
    await getPlatformContext();
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) notFound();
    redirect("/login");
  }
  const theme = await currentTheme();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-page/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <div className="flex items-center gap-3">
            <LogoMark size={38} />
            <div className="leading-tight">
              <Wordmark className="text-sm" />
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-accent">
                <ShieldCheck className="h-3 w-3" /> Painel da plataforma
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="btn-ghost btn-sm hidden sm:inline-flex">
              <ArrowLeft className="h-4 w-4" /> Voltar ao CRM
            </Link>
            <Link href="/dashboard" className="icon-btn sm:hidden" title="Voltar ao CRM" aria-label="Voltar ao CRM">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <ThemeToggle initial={theme} compact />
            <form action="/auth/signout" method="post">
              <button className="icon-btn" title="Sair" aria-label="Sair">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl p-4 md:p-8">{children}</main>
    </div>
  );
}
