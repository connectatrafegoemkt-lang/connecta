import { describe, expect, it } from "vitest";
import { currentMonth, lastMonths, monthLabel, parseMonth, shiftMonth } from "@/shared/months";

const now = new Date("2026-11-01T02:00:00Z"); // 31/10 23h em Brasília

describe("meses do relatório", () => {
  it("usa o fuso de Brasília", () => {
    expect(currentMonth(now)).toBe("2026-10");
  });
  it("padrão é o mês anterior; valores inválidos ou futuros caem no padrão", () => {
    expect(parseMonth(undefined, now)).toBe("2026-09");
    expect(parseMonth("2026-13", now)).toBe("2026-09");
    expect(parseMonth("2027-01", now)).toBe("2026-09");
    expect(parseMonth("2019-12", now)).toBe("2026-09");
    expect(parseMonth("' or 1=1", now)).toBe("2026-09");
    expect(parseMonth("2026-05", now)).toBe("2026-05");
  });
  it("vira o ano", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(lastMonths(3, now)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });
  it("rótulo em português", () => {
    expect(monthLabel("2026-03")).toBe("Março de 2026");
  });
});
