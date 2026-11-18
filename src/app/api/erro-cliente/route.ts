import type { NextRequest } from "next/server";
import { z } from "zod";

/**
 * Recebe erros que aconteceram NO NAVEGADOR (tela de erro do app) e grava
 * nos logs do servidor, para diagnóstico (`docker compose logs app`).
 * Não grava dados de negócio: só mensagem, código e caminho, com limite de
 * tamanho. Não exige login (o erro pode ser justamente na sessão).
 */
const schema = z.strictObject({
  message: z.string().max(500),
  digest: z.string().max(100).optional(),
  stack: z.string().max(2000).optional(),
  path: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  const text = await req.text().catch(() => "");
  if (text.length > 4000) return new Response(null, { status: 413 });
  let parsed;
  try {
    parsed = schema.safeParse(JSON.parse(text));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!parsed.success) return new Response(null, { status: 400 });
  const e = parsed.data;
  console.error(
    "[erro-no-navegador]",
    JSON.stringify({ path: e.path, message: e.message, digest: e.digest, stack: e.stack?.split("\n").slice(0, 8).join(" | ") }),
  );
  return new Response(null, { status: 204 });
}
