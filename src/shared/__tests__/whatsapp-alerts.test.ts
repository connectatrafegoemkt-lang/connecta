import { describe, expect, it } from "vitest";
import { downNumbers, downReason, isDown, type AlertNumber } from "../whatsapp-alerts";

const n = (o: Partial<AlertNumber>): AlertNumber => ({ id: "a", label: "Principal", status: "conectado", desired_state: "conectado", last_error: null, ...o });

describe("isDown", () => {
  it("conectado não é queda", () => expect(isDown(n({}))).toBe(false));
  it("caiu, suspenso ou pedindo QR é queda", () => {
    expect(isDown(n({ status: "conectando" }))).toBe(true);
    expect(isDown(n({ status: "erro", last_error: "bloqueado" }))).toBe(true);
    expect(isDown(n({ status: "aguardando_qr" }))).toBe(true);
  });
  it("desconectado pelo celular (com motivo) avisa; desligado de propósito não", () => {
    expect(isDown(n({ status: "desconectado", desired_state: "desconectado", last_error: "O WhatsApp desconectou" }))).toBe(true);
    expect(isDown(n({ status: "desconectado", desired_state: "desconectado", last_error: null }))).toBe(false);
  });
});

describe("downNumbers", () => {
  it("só avisa depois da tolerância (quedas curtas não geram aviso)", () => {
    const since = new Map<string, number>();
    const down = [n({ status: "conectando" })];
    expect(downNumbers(down, since, 0, 90_000)).toHaveLength(0);
    expect(downNumbers(down, since, 60_000, 90_000)).toHaveLength(0);
    expect(downNumbers(down, since, 90_000, 90_000)).toHaveLength(1);
  });
  it("voltou a conectar: zera o contador", () => {
    const since = new Map<string, number>();
    downNumbers([n({ status: "conectando" })], since, 0, 90_000);
    downNumbers([n({})], since, 50_000, 90_000);
    expect(downNumbers([n({ status: "conectando" })], since, 100_000, 90_000)).toHaveLength(0);
  });
  it("número removido sai do controle", () => {
    const since = new Map<string, number>([["x", 0]]);
    downNumbers([n({})], since, 1, 90_000);
    expect(since.has("x")).toBe(false);
  });
});

describe("downReason", () => {
  it("usa o motivo gravado pelo sistema, ou um texto padrão", () => {
    expect(downReason(n({ status: "erro", last_error: "O WhatsApp bloqueou" }))).toBe("O WhatsApp bloqueou");
    expect(downReason(n({ status: "aguardando_qr" }))).toMatch(/QR/);
  });
});
