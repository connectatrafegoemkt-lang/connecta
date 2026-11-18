import { describe, expect, it } from "vitest";
import { planSession } from "../plan";

describe("planSession", () => {
  it("cliente ativo: conecta e desconecta como pedido", () => {
    expect(planSession({ desired: "conectado", suspended: false, running: false })).toBe("start");
    expect(planSession({ desired: "conectado", suspended: false, running: true })).toBe("none");
    expect(planSession({ desired: "desconectado", suspended: false, running: true })).toBe("logout");
    expect(planSession({ desired: "desconectado", suspended: false, running: false })).toBe("none");
  });

  it("cliente suspenso: pausa (sem logout) e não inicia", () => {
    expect(planSession({ desired: "conectado", suspended: true, running: true })).toBe("pause");
    expect(planSession({ desired: "conectado", suspended: true, running: false })).toBe("none");
    expect(planSession({ desired: "desconectado", suspended: true, running: true })).toBe("pause");
  });
});
