import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getTenantContext, type TenantContext } from "./context";
import { badRequest, HttpError } from "./errors";

const FORBIDDEN_KEYS = ["tenant_id", "tenantid", "tenant"];

/**
 * Rejeita QUALQUER tentativa do cliente de indicar o tenant
 * (query string, header ou corpo). O tenant vem só da sessão.
 */
export function assertNoClientTenant(req: NextRequest, body?: unknown) {
  for (const key of req.nextUrl.searchParams.keys()) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) throw badRequest("tenant_id não é aceito do cliente");
  }
  for (const key of req.headers.keys()) {
    if (/^x-tenant/i.test(key)) throw badRequest("tenant_id não é aceito do cliente");
  }
  const scan = (v: unknown, depth = 0): void => {
    if (depth > 5 || v === null || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.includes(k.toLowerCase())) throw badRequest("tenant_id não é aceito do cliente");
      scan(val, depth + 1);
    }
  };
  scan(body);
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("JSON inválido");
  }
  assertNoClientTenant(req, body);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest("Dados inválidos", z.flattenError(parsed.error));
  return parsed.data;
}

export function readQuery<T extends z.ZodType>(req: NextRequest, schema: T): z.infer<T> {
  const obj = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = schema.safeParse(obj);
  if (!parsed.success) throw badRequest("Parâmetros inválidos", z.flattenError(parsed.error));
  return parsed.data;
}

export function parseId(id: string): string {
  const r = z.uuid().safeParse(id);
  if (!r.success) throw new HttpError(404, "Não encontrado");
  return r.data;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message, details: e.details }, { status: e.status });
  }
  console.error("[api] erro inesperado", e);
  return Response.json({ error: "Erro interno" }, { status: 500 });
}

type Handler<P> = (req: NextRequest, ctx: TenantContext, params: P) => Promise<unknown>;

/**
 * Envolve um Route Handler: resolve o tenant pela sessão, bloqueia tenant
 * vindo do cliente e padroniza erros.
 */
export function withTenant<P = Record<string, never>>(fn: Handler<P>) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    try {
      assertNoClientTenant(req);
      const ctx = await getTenantContext();
      const params = (await route?.params) ?? ({} as P);
      const out = await fn(req, ctx, params);
      if (out instanceof Response) return out;
      if (out === undefined) return new Response(null, { status: 204 });
      return Response.json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
