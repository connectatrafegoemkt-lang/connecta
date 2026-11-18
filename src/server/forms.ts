import "server-only";
import { z } from "zod";
import { HttpError } from "./errors";

export type ActionState = { ok?: boolean; error?: string | null; message?: string | null };

/**
 * Extrai do FormData SOMENTE os campos listados (qualquer outro campo —
 * inclusive tenant_id — é ignorado) e valida com o schema estrito.
 */
export function pick(fd: FormData, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k.endsWith("[]")) {
      out[k.slice(0, -2)] = fd.getAll(k).map(String).filter(Boolean);
    } else if (fd.has(k)) {
      out[k] = String(fd.get(k) ?? "");
    }
  }
  return out;
}

export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new HttpError(400, first ? `${first.path.join(".") || "campo"}: ${first.message}` : "Dados inválidos");
  }
  return r.data;
}

export function toActionError(e: unknown): ActionState {
  if (e instanceof HttpError) return { ok: false, error: e.message };
  // redirect()/notFound() do Next precisam continuar propagando
  throw e;
}

/** Converte "datetime-local" (sem fuso) para ISO com o fuso de Brasília. */
export function localToIso(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(v)) return v;
  return new Date(`${v}:00-03:00`).toISOString();
}

export function reaisToCents(v: unknown): number | undefined {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}
