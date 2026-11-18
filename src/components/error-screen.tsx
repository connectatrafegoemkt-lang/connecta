"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert, ArrowLeft } from "lucide-react";

/** Erros típicos de aba aberta numa versão antiga do sistema (depois de uma atualização). */
export function isStaleVersionError(message: string) {
  return /Server Action|Failed to find|ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|deployment/i.test(message);
}

const RELOAD_KEY = "connecta:recarregou-versao";

/** Tela de erro em português: grava o erro no servidor e, se for versão antiga, recarrega sozinha. */
export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  const message = error?.message || "Erro desconhecido";
  const stale = isStaleVersionError(message);

  useEffect(() => {
    const payload = {
      message: message.slice(0, 500),
      digest: error?.digest?.slice(0, 100),
      stack: error?.stack?.slice(0, 2000),
      path: window.location.pathname.slice(0, 300),
    };
    void fetch("/api/erro-cliente", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);

    if (stale) {
      // Aba aberta antes de uma atualização: recarrega uma vez para pegar a versão nova.
      try {
        if (!sessionStorage.getItem(RELOAD_KEY)) {
          sessionStorage.setItem(RELOAD_KEY, "1");
          window.location.reload();
        }
      } catch {
        /* sem sessionStorage: só mostra a tela */
      }
    }
  }, [error, message, stale]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="card max-w-md text-center">
        <TriangleAlert className="mx-auto h-10 w-10 text-warning" />
        <h1 className="mt-3 text-lg font-semibold">
          {stale ? "O sistema foi atualizado" : "Não foi possível carregar esta tela"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {stale
            ? "Esta aba estava com a versão anterior. Recarregue para usar a versão nova."
            : "O erro foi registrado para a equipe da CONNECTA. Tente recarregar a página."}
        </p>
        <p className="mt-3 break-words rounded-lg bg-surface-2 px-3 py-2 text-left font-mono text-xs text-subtle">
          {message.slice(0, 300)}
          {error?.digest ? ` (código ${error.digest})` : ""}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            <RotateCw className="h-4 w-4" /> Recarregar página
          </button>
          {reset && (
            <button type="button" className="btn-secondary" onClick={() => history.back()}>
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
