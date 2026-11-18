import { MessageCircle, ShieldCheck, SquareKanban } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

const FEATURES = [
  { icon: SquareKanban, text: "Funil de vendas visual e editável" },
  { icon: MessageCircle, text: "WhatsApp integrado em tempo real" },
  { icon: ShieldCheck, text: "Dados da sua empresa isolados e protegidos" },
];

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-40 top-1/3 h-[32rem] w-[32rem] rounded-full bg-brand-500/25 blur-[120px]" />
        <div className="relative flex items-center gap-3">
          <LogoMark size={56} />
          <Wordmark className="text-lg" />
        </div>
        <div className="relative">
          <LogoMark size={340} className="-ml-4 opacity-95" />
          <h2 className="mt-8 max-w-md text-4xl font-semibold leading-tight tracking-tight">
            <span className="text-gradient">Relacionamento que conecta</span> e converte.
          </h2>
          <ul className="mt-8 space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-muted">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-subtle">© CONNECTA · Tráfego e Marketing</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <LogoMark size={120} />
            <Wordmark className="mt-2 text-base" />
          </div>
          <div className="card p-8">
            <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h1>
            <p className="mt-1 text-sm text-muted">Entre com o acesso da sua empresa.</p>
            <LoginForm />
          </div>
          <p className="mt-6 text-center text-xs text-subtle">Problemas para entrar? Fale com a CONNECTA.</p>
        </div>
      </section>
    </main>
  );
}
