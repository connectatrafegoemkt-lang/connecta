/** Prospecção (leads ativas) da CONNECTA. */

export const PROSPECT_STATUS = ["novo", "contatado", "em_conversa", "reuniao", "proposta", "ganho", "perdido"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUS)[number];

export const STATUS_LABEL: Record<ProspectStatus, string> = {
  novo: "A contatar",
  contatado: "Contatado",
  em_conversa: "Em conversa",
  reuniao: "Reunião marcada",
  proposta: "Proposta enviada",
  ganho: "Virou cliente",
  perdido: "Perdido",
};
export const STATUS_COLOR: Record<ProspectStatus, string> = {
  novo: "#64748b",
  contatado: "#0ea5e9",
  em_conversa: "#6366f1",
  reuniao: "#a855f7",
  proposta: "#f59e0b",
  ganho: "#22c55e",
  perdido: "#ef4444",
};

export const ACTIVITY_TYPES = ["whatsapp", "ligacao", "email", "reuniao", "nota"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const ACTIVITY_LABEL: Record<ActivityType | "status", string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  email: "E-mail",
  reuniao: "Reunião",
  nota: "Anotação",
  status: "Etapa",
};

export const isOpen = (s: string) => s !== "ganho" && s !== "perdido";

export interface ImportRow {
  name: string;
  phone?: string;
  company?: string;
  city?: string;
  niche?: string;
  area?: string;
  instagram?: string;
  source?: string;
}

/**
 * Converte uma lista colada (uma lead por linha) em registros. Colunas
 * separadas por ";" ou TAB (cópia do Excel): nome; telefone; empresa;
 * cidade; nicho; área de atuação; instagram. Telefone com 10-11 dígitos
 * ganha o DDI 55.
 */
export function parseProspectList(text: string, source = "Lista importada"): { rows: ImportRow[]; errors: string[] } {
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const cols = line.split(/\t|;/).map((c) => c.trim());
    const [name, phoneRaw, company, city, niche, area, instaRaw] = cols;
    if (!name || /^nome$/i.test(name)) {
      if (!/^nome$/i.test(name ?? "")) errors.push(`Linha ${i + 1}: sem nome`);
      return;
    }
    let phone = (phoneRaw ?? "").replace(/\D/g, "");
    if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
    if (phone && !/^[0-9]{8,15}$/.test(phone)) {
      errors.push(`Linha ${i + 1}: telefone inválido (${phoneRaw})`);
      phone = "";
    }
    let insta: string | null = null;
    try {
      insta = normalizeInstagram(instaRaw);
    } catch {
      errors.push(`Linha ${i + 1}: Instagram inválido (${instaRaw})`);
    }
    rows.push({
      name: name.slice(0, 200),
      ...(phone ? { phone } : {}),
      ...(company ? { company: company.slice(0, 200) } : {}),
      ...(city ? { city: city.slice(0, 120) } : {}),
      ...(niche ? { niche: niche.slice(0, 120) } : {}),
      ...(area ? { area: area.slice(0, 120) } : {}),
      ...(insta ? { instagram: insta } : {}),
      source,
    });
  });
  return { rows, errors };
}

/**
 * Instagram da lead: aceita "@usuario", "usuario" ou o link do perfil e
 * devolve só o usuário (ou null se vazio). Lança erro se for inválido.
 */
export function normalizeInstagram(v: string | null | undefined): string | null {
  let t = (v ?? "").trim();
  if (!t) return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i.exec(t);
  if (m) t = m[1]!;
  t = t.replace(/^@+/, "").replace(/\/+$/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(t)) throw new Error("Instagram inválido (use @usuario ou o link do perfil)");
  return t;
}

export const instagramUrl = (handle: string) => `https://www.instagram.com/${encodeURIComponent(handle)}/`;
