import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar — CONNECTA CRM" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-semibold tracking-tight">CONNECTA CRM</h1>
        <p className="mt-1 text-sm text-slate-500">Entre com o acesso da sua empresa.</p>
        <LoginForm />
      </div>
    </main>
  );
}
