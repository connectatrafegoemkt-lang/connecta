/**
 * Testes de isolamento VIA API do Supabase (PostgREST + Storage + RPC),
 * exatamente como um atacante logado faria a partir do navegador.
 *
 * Requer um Supabase rodando (CI: `supabase start`). Variáveis:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 * Sem elas, a suíte é ignorada (ex.: máquina sem Docker).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(URL && ANON && SERVICE);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

interface ApiTenant {
  tenantId: string;
  userId: string;
  client: SupabaseClient;
  contactId: string;
  stageId: string;
  tagId: string;
  interactionId: string;
  taskId: string;
  filePath: string;
}

const run = randomUUID().slice(0, 8);
let admin: SupabaseClient;
const createdUsers: string[] = [];
const createdTenants: string[] = [];

async function newUser(label: string) {
  const email = `${label}-${run}@teste.connecta.local`;
  const password = `Senha-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUsers.push(data.user.id);
  return { id: data.user.id, email, password };
}

async function signIn(email: string, password: string) {
  const client = createClient(URL!, ANON!, opts);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function setupTenant(label: string): Promise<ApiTenant> {
  const u = await newUser(label);
  const { data: tenantId, error } = await admin.rpc("create_tenant_with_admin", {
    p_name: `API ${label}`,
    p_slug: `api-${label}-${run}`,
    p_admin_user_id: u.id,
    p_admin_name: `Admin ${label}`,
  });
  if (error) throw error;
  createdTenants.push(tenantId as string);
  const client = await signIn(u.email, u.password);

  const { data: stage } = await client.from("pipeline_stages").select("id").order("position").limit(1).single();
  const { data: contact, error: e1 } = await client
    .from("contacts")
    .insert({ name: `Contato ${label}`, stage_id: stage!.id, value_cents: 5000 })
    .select("id")
    .single();
  if (e1) throw e1;
  const { data: tag, error: e2 } = await client.from("tags").insert({ name: `tag-${label}` }).select("id").single();
  if (e2) throw e2;
  await client.from("contact_tags").insert({ contact_id: contact!.id, tag_id: tag!.id }).throwOnError();
  const { data: inter } = await client
    .from("interactions")
    .insert({ contact_id: contact!.id, type: "nota", body: `segredo ${label}` })
    .select("id")
    .single()
    .throwOnError();
  const { data: task } = await client
    .from("tasks")
    .insert({ contact_id: contact!.id, title: `Tarefa ${label}` })
    .select("id")
    .single()
    .throwOnError();
  const filePath = `${tenantId}/contatos/${contact!.id}/doc.txt`;
  const up = await client.storage.from("tenant-files").upload(filePath, new Blob([`arquivo ${label}`]), {
    contentType: "text/plain",
  });
  if (up.error) throw up.error;

  return {
    tenantId: tenantId as string,
    userId: u.id,
    client,
    contactId: contact!.id,
    stageId: stage!.id,
    tagId: tag!.id,
    interactionId: inter!.id,
    taskId: task!.id,
    filePath,
  };
}

// No CI a suíte é obrigatória: se as variáveis faltarem, falha em vez de pular.
it.runIf(Boolean(process.env.REQUIRE_API_TESTS) && !enabled)("variáveis do Supabase presentes", () => {
  throw new Error("SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY ausentes: testes de API não podem ser ignorados no CI");
});

let A: ApiTenant;
let B: ApiTenant;

describe.skipIf(!enabled)("isolamento via API (PostgREST/Storage)", () => {
  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, opts);
    A = await setupTenant("a");
    B = await setupTenant("b");
  });

  afterAll(async () => {
    if (!admin) return;
    for (const t of [A, B]) if (t) await admin.storage.from("tenant-files").remove([t.filePath]);
    if (createdTenants.length) await admin.from("tenants").delete().in("id", createdTenants);
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  });

  const tables = () =>
    [
      ["contacts", B.contactId, { name: "HACKEADO" }],
      ["pipeline_stages", B.stageId, { name: "HACKEADO" }],
      ["tags", B.tagId, { name: "HACKEADO" }],
      ["interactions", B.interactionId, { body: "HACKEADO" }],
      ["tasks", B.taskId, { title: "HACKEADO" }],
    ] as const;

  it("LER: A não obtém nenhuma linha de B (por id, por tenant_id ou listando)", async () => {
    for (const [t, id] of tables()) {
      const byId = await A.client.from(t).select("*").eq("id", id);
      expect(byId.data, t).toEqual([]);
      const byTenant = await A.client.from(t).select("*").eq("tenant_id", B.tenantId);
      expect(byTenant.data, t).toEqual([]);
      const all = await A.client.from(t).select("tenant_id");
      expect(all.error).toBeNull();
      expect(all.data!.every((r) => r.tenant_id === A.tenantId), t).toBe(true);
    }
    for (const t of ["memberships", "contact_tags", "audit_logs"]) {
      const r = await A.client.from(t).select("tenant_id").eq("tenant_id", B.tenantId);
      expect(r.data ?? [], t).toEqual([]);
    }
    const tenants = await A.client.from("tenants").select("id");
    expect(tenants.data!.map((r) => r.id)).toEqual([A.tenantId]);
  });

  it("LER: RPCs retornam apenas dados do tenant A", async () => {
    const ctx = await A.client.rpc("current_context");
    expect(ctx.data).toHaveLength(1);
    expect(ctx.data![0].tenant_id).toBe(A.tenantId);
    const dash = await A.client.rpc("dashboard_summary");
    expect(dash.data.contacts_total).toBe(1);
    expect(dash.data.by_stage.map((s: { id: string }) => s.id)).not.toContain(B.stageId);
  });

  it("CRIAR: insert com tenant_id de B falha em todas as tabelas", async () => {
    const payloads: [string, Record<string, unknown>][] = [
      ["contacts", { tenant_id: B.tenantId, name: "invasor" }],
      ["tags", { tenant_id: B.tenantId, name: "invasora" }],
      ["tasks", { tenant_id: B.tenantId, title: "invasora" }],
      ["interactions", { tenant_id: B.tenantId, contact_id: B.contactId, type: "nota" }],
      ["contact_tags", { tenant_id: B.tenantId, contact_id: B.contactId, tag_id: B.tagId }],
      ["pipeline_stages", { tenant_id: B.tenantId, name: "invasora" }],
      ["memberships", { tenant_id: B.tenantId, user_id: A.userId, role: "admin" }],
      ["audit_logs", { tenant_id: B.tenantId, action: "INSERT", table_name: "x" }],
      ["tenants", { name: "novo", slug: `invasor-${run}` }],
    ];
    for (const [t, payload] of payloads) {
      const r = await A.client.from(t).insert(payload).select();
      expect(r.error, `${t} aceitou insert`).not.toBeNull();
    }
    const bContacts = await admin.from("contacts").select("id").eq("tenant_id", B.tenantId);
    expect(bContacts.data).toHaveLength(1);
  });

  it("CRIAR: A não vincula registros a contatos/tags/etapas de B", async () => {
    const r1 = await A.client.from("interactions").insert({ contact_id: B.contactId, type: "nota", body: "x" });
    expect(r1.error).not.toBeNull();
    const r2 = await A.client.from("contact_tags").insert({ contact_id: A.contactId, tag_id: B.tagId });
    expect(r2.error).not.toBeNull();
    const r3 = await A.client.from("contacts").insert({ name: "x", stage_id: B.stageId });
    expect(r3.error).not.toBeNull();
    const r4 = await A.client.from("tasks").insert({ title: "x", assigned_to: B.userId });
    expect(r4.error).not.toBeNull();
  });

  it("CRIAR: tenant_id omitido é preenchido com o tenant da sessão", async () => {
    const r = await A.client.from("tags").insert({ name: `auto-${run}` }).select("tenant_id").single();
    expect(r.error).toBeNull();
    expect(r.data!.tenant_id).toBe(A.tenantId);
  });

  it("EDITAR: update em registros de B não altera nada", async () => {
    for (const [t, id, patch] of tables()) {
      const r = await A.client.from(t).update(patch).eq("id", id).select();
      expect(r.data ?? [], t).toEqual([]);
    }
    const mv = await A.client.from("contacts").update({ tenant_id: B.tenantId }).eq("id", A.contactId).select();
    expect(mv.error).not.toBeNull();
    const t = await A.client.from("tenants").update({ name: "HACKEADO" }).eq("id", B.tenantId).select();
    expect(t.data ?? []).toEqual([]);

    const check = await admin.from("contacts").select("name, tenant_id").in("id", [A.contactId, B.contactId]);
    expect(check.data!.find((c) => c.name === "HACKEADO")).toBeUndefined();
    expect(check.data!.every((c) => c.tenant_id !== null)).toBe(true);
    const own = check.data!.find((c) => c.name === "Contato a");
    expect(own?.tenant_id).toBe(A.tenantId);
  });

  it("EXCLUIR: delete em registros de B não remove nada", async () => {
    for (const [t, id] of tables()) {
      const r = await A.client.from(t).delete().eq("id", id).select();
      expect(r.data ?? [], t).toEqual([]);
    }
    await A.client.from("memberships").delete().eq("tenant_id", B.tenantId);
    await A.client.from("tenants").delete().eq("id", B.tenantId);
    for (const [t, id] of tables()) {
      const still = await admin.from(t).select("id").eq("id", id);
      expect(still.data, `${t} foi excluído`).toHaveLength(1);
    }
    const m = await admin.from("memberships").select("id").eq("tenant_id", B.tenantId);
    expect(m.data).toHaveLength(1);
  });

  it("STORAGE: A não lista, baixa, sobrescreve, move nem exclui arquivos de B", async () => {
    const list = await A.client.storage.from("tenant-files").list(B.tenantId);
    expect(list.data ?? []).toEqual([]);
    const dl = await A.client.storage.from("tenant-files").download(B.filePath);
    expect(dl.error).not.toBeNull();
    const signed = await A.client.storage.from("tenant-files").createSignedUrl(B.filePath, 60);
    expect(signed.error).not.toBeNull();
    const up = await A.client.storage
      .from("tenant-files")
      .upload(`${B.tenantId}/invasao.txt`, new Blob(["x"]), { contentType: "text/plain" });
    expect(up.error).not.toBeNull();
    const over = await A.client.storage
      .from("tenant-files")
      .upload(B.filePath, new Blob(["sobrescrito"]), { upsert: true, contentType: "text/plain" });
    expect(over.error).not.toBeNull();
    await A.client.storage.from("tenant-files").move(B.filePath, `${A.tenantId}/roubado.txt`);
    await A.client.storage.from("tenant-files").remove([B.filePath]);

    const still = await admin.storage.from("tenant-files").download(B.filePath);
    expect(still.error).toBeNull();
    expect(await still.data!.text()).toBe("arquivo b");
  });

  it("anon (sem login) não lê nada", async () => {
    const anon = createClient(URL!, ANON!, opts);
    for (const t of ["contacts", "tenants", "interactions", "tasks", "tags"]) {
      const r = await anon.from(t).select("*");
      expect((r.data ?? []).length, t).toBe(0);
    }
  });

  it("A não executa o onboarding de tenants", async () => {
    const r = await A.client.rpc("create_tenant_with_admin", {
      p_name: "x",
      p_slug: `x-${run}`,
      p_admin_user_id: A.userId,
    });
    expect(r.error).not.toBeNull();
  });
});
