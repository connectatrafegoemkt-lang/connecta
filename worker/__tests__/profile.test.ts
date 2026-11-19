import { describe, expect, it, vi } from "vitest";
import { extractAbout, isProfileStale, refreshContactProfile } from "../profile";

function fakeRepo(checkedAt: string | null = null) {
  return {
    tenantId: "t-a",
    getContactProfileState: vi.fn().mockResolvedValue({ profile_checked_at: checkedAt }),
    uploadMedia: vi.fn().mockResolvedValue(undefined),
    saveContactProfile: vi.fn().mockResolvedValue(undefined),
  };
}

describe("perfil do WhatsApp", () => {
  it("baixa a foto para a pasta do tenant e grava o recado", async () => {
    const repo = fakeRepo();
    const src = {
      pictureUrl: vi.fn().mockResolvedValue("https://pps.whatsapp.net/x.jpg"),
      about: vi.fn().mockResolvedValue([{ id: "x", status: { status: "Disponível", setAt: new Date() } }]),
      download: vi.fn().mockResolvedValue(Buffer.from("jpg")),
    };
    expect(await refreshContactProfile(repo, src, "c1", "5511@s.whatsapp.net")).toBe("updated");
    expect(repo.uploadMedia).toHaveBeenCalledWith("t-a/avatars/c1.jpg", Buffer.from("jpg"), "image/jpeg");
    expect(repo.saveContactProfile).toHaveBeenCalledWith("c1", { avatar_path: "t-a/avatars/c1.jpg", whatsapp_about: "Disponível" });
  });

  it("sem permissão para ver a foto (privacidade): grava sem foto, sem erro", async () => {
    const repo = fakeRepo();
    const src = { pictureUrl: vi.fn().mockRejectedValue(new Error("not-authorized")), about: vi.fn().mockResolvedValue(null), download: vi.fn() };
    await refreshContactProfile(repo, src, "c1", "jid");
    expect(src.download).not.toHaveBeenCalled();
    expect(repo.saveContactProfile).toHaveBeenCalledWith("c1", { avatar_path: null, whatsapp_about: null });
  });

  it("não busca de novo antes de 24h", async () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    const repo = fakeRepo("2026-11-19T06:00:00Z");
    const src = { pictureUrl: vi.fn(), about: vi.fn(), download: vi.fn() };
    expect(await refreshContactProfile(repo, src, "c1", "jid", { now })).toBe("fresh");
    expect(src.pictureUrl).not.toHaveBeenCalled();
    expect(isProfileStale("2026-11-18T06:00:00Z", now)).toBe(true);
  });

  it("entende as formas de resposta do recado", () => {
    expect(extractAbout([{ status: "Oi" }])).toBe("Oi");
    expect(extractAbout({ status: "Oi" })).toBe("Oi");
    expect(extractAbout([{ status: { status: " Em reunião " } }])).toBe("Em reunião");
    expect(extractAbout([])).toBeNull();
    expect(extractAbout(null)).toBeNull();
  });
});
