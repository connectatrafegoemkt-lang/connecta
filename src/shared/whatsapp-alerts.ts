/**
 * Quando avisar que um número de WhatsApp caiu.
 *
 * Quedas curtas (ex.: reinício na atualização do sistema, oscilação) se
 * resolvem sozinhas em segundos; só avisamos se o número continuar fora do
 * ar por mais de GRACE_MS. Número desligado de propósito (botão
 * "Desconectar") não gera aviso.
 */
export const GRACE_MS = 90_000;

export interface AlertNumber {
  id: string;
  label: string;
  status: string;
  desired_state: string;
  last_error: string | null;
}

/** O número deveria estar no ar mas não está? */
export function isDown(n: AlertNumber): boolean {
  if (n.status === "conectado") return false;
  // desligado de propósito pelo usuário: sem aviso
  if (n.desired_state !== "conectado" && !n.last_error) return false;
  return true;
}

/**
 * Atualiza "desde quando cada número está fora" e devolve os que já passaram
 * da tolerância. `since` é mutado (id → primeira vez visto fora do ar).
 */
export function downNumbers(nums: AlertNumber[], since: Map<string, number>, now: number, grace = GRACE_MS): AlertNumber[] {
  const out: AlertNumber[] = [];
  const present = new Set<string>();
  for (const n of nums) {
    present.add(n.id);
    if (!isDown(n)) {
      since.delete(n.id);
      continue;
    }
    if (!since.has(n.id)) since.set(n.id, now);
    if (now - since.get(n.id)! >= grace) out.push(n);
  }
  for (const id of [...since.keys()]) if (!present.has(id)) since.delete(id);
  return out;
}

/** Texto curto do motivo, para o aviso. */
export function downReason(n: AlertNumber): string {
  if (n.last_error) return n.last_error;
  if (n.status === "aguardando_qr") return "Precisa ler o QR code de novo.";
  if (n.status === "erro") return "Erro na conexão.";
  if (n.status === "desconectado") return "Desconectado.";
  return "Sem conexão no momento, tentando reconectar.";
}
