/**
 * Decide o que fazer com a sessão de um tenant a cada ciclo do worker.
 * Cliente suspenso: a sessão é PAUSADA (socket fechado, sem logout), então
 * nada é recebido, enviado ou respondido pela IA; ao reativar, reconecta com
 * as credenciais guardadas, sem novo QR code.
 */
export type SessionAction = "start" | "logout" | "pause" | "none";

export function planSession(s: { desired: "conectado" | "desconectado"; suspended: boolean; running: boolean }): SessionAction {
  if (s.suspended) return s.running ? "pause" : "none";
  if (s.desired === "conectado" && !s.running) return "start";
  if (s.desired === "desconectado" && s.running) return "logout";
  return "none";
}
