import { describe, expect, it } from "vitest";
import { isIndividualChat, jidToPhone, phoneCandidates, phoneToJid } from "../phone";

describe("telefone/JID", () => {
  it("converte JID em telefone", () => {
    expect(jidToPhone("5511988887777@s.whatsapp.net")).toBe("5511988887777");
    expect(jidToPhone("5511988887777:12@s.whatsapp.net")).toBe("5511988887777");
    expect(jidToPhone("123@g.us")).toBeNull();
    expect(jidToPhone("abc@lid")).toBeNull();
  });
  it("gera variantes com/sem 9º dígito para o Brasil", () => {
    expect(phoneCandidates("5511988887777").sort()).toEqual(["551188887777", "5511988887777"].sort());
    expect(phoneCandidates("551188887777").sort()).toEqual(["551188887777", "5511988887777"].sort());
    expect(phoneCandidates("14155550100")).toEqual(["14155550100"]);
  });
  it("só aceita conversas individuais", () => {
    expect(isIndividualChat("5511988887777@s.whatsapp.net")).toBe(true);
    expect(isIndividualChat("123-456@g.us")).toBe(false);
    expect(isIndividualChat("status@broadcast")).toBe(false);
  });
  it("monta JID", () => expect(phoneToJid("+55 11 98888-7777")).toBe("5511988887777@s.whatsapp.net"));
});
