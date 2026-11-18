/**
 * A biblioteca de criptografia do WhatsApp (libsignal) imprime no console
 * sessões inteiras ("Closing session: SessionEntry { rootKey: <Buffer...> }").
 * Isso vazaria material de chave para os logs do servidor. Aqui essas
 * mensagens são descartadas; o resto do console segue normal.
 */
const SECRET_PREFIXES = ["Closing session", "Opening session", "Removing old closed session", "Migrating session", "Closing open session"];

export function isSignalNoise(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === "string" && SECRET_PREFIXES.some((p) => first.startsWith(p));
}

export function silenceSignalLogs(target: Pick<Console, "info" | "log" | "warn"> = console) {
  for (const method of ["info", "log", "warn"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      if (isSignalNoise(args)) return;
      original(...args);
    };
  }
}
