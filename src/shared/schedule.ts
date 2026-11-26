/**
 * Agendamento "em sequência": cada nova mensagem vai para X minutos depois
 * da última que já está agendada (ex.: 11:40 → 11:50 → 12:00). Espaçar os
 * envios evita disparos em rajada (risco de bloqueio no WhatsApp).
 */
export const INTERVAL_PRESETS = [5, 10, 15, 30] as const;
export const INTERVAL_MIN = 1;
export const INTERVAL_MAX = 240;

/** Minutos válidos (inteiro de 1 a 240) ou null. */
export function parseInterval(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= INTERVAL_MIN && n <= INTERVAL_MAX ? n : null;
}

/**
 * Próximo horário da sequência: última agendada + intervalo. Se não houver
 * nenhuma agendada no futuro, conta a partir de agora. Arredonda para o
 * minuto cheio seguinte.
 */
export function sequenceSlot(lastIso: string | null, minutes: number, now: number = Date.now()): string {
  const last = lastIso ? Date.parse(lastIso) : NaN;
  const base = Number.isFinite(last) && last > now ? last : now;
  const t = base + minutes * 60_000;
  return new Date(Math.ceil(t / 60_000) * 60_000).toISOString();
}

/** "26/11 11:50" no horário de Brasília. */
export function brDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
