import { describe, expect, it } from "vitest";
import { reconnectPolicy } from "../reconnect";

describe("reconnectPolicy", () => {
  it("número já conectado NÃO perde o login com erro 500 (oscilação comum)", () => {
    const r = reconnectPolicy({ code: 500, registered: true, failuresBeforeQr: 0, retries: 1 });
    expect(r.wipeAuth).toBe(false);
  });
  it("número conectado nunca perde o login por quedas repetidas", () => {
    for (const code of [408, 428, 500, 503, 515, undefined]) {
      expect(reconnectPolicy({ code, registered: true, failuresBeforeQr: 9, retries: 9 }).wipeAuth).toBe(false);
    }
  });
  it("pareamento travado (sem login completo) recomeça do zero", () => {
    expect(reconnectPolicy({ code: 500, registered: false, failuresBeforeQr: 0, retries: 1 }).wipeAuth).toBe(true);
    expect(reconnectPolicy({ code: 408, registered: false, failuresBeforeQr: 3, retries: 3 }).wipeAuth).toBe(true);
    expect(reconnectPolicy({ code: 408, registered: false, failuresBeforeQr: 1, retries: 1 }).wipeAuth).toBe(false);
  });
  it("espera: 515 rápido, 440 longo, demais com limite de 30s", () => {
    expect(reconnectPolicy({ code: 515, registered: true, failuresBeforeQr: 0, retries: 4 }).waitMs).toBe(1000);
    expect(reconnectPolicy({ code: 440, registered: true, failuresBeforeQr: 0, retries: 1 }).waitMs).toBe(60_000);
    expect(reconnectPolicy({ code: 403, registered: true, failuresBeforeQr: 0, retries: 1 }).waitMs).toBe(300_000);
    expect(reconnectPolicy({ code: 428, registered: true, failuresBeforeQr: 0, retries: 1 }).waitMs).toBe(2000);
    expect(reconnectPolicy({ code: 428, registered: true, failuresBeforeQr: 0, retries: 20 }).waitMs).toBe(30_000);
  });
});
