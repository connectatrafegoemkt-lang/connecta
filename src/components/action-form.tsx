"use client";

import { useActionState, useEffect, useRef } from "react";
import { CircleCheck, Loader2, TriangleAlert } from "lucide-react";

export type ActionState = { ok?: boolean; error?: string | null; message?: string | null };
type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

/** Formulário ligado a uma Server Action, com mensagens de erro/sucesso. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  submitLabel,
  submitIcon,
  submitClassName = "btn-primary",
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  submitLabel?: string;
  submitIcon?: React.ReactNode;
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
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : submitIcon}
          {pending ? "Salvando…" : submitLabel}
        </button>
      )}
      {state.error && (
        <p className="flex items-center gap-1.5 text-sm text-danger">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <CircleCheck className="h-4 w-4 shrink-0" />
          {state.message}
        </p>
      )}
    </form>
  );
}
