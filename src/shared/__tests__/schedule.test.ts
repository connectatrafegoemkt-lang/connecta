import { describe, expect, it } from "vitest";
import { brDateTime, parseInterval, sequenceSlot } from "../schedule";

const at = (s: string) => Date.parse(s);

describe("sequenceSlot", () => {
  it("vai para X minutos depois da última agendada (11:40 → 11:50)", () => {
    const now = at("2026-11-26T12:00:00Z"); // 09:00 em Brasília
    expect(sequenceSlot("2026-11-26T14:40:00Z", 10, now)).toBe("2026-11-26T14:50:00.000Z");
    expect(sequenceSlot("2026-11-26T14:40:00Z", 15, now)).toBe("2026-11-26T14:55:00.000Z");
  });
  it("sem nenhuma agendada no futuro, conta a partir de agora", () => {
    const now = at("2026-11-26T12:00:00Z");
    expect(sequenceSlot(null, 5, now)).toBe("2026-11-26T12:05:00.000Z");
    expect(sequenceSlot("2026-11-26T10:00:00Z", 5, now)).toBe("2026-11-26T12:05:00.000Z");
  });
  it("arredonda para o minuto cheio seguinte", () => {
    expect(sequenceSlot(null, 5, at("2026-11-26T12:00:20Z"))).toBe("2026-11-26T12:06:00.000Z");
  });
});

describe("parseInterval", () => {
  it("aceita 1 a 240 minutos inteiros", () => {
    expect(parseInterval("10")).toBe(10);
    expect(parseInterval(240)).toBe(240);
    for (const bad of ["0", "241", "2.5", "abc", "", null, undefined, "-5"]) expect(parseInterval(bad)).toBeNull();
  });
});

describe("brDateTime", () => {
  it("mostra no horário de Brasília", () => {
    expect(brDateTime("2026-11-26T14:50:00Z")).toBe("26/11, 11:50");
  });
});
