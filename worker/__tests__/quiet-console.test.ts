import { describe, expect, it, vi } from "vitest";
import { isSignalNoise, silenceSignalLogs } from "../quiet-console";

describe("silenceSignalLogs", () => {
  it("descarta logs da libsignal com material de chave e mantém o resto", () => {
    const info = vi.fn();
    const log = vi.fn();
    const warn = vi.fn();
    const fake = { info, log, warn };
    silenceSignalLogs(fake);
    fake.info("Closing session:", { rootKey: Buffer.from("segredo") });
    fake.info("Opening session:", {});
    fake.warn("Removing old closed session:", {});
    fake.log("worker iniciado");
    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("worker iniciado");
    expect(isSignalNoise(["Closing session:"])).toBe(true);
    expect(isSignalNoise([{ msg: "Closing session" }])).toBe(false);
  });
});
