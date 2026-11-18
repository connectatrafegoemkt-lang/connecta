import { MessageCircle, ShieldCheck, SquareKanban } from "lucide-react";
import { LogoArt, LogoMark, Wordmark } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

const FEATURES = [
  { icon: SquareKanban, text: "Funil de vendas visual e editável" },
  { icon: MessageCircle, text: "WhatsApp integrado em tempo real" },
  { icon: ShieldCheck, text: "Dados da sua empresa isolados e protegidos" },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen gap-6 p-4 lg:grid-cols-2 lg:p-6">
      {/* Painel da marca: a arte original do logo é sobre preto */}
      <section className="relative hidden overflow-hidden rounded-3xl bg-[#07060b] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -left-32 top-1/3 h-[30rem] w-[30rem] rounded-full bg-brand-500/30 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-brand-500/20 blur-[100px]" />
        <div className="relative flex items-center gap-3">
          <LogoArt width={64} />
          <span className="font-semibold tracking-[0.22em]">CONNECTA</span>
        </div>
        <div className="relative">
          <LogoArt width={320} className="-ml-3" />
          <h2 className="mt-8 max-w-md text-4xl font-semibold leading-tight tracking-tight">
            <span className="bg-gradient-to-r from-white via-brand-200 to-brand-400 bg-clip-text text-transparent">Relacionamento que conecta</span> e converte.
          </h2>
          <ul className="mt-8 space-y-3">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/70">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-400/30 bg-brand-500/15 text-brand-300">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">© CONNECTA · Tráfego e Marketing</p>
      </section>

      <section className="flex items-center justify-center px-2 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <LogoMark size={84} />
            <Wordmark className="mt-3 text-base" />
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
