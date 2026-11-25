import { describe, expect, it, vi } from "vitest";
import { JidResolver } from "../resolve-jid";

describe("JidResolver", () => {
  it("usa a variante SEM o 9º dígito quando é ela que existe no WhatsApp", async () => {
    const lookup = vi.fn(async () => [{ jid: "553188887777@s.whatsapp.net", exists: true }]);
    const r = new JidResolver(lookup);
    expect(await r.resolve("5531988887777")).toBe("553188887777@s.whatsapp.net");
    expect(lookup).toHaveBeenCalledWith("5531988887777", "553188887777");
  });
  it("prefere o número exato quando as duas variantes existem", async () => {
    const r = new JidResolver(async () => [
      { jid: "551188887777@s.whatsapp.net", exists: true },
      { jid: "5511988887777@s.whatsapp.net", exists: true },
    ]);
    expect(await r.resolve("5511988887777")).toBe("5511988887777@s.whatsapp.net");
  });
  it("número sem WhatsApp devolve null", async () => {
    const r = new JidResolver(async () => []);
    expect(await r.resolve("5511988887777")).toBeNull();
  });
  it("se a consulta falhar, envia para o número montado (não trava)", async () => {
    const r = new JidResolver(async () => {
      throw new Error("timeout");
    });
    expect(await r.resolve("5511988887777")).toBe("5511988887777@s.whatsapp.net");
  });
  it("guarda a resposta (não consulta o WhatsApp a cada mensagem)", async () => {
    let t = 0;
    const lookup = vi.fn(async () => [{ jid: "5511988887777@s.whatsapp.net", exists: true }]);
    const r = new JidResolver(lookup, () => t);
    await r.resolve("5511988887777");
    await r.resolve("5511988887777");
    expect(lookup).toHaveBeenCalledTimes(1);
    t = 13 * 3600_000;
    await r.resolve("5511988887777");
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
