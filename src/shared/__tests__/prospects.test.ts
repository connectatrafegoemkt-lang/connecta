import { describe, expect, it } from "vitest";
import { normalizeInstagram, parseProspectList } from "@/shared/prospects";
import { prospectLogSchema, prospectSchema } from "@/server/validation";

describe("importar lista de prospecção", () => {
  it("lê ; e TAB, ignora cabeçalho e põe DDI 55", () => {
    const { rows, errors } = parseProspectList(
      "Nome;Telefone;Empresa\nDra. Ana; (41) 99999-8888; Souza Adv; Curitiba; Trabalhista\nDr. João\t11 98888-7777\tLima & Assoc.\n\n",
      "OAB/PR",
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { name: "Dra. Ana", phone: "5541999998888", company: "Souza Adv", city: "Curitiba", niche: "Trabalhista", source: "OAB/PR" },
      { name: "Dr. João", phone: "5511988887777", company: "Lima & Assoc.", source: "OAB/PR" },
    ]);
  });

  it("telefone inválido vira aviso, mas a lead entra sem telefone", () => {
    const { rows, errors } = parseProspectList("Escritório X; 123");
    expect(rows[0]).toEqual({ name: "Escritório X", source: "Lista importada" });
    expect(errors[0]).toMatch(/telefone inválido/);
  });
});

describe("validação da prospecção", () => {
  it("rejeita campos desconhecidos (ex.: tenant_id) e etapa inválida", () => {
    expect(prospectSchema.safeParse({ name: "A", tenant_id: "x" }).success).toBe(false);
    expect(prospectSchema.safeParse({ name: "A", status: "hackeado" }).success).toBe(false);
    expect(prospectSchema.safeParse({ name: "A", phone: "41 99999-8888" }).success).toBe(true);
    expect(prospectLogSchema.safeParse({ type: "sms" }).success).toBe(false);
    expect(prospectLogSchema.safeParse({ type: "whatsapp", body: "oi", status: "" }).success).toBe(true);
  });
});

describe("Instagram da lead", () => {
  it("aceita @, usuário ou link e devolve só o usuário", () => {
    expect(normalizeInstagram("@dra.ana")).toBe("dra.ana");
    expect(normalizeInstagram("https://instagram.com/escritorio_x?igsh=abc")).toBe("escritorio_x");
    expect(normalizeInstagram("www.instagram.com/bia/")).toBe("bia");
    expect(normalizeInstagram("  ")).toBeNull();
    expect(() => normalizeInstagram("nome com espaço")).toThrow();
    expect(() => normalizeInstagram("<script>")).toThrow();
  });

  it("lista colada traz área e Instagram (7 colunas)", () => {
    const { rows } = parseProspectList("Dra. Ana; 41 99999-8888; Souza Adv; Curitiba; Advocacia; Trabalhista; @dra.ana");
    expect(rows[0]).toMatchObject({ niche: "Advocacia", area: "Trabalhista", instagram: "dra.ana" });
  });

  it("validação recusa Instagram inválido", () => {
    expect(prospectSchema.safeParse({ name: "A", instagram: "não vale" }).success).toBe(false);
    expect(prospectSchema.safeParse({ name: "A", instagram: "@ok_123" }).data?.instagram).toBe("ok_123");
  });
});
