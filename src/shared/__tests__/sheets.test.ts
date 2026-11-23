import { describe, expect, it } from "vitest";
import { mapHeader, parseCsv, parseSheetUrl, sheetCsvUrl, sheetToLeads } from "@/shared/sheets";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xyz";

describe("link da planilha", () => {
  it("reconhece o link e a aba", () => {
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123456`)).toEqual({ sheetId: ID, gid: "123456" });
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toEqual({ sheetId: ID, gid: "0" });
  });
  it("recusa links de outros sites (não deixa o servidor buscar endereços arbitrários)", () => {
    expect(parseSheetUrl("https://evil.com/spreadsheets/d/xxxxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
    expect(parseSheetUrl(`http://docs.google.com/spreadsheets/d/${ID}`)).toBeNull();
    expect(parseSheetUrl(`https://docs.google.com.evil.com/spreadsheets/d/${ID}`)).toBeNull();
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/../../x")).toBeNull();
    expect(() => sheetCsvUrl("../x", "0")).toThrow();
    expect(sheetCsvUrl(ID, "7")).toBe(`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=7`);
  });
});

describe("leitura da planilha", () => {
  it("CSV com aspas, vírgulas e quebra de linha", () => {
    expect(parseCsv('a,b\r\n"x, y","linha1\nlinha2"\n"aspas ""ok""",\n')).toEqual([
      ["a", "b"],
      ["x, y", "linha1\nlinha2"],
      ['aspas "ok"', ""],
    ]);
  });

  it("acha as colunas pelos títulos, com ou sem acento", () => {
    expect(mapHeader(["Nome", "WhatsApp", "Escritório", "Área de atuação", "E-mail", "Observações", "Nicho", "Instagram"])).toEqual({
      name: 0, phone: 1, company: 2, area: 3, email: 4, notes: 5, niche: 6, instagram: 7,
    });
  });

  it("converte linhas em leads, sem repetir e com DDI", () => {
    const csv = [
      "Nome,Telefone,Empresa,Cidade,E-mail",
      "Dra. Ana,(41) 99999-8888,Souza Adv,Curitiba,",
      "Dra. Ana (repetida),41 99999-8888,,,",
      "Dr. João,,Lima & Assoc,São Paulo,JOAO@lima.adv.br",
      "Escritório X,123,,,email-invalido",
      ",11988887777,,,",
    ].join("\n");
    const { leads, skipped, error } = sheetToLeads(csv);
    expect(error).toBeUndefined();
    expect(skipped).toBe(2);
    expect(leads).toEqual([
      { key: "tel:5541999998888", name: "Dra. Ana", phone: "5541999998888", company: "Souza Adv", city: "Curitiba" },
      { key: "email:joao@lima.adv.br", name: "Dr. João", email: "joao@lima.adv.br", company: "Lima & Assoc", city: "São Paulo" },
      { key: "nome:escritorio x|", name: "Escritório X" },
    ]);
  });

  it("explica quando falta a coluna Nome", () => {
    expect(sheetToLeads("Telefone\n11988887777").error).toMatch(/Nome/);
    expect(sheetToLeads("").error).toMatch(/vazia/);
  });
});

describe("área e Instagram na planilha", () => {
  it("lê a área de atuação e normaliza o Instagram", () => {
    const { leads } = sheetToLeads("Nome,Área,Instagram\nDra. Ana,Trabalhista,https://www.instagram.com/dra.ana/\nDr. Bia,Família,@bia_adv\nDr. C,Cível,nao é valido!");
    expect(leads.map((l) => [l.area, l.instagram])).toEqual([["Trabalhista", "dra.ana"], ["Família", "bia_adv"], ["Cível", undefined]]);
  });
});
