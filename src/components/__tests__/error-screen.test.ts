import { describe, expect, it } from "vitest";
import { isStaleVersionError } from "../error-screen";

describe("isStaleVersionError", () => {
  it("reconhece erros de aba aberta numa versão antiga", () => {
    expect(isStaleVersionError('Server Action "abc" was not found on the server.')).toBe(true);
    expect(isStaleVersionError("Failed to find Server Action")).toBe(true);
    expect(isStaleVersionError("ChunkLoadError: Loading chunk 123 failed.")).toBe(true);
    expect(isStaleVersionError("Cannot read properties of undefined")).toBe(false);
  });
});
