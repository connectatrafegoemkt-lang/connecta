/**
 * E2E da interface: loga no navegador como tenant A, navega pelas telas e
 * tenta abrir dados do tenant B pela URL. Requer APP_URL + SUPABASE_*.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const APP = process.env.APP_URL;
const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(APP && URL && ANON && SERVICE);

it.runIf(Boolean(process.env.REQUIRE_API_TESTS) && !enabled)("variáveis presentes", () => {
  throw new Error("APP_URL/SUPABASE_* ausentes no CI");
});

const run = randomUUID().slice(0, 8);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
let admin: SupabaseClient;
let browser: Browser;
let page: Page;
const users: string[] = [];
const tenants: string[] = [];
const A = { email: `ui-a-${run}@teste.connecta.local`, password: `Senha-${randomUUID()}`, tenantId: "" };
const B = { email: `ui-b-${run}@teste.connecta.local`, password: `Senha-${randomUUID()}`, tenantId: "", contactId: "" };

async function mkTenant(t: { email: string; password: string; tenantId: string }, label: string) {
  const { data, error } = await admin.auth.admin.createUser({ email: t.email, password: t.password, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  const r = await admin.rpc("create_tenant_with_admin", {
    p_name: `Empresa ${label} ${run}`,
    p_slug: `ui-${label}-${run}`,
    p_admin_user_id: data.user.id,
    p_admin_name: `Admin ${label}`,
  });
  if (r.error) throw r.error;
  t.tenantId = r.data as string;
  tenants.push(t.tenantId);
}

describe.skipIf(!enabled)("isolamento na interface (navegador)", () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, opts);
    await mkTenant(A, "a");
    await mkTenant(B, "b");
    const { data } = await admin
      .from("contacts")
      .insert({ tenant_id: B.tenantId, name: `Cliente Secreto B ${run}` })
      .select("id")
      .single()
      .throwOnError();
    B.contactId = data!.id;

    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(`${APP}/login`);
    await page.fill('input[name="email"]', A.email);
    await page.fill('input[name="password"]', A.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard");
  }, 90_000);

  afterAll(async () => {
    await browser?.close();
    if (!admin) return;
    if (tenants.length) await admin.from("tenants").delete().in("id", tenants);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  it("sem login, páginas redirecionam para /login", async () => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${APP}/contatos`);
    expect(new globalThis.URL(p.url()).pathname).toBe("/login");
    await ctx.close();
  });

  it("dashboard mostra o tenant A", async () => {
    await expect(page.getByText(`Empresa a ${run}`).first().isVisible()).resolves.toBe(true);
    expect(await page.content()).not.toContain(`Empresa b ${run}`);
  });

  it("cria contato pela interface e ele aparece só para A", async () => {
    await page.goto(`${APP}/contatos`);
    await page.click("summary");
    await page.fill('input[name="name"]', `Lead UI ${run}`);
    await page.fill('input[name="phone"]', "5511999990000");
    await page.click('button:has-text("Criar contato")');
    await page.waitForURL(/\/contatos\/[0-9a-f-]{36}$/);
    await page.goto(`${APP}/contatos`);
    const html = await page.content();
    expect(html).toContain(`Lead UI ${run}`);
    expect(html).not.toContain(`Cliente Secreto B ${run}`);
    const { data } = await admin.from("contacts").select("tenant_id").eq("name", `Lead UI ${run}`).single();
    expect(data!.tenant_id).toBe(A.tenantId);
  });

  it("abrir o contato de B pela URL retorna 404", async () => {
    const res = await page.goto(`${APP}/contatos/${B.contactId}`);
    expect(res?.status()).toBe(404);
    expect(await page.content()).not.toContain(`Cliente Secreto B ${run}`);
  });

  it("funil e tarefas não exibem dados de B", async () => {
    for (const path of ["/funil", "/tarefas", "/configuracoes"]) {
      const res = await page.goto(`${APP}${path}`);
      expect(res?.status(), path).toBe(200);
      expect(await page.content(), path).not.toContain(`Cliente Secreto B ${run}`);
    }
  });
});
