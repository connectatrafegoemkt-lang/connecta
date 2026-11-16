"use client";

import { useActionState, useEffect, useRef } from "react";

export type ActionState = { ok?: boolean; error?: string | null; message?: string | null };
type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

/** Formulário ligado a uma Server Action, com mensagens de erro/sucesso. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  submitLabel,
  submitClassName = "btn-primary",
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  submitLabel?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {submitLabel && (
        <button type="submit" disabled={pending} className={submitClassName}>
          {pending ? "Salvando…" : submitLabel}
        </button>
      )}
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && state.message && <p className="text-sm text-emerald-600">{state.message}</p>}
    </form>
  );
}
