import { DisconnectReason } from "@whiskeysockets/baileys";

/**
 * O que fazer quando a conexão do WhatsApp cai.
 *
 * IMPORTANTE: o código 500 ("badSession") é o que a biblioteca usa para
 * QUALQUER erro de stream desconhecido — inclusive oscilações normais do
 * WhatsApp. Apagar o login nesse caso desconectava o número sozinho (pedia
 * QR de novo). Login só é apagado se o pareamento ainda não terminou.
 */
export function reconnectPolicy(o: { code: number | undefined; registered: boolean; failuresBeforeQr: number; retries: number }): {
  wipeAuth: boolean;
  waitMs: number;
} {
  const pairingStuck = !o.registered && (o.code === DisconnectReason.badSession || o.failuresBeforeQr >= 3);
  let waitMs = Math.min(30_000, 1000 * 2 ** Math.min(o.retries, 5));
  if (o.code === DisconnectReason.restartRequired) waitMs = 1000;
  // Outra conexão com o mesmo login assumiu: espera mais para não "brigar" com ela.
  if (o.code === DisconnectReason.connectionReplaced) waitMs = 60_000;
  return { wipeAuth: pairingStuck, waitMs };
}
