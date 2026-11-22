import { redirect } from "next/navigation";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { createUserClient } from "@/server/supabase/user-client";
import { needsPasswordChange } from "@/server/account";
import { ActionForm } from "@/components/action-form";
import { LogoMark } from "@/components/logo";
import { changePasswordAction } from "./actions";

export const metadata = { title: "Trocar senha" };

/**
 * Troca de senha. Obrigatória no primeiro acesso com a senha provisória
 * (o proxy manda para cá); também serve para trocar quando quiser.
 */
export default async function TrocarSenhaPage() {
  const sb = await createUserClient();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");
  const required = needsPasswordChange(data.user.app_metadata);

  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      <div className="card w-full max-w-md">
        <LogoMark size={56} className="mx-auto" />
        <h1 className="mt-4 text-center text-xl font-semibold">
          {required ? "Crie a sua senha pessoal" : "Trocar senha"}
        </h1>
        <p className="mt-2 text-center text-sm text-muted">
          {required
            ? "Você entrou com uma senha provisória. Para proteger os seus dados e os dos seus clientes, defina agora uma senha que só você conhece."
            : "Defina uma nova senha para a sua conta."}
        </p>
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-center text-xs text-muted">{data.user.email}</p>
        <ActionForm
          action={changePasswordAction}
          className="mt-5 space-y-3"
          submitLabel="Salvar nova senha"
          submitIcon={<ShieldCheck className="h-4 w-4" />}
          submitClassName="btn-primary w-full"
        >
          <label className="block">
            <span className="label">Nova senha (mínimo 10 caracteres)</span>
            <span className="relative block">
              <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <input name="senha" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className="input pl-10" />
            </span>
          </label>
          <label className="block">
            <span className="label">Repita a nova senha</span>
            <span className="relative block">
              <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <input name="confirmacao" type="password" required minLength={10} maxLength={200} autoComplete="new-password" className="input pl-10" />
            </span>
          </label>
        </ActionForm>
        {!required && (
          <p className="mt-4 text-center"><a href="/dashboard" className="btn-ghost btn-sm">Voltar ao CRM</a></p>
        )}
        <form action="/auth/signout" method="post" className="mt-2 text-center">
          <button className="btn-ghost btn-sm"><LogOut className="h-3.5 w-3.5" /> Sair</button>
        </form>
      </div>
    </main>
  );
}
