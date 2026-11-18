export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = () => new HttpError(401, "Não autenticado");
export const forbidden = (msg = "Sem permissão") => new HttpError(403, msg);
export const notFound = (msg = "Não encontrado") => new HttpError(404, msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);

interface PgLikeError {
  code?: string;
  message?: string;
}

/** Converte erros do PostgREST/Postgres em HttpError sem vazar detalhes internos. */
export function fromDbError(e: PgLikeError | null | undefined): HttpError {
  switch (e?.code) {
    case "PGRST116":
      return notFound();
    case "42501":
      return forbidden();
    case "23503":
      return badRequest("Referência inválida");
    case "23505":
      return new HttpError(409, "Registro duplicado");
    case "23514":
    case "22P02":
    case "23502":
      return badRequest("Dados inválidos");
    default:
      return new HttpError(500, "Erro interno");
  }
}
