export const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const dateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" })
    : "—";

/** Valor para <input type="datetime-local"> em horário de Brasília. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
};

export const phoneFmt = (p: string | null) => {
  if (!p) return "—";
  const m = /^(\d{2})(\d{2})(\d{4,5})(\d{4})$/.exec(p);
  return m ? `+${m[1]} (${m[2]}) ${m[3]}-${m[4]}` : `+${p}`;
};

export const interactionLabel: Record<string, string> = {
  nota: "Nota",
  ligacao: "Ligação",
  email: "E-mail",
  reuniao: "Reunião",
  whatsapp: "WhatsApp",
};

const TZ = "America/Sao_Paulo";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ }); // AAAA-MM-DD

/** Hora curta (HH:MM) em Brasília, como no balão do WhatsApp. */
export const timeOnly = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "";

/** "Hoje", "Ontem" ou a data (separadores da conversa). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const k = dayKey(d);
  if (k === dayKey(now)) return "Hoje";
  if (k === dayKey(new Date(now.getTime() - 86_400_000))) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
}

export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));

/** Horário na lista de conversas: hora se hoje, "Ontem" ou a data. */
export function listTime(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "";
  const l = dayLabel(iso, now);
  return l === "Hoje" ? timeOnly(iso) : l;
}
