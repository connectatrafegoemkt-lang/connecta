import { describe, expect, it } from "vitest";
import { dayLabel, listTime, sameDay, timeOnly } from "../format";

describe("datas no estilo WhatsApp (horário de Brasília)", () => {
  const now = new Date("2026-11-19T15:00:00Z"); // 12:00 em Brasília
  it("Hoje / Ontem / data", () => {
    expect(dayLabel("2026-11-19T13:00:00Z", now)).toBe("Hoje");
    expect(dayLabel("2026-11-18T20:00:00Z", now)).toBe("Ontem");
    expect(dayLabel("2026-11-10T12:00:00Z", now)).toBe("10/11/2026");
    // 01:00 UTC do dia 19 ainda é dia 18 em Brasília
    expect(dayLabel("2026-11-19T01:00:00Z", now)).toBe("Ontem");
  });
  it("hora curta e lista", () => {
    expect(timeOnly("2026-11-19T13:05:00Z")).toBe("10:05");
    expect(listTime("2026-11-19T13:05:00Z", now)).toBe("10:05");
    expect(listTime("2026-11-18T13:05:00Z", now)).toBe("Ontem");
    expect(sameDay("2026-11-19T02:59:00Z", "2026-11-18T12:00:00Z")).toBe(true);
  });
});
