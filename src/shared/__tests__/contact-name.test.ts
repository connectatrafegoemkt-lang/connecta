import { describe, expect, it } from "vitest";
import { displayName, isPlaceholderName } from "../contact-name";

describe("isPlaceholderName", () => {
  it("telefone como nome é provisório", () => {
    expect(isPlaceholderName("+5511988887777", "5511988887777")).toBe(true);
    expect(isPlaceholderName("5511988887777", "5511988887777")).toBe(true);
    expect(isPlaceholderName("", "5511988887777")).toBe(true);
  });
  it("nome de verdade não é provisório", () => {
    expect(isPlaceholderName("Mariana Alves", "5511988887777")).toBe(false);
    expect(isPlaceholderName("Dr. João 2", "5511988887777")).toBe(false);
  });
});

describe("displayName", () => {
  it("lead não cadastrada mostra o nome do WhatsApp", () => {
    expect(displayName({ name: "+5511988887777", phone: "5511988887777", whatsapp_name: "Mari 🌸" })).toBe("Mari 🌸");
  });
  it("nome cadastrado no CRM continua valendo", () => {
    expect(displayName({ name: "Mariana Alves", phone: "5511988887777", whatsapp_name: "Mari 🌸" })).toBe("Mariana Alves");
  });
  it("sem nome do WhatsApp, mostra o que tem", () => {
    expect(displayName({ name: "+5511988887777", phone: "5511988887777", whatsapp_name: null })).toBe("+5511988887777");
  });
});
