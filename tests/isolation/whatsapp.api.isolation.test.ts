/**
 * Isolamento do WhatsApp contra o Supabase real (CI):
 * - worker: mensagem recebida pela sessão de A vira interação só em A;
 * - credenciais cifradas por tenant, ilegíveis pela API;
 * - fila de envio: worker de A nunca pega mensagens de B;
 * - API do app: A não envia para contato de B nem vê status/QR de B.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { WorkerTenantRepo } from "../../worker/repo";
import { handleIncoming } from "../../worker/inbound";
import { CredentialCipher } from "../../worker/crypto";
import { loadTenantAuthState } from "../../worker/auth-state";

const APP = process.env.APP_URL;
const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL && ANON && SERVICE);

it.runIf(Boolean(process.env.REQUIRE_API_TESTS) && !enabled)("variáveis presentes", () => {
  throw new Error("SUPABASE_* ausentes no CI");
});

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = randomUUID().slice(0, 8);
const PHONE = `55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

interface T {
  tenantId: string;
  sessionId: string;
  userId: string;
  token: string;
  client: SupabaseClient;
  contactId: string;
}
let admin: SupabaseClient;
const users: string[] = [];
const tenants: string[] = [];
let A: T;
let B: T;

async function setup(label: string): Promise<T> {
  const email = `wa-${label}-${run}@teste.connecta.local`;
  const password = `Senha-${randomUUID()}`;
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  users.push(u.user.id);
  const { data: tenantId, error: e2 } = await admin.rpc("create_tenant_with_admin", {
    p_name: `WA ${label}`,
    p_slug: `wa-${label}-${run}`,
    p_admin_user_id: u.user.id,
  });
  if (e2) throw e2;
  tenants.push(tenantId as string);
  const client = createClient(URL!, ANON!, opts);
  const { data: s, error: e3 } = await client.auth.signInWithPassword({ email, password });
  if (e3) throw e3;
  const { data: c } = await client
    .from("contacts")
    .insert({ name: `Cliente ${label}`, phone: PHONE })
    .select("id")
    .single()
    .throwOnError();
  // estado "conectado" simulado pelo worker
  const { data: sess } = await admin
    .from("whatsapp_sessions")
    .insert({ tenant_id: tenantId, status: "conectado", desired_state: "conectado", phone: "5511900000000", is_primary: true })
    .select("id")
    .single()
    .throwOnError();
  await admin.from("whatsapp_qr").upsert({ tenant_id: tenantId, session_id: sess!.id, qr: `QR-${label}-${run}` }).throwOnError();
  return {
    tenantId: tenantId as string,
    sessionId: sess!.id as string,
    userId: u.user.id,
    token: s.session!.access_token,
    client,
    contactId: c!.id,
  };
}

describe.skipIf(!enabled)("isolamento do WhatsApp (Supabase real)", () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, opts);
    A = await setup("a");
    B = await setup("b");
  });

  afterAll(async () => {
    if (!admin) return;
    if (tenants.length) await admin.from("tenants").delete().in("id", tenants);
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  it("worker: mensagem recebida pela sessão de A (mesmo telefone existe em B) só cria interação em A", async () => {
    const repoA = new WorkerTenantRepo(admin, A.tenantId, { id: A.sessionId, isPrimary: true });
    const r = await handleIncoming(repoA, {
      key: { id: `IN-${run}`, remoteJid: `${PHONE}@s.whatsapp.net`, fromMe: false },
      pushName: "Cliente",
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: `segredo de A ${run}` },
    });
    expect(r).toBe("stored");
    const { data } = await admin.from("interactions").select("tenant_id, contact_id").eq("external_id", `IN-${run}`);
    expect(data).toEqual([{ tenant_id: A.tenantId, contact_id: A.contactId }]);

    const bView = await B.client.from("interactions").select("body").ilike("body", `%${run}%`);
    expect(bView.data).toEqual([]);
  });

  it("worker: reprocessar a mesma mensagem não duplica", async () => {
    const repoA = new WorkerTenantRepo(admin, A.tenantId, { id: A.sessionId, isPrimary: true });
    const r = await handleIncoming(repoA, {
      key: { id: `IN-${run}`, remoteJid: `${PHONE}@s.whatsapp.net` },
      message: { conversation: "repetida" },
    });
    expect(r).toBe("duplicate");
  });

  it("credenciais: gravadas cifradas, isoladas por tenant e inacessíveis pela API", async () => {
    const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
    const repoA = new WorkerTenantRepo(admin, A.tenantId, { id: A.sessionId, isPrimary: true });
    const { state, saveCreds } = await loadTenantAuthState(repoA, cipher);
    await saveCreds();
    await state.keys.set({ "pre-key": { "1": { public: Buffer.from("pub"), private: Buffer.from("priv-secreta") } } });

    const { data: rows } = await admin.from("whatsapp_auth_keys").select("tenant_id, key, value_enc").eq("tenant_id", A.tenantId);
    expect(rows!.map((r) => r.key).sort()).toEqual(["creds", "pre-key-1"]);
    for (const r of rows!) {
      expect(r.value_enc.startsWith("v1:")).toBe(true);
      expect(r.value_enc).not.toContain("noiseKey");
      expect(Buffer.from(r.value_enc.slice(3), "base64").toString("latin1")).not.toContain("priv-secreta");
    }
    // relendo pelo estado do tenant A: decifra
    const again = await loadTenantAuthState(repoA, cipher);
    const got = await again.state.keys.get("pre-key", ["1"]);
    expect(Buffer.from(got["1"].private).toString()).toBe("priv-secreta");
    // repositório do tenant B não enxerga nada de A
    const repoB = new WorkerTenantRepo(admin, B.tenantId, { id: B.sessionId, isPrimary: true });
    expect((await repoB.getAuth(["creds", "pre-key-1"])).size).toBe(0);
    // valor de A copiado para B não decifra (AAD/chave por tenant)
    expect(() => cipher.decrypt(B.tenantId, "creds", rows!.find((r) => r.key === "creds")!.value_enc)).toThrow();

    // nenhum usuário lê credenciais via API (nem as próprias)
    const viaApi = await A.client.from("whatsapp_auth_keys").select("*");
    expect(viaApi.data ?? []).toEqual([]);
    const write = await A.client.from("whatsapp_auth_keys").insert({ tenant_id: B.tenantId, key: "creds", value_enc: "x" });
    expect(write.error).not.toBeNull();
  });

  it("sessão/QR: A vê só o próprio status e QR", async () => {
    const s = await A.client.from("whatsapp_sessions").select("tenant_id");
    expect(s.data!.map((r) => r.tenant_id)).toEqual([A.tenantId]);
    const q = await A.client.from("whatsapp_qr").select("tenant_id, qr");
    expect(q.data).toEqual([{ tenant_id: A.tenantId, qr: `QR-a-${run}` }]);
    const upd = await A.client.from("whatsapp_sessions").update({ desired_state: "desconectado" }).eq("tenant_id", B.tenantId).select();
    expect(upd.data ?? []).toEqual([]);
  });

  it("fila: A não enfileira para B, e o worker de A nunca pega itens de B", async () => {
    const bad = await A.client.from("whatsapp_outbox").insert({ contact_id: B.contactId, body: "spam" });
    expect(bad.error).not.toBeNull();
    const bad2 = await A.client.from("whatsapp_outbox").insert({ tenant_id: B.tenantId, contact_id: B.contactId, body: "spam" });
    expect(bad2.error).not.toBeNull();

    await B.client.from("whatsapp_outbox").insert({ contact_id: B.contactId, body: `msg de B ${run}` }).throwOnError();
    await A.client.from("whatsapp_outbox").insert({ contact_id: A.contactId, body: `msg de A ${run}` }).throwOnError();

    const claimedA = await new WorkerTenantRepo(admin, A.tenantId, { id: A.sessionId, isPrimary: true }).claimOutbox();
    expect(claimedA.map((i) => i.body)).toEqual([`msg de A ${run}`]);
    const { data: bRows } = await admin.from("whatsapp_outbox").select("status").eq("tenant_id", B.tenantId);
    expect(bRows!.every((r) => r.status === "pendente")).toBe(true);

    const seenByA = await A.client.from("whatsapp_outbox").select("body");
    expect(seenByA.data!.map((r) => r.body)).not.toContain(`msg de B ${run}`);
  });

  it("RPC whatsapp_request de A não afeta B", async () => {
    const r = await A.client.rpc("whatsapp_request", { p_action: "desconectar" });
    expect(r.error).toBeNull();
    const { data } = await admin.from("whatsapp_sessions").select("tenant_id, desired_state").in("tenant_id", [A.tenantId, B.tenantId]);
    const m = Object.fromEntries(data!.map((x) => [x.tenant_id, x.desired_state]));
    expect(m[A.tenantId]).toBe("desconectado");
    expect(m[B.tenantId]).toBe("conectado");
    await admin.from("whatsapp_sessions").update({ desired_state: "conectado", status: "conectado" }).eq("tenant_id", A.tenantId);
  });

  it.runIf(Boolean(APP))("API do app: A não envia para contato de B e /status só mostra A", async () => {
    const h = { Authorization: `Bearer ${A.token}`, "Content-Type": "application/json" };
    const send = await fetch(`${APP}/api/whatsapp/messages`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ contact_id: B.contactId, body: "spam" }),
    });
    expect(send.status).toBe(404);
    const forged = await fetch(`${APP}/api/whatsapp/messages`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ contact_id: A.contactId, body: "x", tenant_id: B.tenantId }),
    });
    expect(forged.status).toBe(400);
    const st = await fetch(`${APP}/api/whatsapp/status`, { headers: h });
    const body = await st.json();
    expect(body.qr).toBe(`QR-a-${run}`);
    const ok = await fetch(`${APP}/api/whatsapp/messages`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ contact_id: A.contactId, body: "olá" }),
    });
    expect(ok.status).toBe(202);
    const { data } = await admin.from("whatsapp_outbox").select("tenant_id").eq("body", "olá").eq("contact_id", A.contactId);
    expect(data!.every((r) => r.tenant_id === A.tenantId)).toBe(true);
  });

  it.runIf(Boolean(APP))("API /api/avisos: A só vê os números e as mensagens recebidas de A", async () => {
    await admin.from("interactions").insert([
      { tenant_id: A.tenantId, contact_id: A.contactId, type: "whatsapp", direction: "entrada", body: `aviso-A-${run}` },
      { tenant_id: B.tenantId, contact_id: B.contactId, type: "whatsapp", direction: "entrada", body: `aviso-B-${run}` },
    ]).throwOnError();
    await admin.from("whatsapp_sessions").update({ status: "erro", last_error: `bloqueado-B-${run}` }).eq("tenant_id", B.tenantId);
    const r = await fetch(`${APP}/api/avisos`, { headers: { Authorization: `Bearer ${A.token}` } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.numbers.map((n: { id: string }) => n.id)).toEqual([A.sessionId]);
    expect(JSON.stringify(body)).not.toContain(`bloqueado-B-${run}`);
    expect(JSON.stringify(body)).not.toContain(`aviso-B-${run}`);
    expect(body.lastInbound?.contact_id).toBe(A.contactId);
    // tenant_id vindo do front é recusado
    const forged = await fetch(`${APP}/api/avisos?tenant_id=${B.tenantId}`, { headers: { Authorization: `Bearer ${A.token}` } });
    expect(forged.status).toBe(400);
    await admin.from("whatsapp_sessions").update({ status: "conectado", last_error: null }).eq("tenant_id", B.tenantId);
  });
});
