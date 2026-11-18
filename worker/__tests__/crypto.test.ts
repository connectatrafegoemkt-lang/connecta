import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { CredentialCipher } from "../crypto";

const KEY = randomBytes(32).toString("base64");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("CredentialCipher (credenciais do WhatsApp)", () => {
  const c = new CredentialCipher(KEY);

  it("cifra e decifra no mesmo tenant/registro", () => {
    const enc = c.encrypt(A, "creds", '{"segredo":"abc"}');
    expect(c.decrypt(A, "creds", enc)).toBe('{"segredo":"abc"}');
  });

  it("o texto cifrado não contém o texto puro", () => {
    const enc = c.encrypt(A, "creds", "noiseKey-super-secreta");
    expect(enc).not.toContain("noiseKey");
    expect(Buffer.from(enc.slice(3), "base64").toString("utf8")).not.toContain("noiseKey");
  });

  it("credencial de A NÃO decifra como se fosse de B", () => {
    const enc = c.encrypt(A, "creds", "x");
    expect(() => c.decrypt(B, "creds", enc)).toThrow();
  });

  it("credencial não pode ser movida para outro registro", () => {
    const enc = c.encrypt(A, "pre-key-1", "x");
    expect(() => c.decrypt(A, "creds", enc)).toThrow();
  });

  it("adulteração é detectada (GCM)", () => {
    const enc = c.encrypt(A, "creds", "conteudo");
    const raw = Buffer.from(enc.slice(3), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => c.decrypt(A, "creds", `v1:${raw.toString("base64")}`)).toThrow();
  });

  it("outra chave mestra não decifra", () => {
    const enc = c.encrypt(A, "creds", "x");
    const other = new CredentialCipher(randomBytes(32).toString("base64"));
    expect(() => other.decrypt(A, "creds", enc)).toThrow();
  });

  it("exige chave mestra de 32 bytes", () => {
    expect(() => new CredentialCipher(undefined)).toThrow();
    expect(() => new CredentialCipher(Buffer.from("curta").toString("base64"))).toThrow();
  });
});
