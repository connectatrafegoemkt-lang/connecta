"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Lock, Mail, TriangleAlert } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error } = await supabaseBrowser().auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setLoading(false);
    if (error) {
      setError("E-mail ou senha inválidos.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="block">
        <span className="label">E-mail</span>
        <span className="relative block">
          <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input name="email" type="email" required autoComplete="email" placeholder="voce@empresa.com.br" className="input pl-10" />
        </span>
      </label>
      <label className="block">
        <span className="label">Senha</span>
        <span className="relative block">
          <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••••" className="input pl-10" />
        </span>
      </label>
      {error && (
        <p className="flex items-center gap-1.5 text-sm text-danger">
          <TriangleAlert className="h-4 w-4" /> {error}
        </p>
      )}
      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {loading ? "Entrando…" : "Entrar"}
        {!loading && <ArrowRight className="h-4 w-4" />}
      </button>
    </form>
  );
}
