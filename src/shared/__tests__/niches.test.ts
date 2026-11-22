import { describe, expect, it } from "vitest";
import { aiSettingsSchema, DEFAULT_AI_SETTINGS } from "@/shared/ai/settings";
import { buildNicheSetup, NICHE_KEYS, NICHES, type Answers, type NicheKey } from "@/shared/niches";
import { fieldKeyFrom, sanitizeCustomFields, type ContactFieldDef } from "@/shared/custom-fields";

const HEX = /^#[0-9a-fA-F]{6}$/;

function allAnswers(n: NicheKey, mode: "todas" | "nenhuma"): Answers {
  const a: Answers = {};
  for (const q of NICHES[n].questions) {
    if (q.type === "multi") a[q.id] = mode === "todas" ? q.options!.map((o) => o.value) : [];
    else if (q.type === "single") a[q.id] = mode === "todas" ? "sim" : "nao";
    else a[q.id] = mode === "todas" ? "x".repeat(2000) : "";
  }
  return a;
}

function uniqueLower(xs: string[]) {
  return new Set(xs.map((x) => x.toLowerCase().trim())).size === xs.length;
}

describe("modelos de nicho respeitam as restrições do banco", () => {
  for (const n of NICHE_KEYS) {
    for (const mode of ["todas", "nenhuma"] as const) {
      it(`${n} (${mode} as opções)`, () => {
        const s = NICHES[n].build(allAnswers(n, mode), "Empresa Teste");
        expect(s.stages.length).toBeGreaterThanOrEqual(3);
        expect(s.stages.length).toBeLessThanOrEqual(20);
        expect(s.stages.filter((x) => x.is_won)).toHaveLength(1);
        expect(s.stages.filter((x) => x.is_lost)).toHaveLength(1);
        for (const st of s.stages) {
          expect(st.name.length).toBeLessThanOrEqual(80);
          expect(st.color).toMatch(HEX);
        }
        expect(uniqueLower(s.stages.map((x) => x.name))).toBe(true);

        expect(s.tags.length).toBeLessThanOrEqual(60);
        for (const t of s.tags) {
          expect(t.name.trim().length).toBeGreaterThan(0);
          expect(t.name.length).toBeLessThanOrEqual(50);
          expect(t.color).toMatch(HEX);
        }
        expect(uniqueLower(s.tags.map((x) => x.name))).toBe(true);

        expect(s.quick_replies.length).toBeLessThanOrEqual(40);
        for (const q of s.quick_replies) {
          expect(q.shortcut).toMatch(/^[a-z0-9][a-z0-9_-]{0,29}$/);
          expect(q.title.length).toBeLessThanOrEqual(80);
          expect(q.body.length).toBeLessThanOrEqual(4096);
        }
        expect(uniqueLower(s.quick_replies.map((x) => x.shortcut))).toBe(true);

        for (const d of s.departments) {
          expect(d.name.length).toBeLessThanOrEqual(60);
          expect(d.color).toMatch(HEX);
        }
        expect(uniqueLower(s.departments.map((x) => x.name))).toBe(true);

        for (const f of s.contact_fields) {
          expect(f.key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
          expect(f.label.length).toBeLessThanOrEqual(60);
          if (f.type === "opcoes") {
            expect(f.options!.length).toBeGreaterThan(0);
            expect(f.options!.length).toBeLessThanOrEqual(30);
          }
        }
        expect(uniqueLower(s.contact_fields.map((x) => x.key))).toBe(true);

        // As instruções da IA passam pela mesma validação da tela de IA.
        const ai = aiSettingsSchema.safeParse({ ...DEFAULT_AI_SETTINGS, ...s.ai });
        expect(ai.success, JSON.stringify(ai.error?.issues)).toBe(true);
      });
    }
  }

  it("respostas desconhecidas são ignoradas (o servidor só usa opções do modelo)", () => {
    const s = NICHES.advocacia.build({ areas: ["trabalhista", "<script>", "inexistente"] }, "X");
    expect(s.tags.map((t) => t.name)).toContain("Trabalhista");
    expect(s.tags.map((t) => t.name).join()).not.toContain("script");
  });

  it("setores só são criados quando a pessoa pede", () => {
    expect(NICHES.advocacia.build({ areas: ["civel"], setores: "nao" }, "X").departments).toEqual([]);
    expect(NICHES.advocacia.build({ areas: ["civel"], setores: "sim" }, "X").departments.map((d) => d.name)).toEqual(["Cível"]);
  });

  it("buildNicheSetup só devolve os grupos escolhidos", () => {
    const s = buildNicheSetup("arquitetura", {}, "Studio", ["stages", "tags"]);
    expect(Object.keys(s).sort()).toEqual(["stages", "tags"]);
  });

  it("o nome da empresa entra nas mensagens", () => {
    const s = buildNicheSetup("saude", {}, "Clínica Sorriso");
    expect(s.quick_replies![0].body).toContain("Clínica Sorriso");
  });
});

describe("campos extras da ficha do lead", () => {
  const defs: ContactFieldDef[] = [
    { key: "processo", label: "Nº do processo", type: "texto", options: [] },
    { key: "metragem", label: "Metragem", type: "numero", options: [] },
    { key: "prazo", label: "Prazo", type: "data", options: [] },
    { key: "tipo", label: "Tipo", type: "opcoes", options: ["Casa", "Apartamento"] },
    { key: "planta", label: "Tem planta?", type: "sim_nao", options: [] },
  ];

  it("converte e valida cada tipo", () => {
    const r = sanitizeCustomFields(defs, { processo: " 123 ", metragem: "1.234,5", prazo: "2026-12-01", tipo: "Casa", planta: "sim" });
    expect(r.errors).toEqual([]);
    expect(r.values).toEqual({ processo: "123", metragem: 1234.5, prazo: "2026-12-01", tipo: "Casa", planta: true });
  });

  it("ignora chaves que o tenant não definiu e rejeita valores inválidos", () => {
    const r = sanitizeCustomFields(defs, { hack: "x", metragem: "abc", prazo: "01/12/2026", tipo: "Castelo", planta: "talvez" });
    expect(r.values).toEqual({});
    expect(r.errors).toHaveLength(4);
  });

  it("vazio remove; campos não enviados são preservados", () => {
    const r = sanitizeCustomFields(defs, { processo: "" }, { processo: "1", metragem: 50, antigo: "fica" });
    expect(r.values).toEqual({ metragem: 50, antigo: "fica" });
  });

  it("aceita manter uma opção que saiu da lista", () => {
    const r = sanitizeCustomFields(defs, { tipo: "Loja" }, { tipo: "Loja" });
    expect(r.errors).toEqual([]);
    expect(r.values.tipo).toBe("Loja");
  });

  it("gera chaves válidas a partir do nome", () => {
    expect(fieldKeyFrom("Nº do processo")).toBe("n_do_processo");
    expect(fieldKeyFrom("Área do direito")).toBe("area_do_direito");
    expect(fieldKeyFrom("123 abc")).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
    expect(fieldKeyFrom("!!!")).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });
});
