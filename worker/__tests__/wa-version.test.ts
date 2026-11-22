import { describe, expect, it } from "vitest";
import { disconnectMessage } from "../wa-version";

describe("mensagens de queda da conexão do WhatsApp", () => {
  it("explica os motivos comuns em português", () => {
    expect(disconnectMessage(405)).toMatch(/recusou/);
    expect(disconnectMessage(440)).toMatch(/outro lugar/);
    expect(disconnectMessage(500)).toMatch(/corrompida/);
    expect(disconnectMessage(undefined)).toMatch(/código \?/);
    expect(disconnectMessage(999)).toMatch(/código 999/);
  });
});
