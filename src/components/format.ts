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
