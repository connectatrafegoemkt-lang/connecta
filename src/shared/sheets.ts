import { normalizeInstagram } from "./prospects";

/**
 * Google Sheets → Prospecção: leitura de uma planilha compartilhada por link.
 * Funções puras (testáveis): reconhecer o link, ler o CSV e converter as
 * linhas em leads.
 */

/** Extrai id e aba (gid) de um link do Google Sheets. */
export function parseSheetUrl(url: string): { sheetId: string; gid: string } | null {
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#].*)?$/.exec(url.trim());
  if (!m) return null;
  const gid = /[#?&]gid=([0-9]{1,15})/.exec(url)?.[1] ?? "0";
  return { sheetId: m[1]!, gid };
}

/** URL fixa de exportação em CSV (host e caminho montados aqui, nunca vindos do usuário). */
export function sheetCsvUrl(sheetId: string, gid: string): string {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(sheetId) || !/^[0-9]{1,15}$/.test(gid)) throw new Error("planilha inválida");
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

/** Leitor de CSV (RFC 4180): aspas, vírgulas e quebras de linha dentro de campos. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

type Field = "name" | "phone" | "email" | "company" | "city" | "niche" | "area" | "instagram" | "source" | "notes";

const HEADERS: Record<Field, string[]> = {
  name: ["nome", "name", "nome completo", "lead", "cliente", "contato", "responsavel", "advogado", "advogada"],
  phone: ["telefone", "whatsapp", "whats", "celular", "fone", "phone", "telefone whatsapp", "numero", "contato whatsapp", "tel"],
  email: ["email", "e mail", "mail"],
  company: ["empresa", "escritorio", "company", "razao social", "nome do escritorio", "negocio"],
  city: ["cidade", "city", "municipio", "cidade uf", "local"],
  niche: ["nicho", "segmento", "ramo"],
  area: ["area", "area de atuacao", "atuacao", "especialidade", "area do direito"],
  instagram: ["instagram", "insta", "perfil instagram", "ig"],
  source: ["origem", "fonte", "source", "canal"],
  notes: ["observacoes", "observacao", "obs", "notas", "notes", "anotacoes", "comentarios"],
};

/** Descobre qual coluna é qual pelo cabeçalho (1ª linha). */
export function mapHeader(header: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, names] of Object.entries(HEADERS) as [Field, string[]][]) {
      if (out[field] === undefined && names.includes(n)) out[field] = i;
    }
  });
  return out;
}

export interface SheetLead {
  key: string;
  name: string;
  area?: string;
  instagram?: string;
  phone?: string;
  email?: string;
  company?: string;
  city?: string;
  niche?: string;
  source?: string;
  notes?: string;
}

function instagramOf(v: string | undefined): string | undefined {
  try {
    return normalizeInstagram(v) ?? undefined;
  } catch {
    return undefined; // inválido: ignora o campo, a lead entra mesmo assim
  }
}

function phoneOf(v: string): string | undefined {
  let d = v.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^[0-9]{12,15}$/.test(d) ? d : undefined;
}

/**
 * Converte a planilha em leads. A chave de cada linha (para não importar
 * duas vezes) é o telefone; sem telefone, o e-mail; sem os dois, nome+empresa.
 */
export function sheetToLeads(csv: string): { leads: SheetLead[]; error?: string; skipped: number } {
  const rows = parseCsv(csv);
  if (rows.length === 0) return { leads: [], skipped: 0, error: "A planilha está vazia." };
  const cols = mapHeader(rows[0]!);
  if (cols.name === undefined) {
    return { leads: [], skipped: 0, error: 'Não achei a coluna "Nome" na primeira linha da planilha.' };
  }
  const get = (r: string[], f: Field, max: number) => {
    const i = cols[f];
    const v = i === undefined ? "" : (r[i] ?? "").trim();
    return v ? v.slice(0, max) : undefined;
  };
  const leads: SheetLead[] = [];
  const keys = new Set<string>();
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const name = get(r, "name", 200);
    if (!name) {
      skipped++;
      continue;
    }
    const rawPhone = get(r, "phone", 40);
    const phone = rawPhone ? phoneOf(rawPhone) : undefined;
    const emailRaw = get(r, "email", 320)?.toLowerCase();
    const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : undefined;
    const company = get(r, "company", 200);
    const key = phone ? `tel:${phone}` : email ? `email:${email}` : `nome:${norm(name)}|${norm(company ?? "")}`;
    if (keys.has(key)) {
      skipped++;
      continue;
    }
    keys.add(key);
    leads.push({
      key: key.slice(0, 300),
      name,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(company ? { company } : {}),
      ...(get(r, "city", 120) ? { city: get(r, "city", 120) } : {}),
      ...(get(r, "niche", 120) ? { niche: get(r, "niche", 120) } : {}),
      ...(get(r, "area", 120) ? { area: get(r, "area", 120) } : {}),
      ...(instagramOf(get(r, "instagram", 200)) ? { instagram: instagramOf(get(r, "instagram", 200)) } : {}),
      ...(get(r, "source", 120) ? { source: get(r, "source", 120) } : {}),
      ...(get(r, "notes", 5000) ? { notes: get(r, "notes", 5000) } : {}),
    });
  }
  return { leads, skipped };
}
