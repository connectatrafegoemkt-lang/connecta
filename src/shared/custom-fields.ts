import type { FieldType } from "./niches";

/** Campo extra da ficha do lead (definido por tenant em contact_fields). */
export interface ContactFieldDef {
  id?: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  position?: number;
}

export type CustomValue = string | number | boolean;
export type CustomValues = Record<string, CustomValue>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseNumber(v: string): number | null {
  // aceita "1.234,5", "1234.5" e "1234"
  const s = v.replace(/\s/g, "");
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : null;
}

/**
 * Valida os valores enviados contra os campos do tenant. Chaves
 * desconhecidas são ignoradas; valor vazio remove o campo. Os valores atuais
 * de campos não enviados (ou de campos já excluídos) são preservados.
 */
export function sanitizeCustomFields(
  defs: ContactFieldDef[],
  input: Record<string, unknown>,
  current: Record<string, unknown> = {},
): { values: CustomValues; errors: string[] } {
  const values: CustomValues = {};
  for (const [k, v] of Object.entries(current ?? {})) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") values[k] = v;
  }
  const errors: string[] = [];
  for (const def of defs) {
    if (!Object.prototype.hasOwnProperty.call(input, def.key)) continue;
    const raw = input[def.key];
    const str = raw === null || raw === undefined ? "" : typeof raw === "string" ? raw.trim() : String(raw);
    if (str === "") {
      delete values[def.key];
      continue;
    }
    switch (def.type) {
      case "texto":
        values[def.key] = str.slice(0, 1000);
        break;
      case "numero": {
        const n = typeof raw === "number" ? raw : parseNumber(str);
        if (n === null || !Number.isFinite(n)) errors.push(`${def.label}: número inválido`);
        else values[def.key] = n;
        break;
      }
      case "data":
        if (!DATE.test(str) || Number.isNaN(Date.parse(str))) errors.push(`${def.label}: data inválida`);
        else values[def.key] = str;
        break;
      case "opcoes":
        // aceita o valor já gravado (a opção pode ter saído da lista depois)
        if (!def.options.includes(str) && current?.[def.key] !== str) errors.push(`${def.label}: opção inválida`);
        else values[def.key] = str;
        break;
      case "sim_nao":
        if (raw === true || str === "sim" || str === "true") values[def.key] = true;
        else if (raw === false || str === "nao" || str === "false") values[def.key] = false;
        else errors.push(`${def.label}: use sim ou não`);
        break;
    }
  }
  return { values, errors };
}

/** Valor do campo para exibir (ou para preencher um input). */
export function displayCustomValue(def: ContactFieldDef, v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (def.type === "sim_nao") return v === true ? "Sim" : v === false ? "Não" : "";
  if (def.type === "data" && typeof v === "string" && DATE.test(v)) {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  if (def.type === "numero" && typeof v === "number") return v.toLocaleString("pt-BR");
  return String(v);
}

/** Gera a chave do campo a partir do nome ("Nº do processo" → "n_do_processo"). */
export function fieldKeyFrom(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return /^[a-z]/.test(base) ? base : `campo_${base}`.slice(0, 36).replace(/_+$/, "") || "campo";
}
