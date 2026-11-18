/**
 * Isolamento via API REST do próprio CRM (Route Handlers do Next.js).
 * Logado como tenant A (Bearer JWT real do Supabase Auth), tenta ler,
 * criar, editar e excluir dados do tenant B — e tenta "escolher" o tenant
 * via query, header e corpo. Tudo deve falhar.
 *
 * Requer: APP_URL (Next rodando) + SUPABASE_URL/ANON/SERVICE_ROLE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const APP = process.env.APP_URL;
const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(APP && URL && ANON && SERVICE);

it.runIf(Boolean(process.env.REQUIRE_API_TESTS) && !enabled)("variáveis presentes", () => {
  throw new Error("APP_URL/SUPABASE_* ausentes: testes da API do app não podem ser ignorados no CI");
});

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const run = randomUUID().slice(0, 8);

interface T {
  tenantId: string;
  userId: string;
  token: string;
  contactId: string;
  tagId: string;
  stageId: string;
  taskId: string;
  interactionId: string;
  departmentId: string;
}

let admin: SupabaseClient;
const users: string[] = [];
const tenants: string[] = [];
let A: T;
let B: T;

async function api(t: T, path: string, init: RequestInit = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as Record<string, unknown> & unknown[] };
}

async function setup(label: string): Promise<T> {
  const email = `next-${label}-${run}@teste.connecta.local`;
  const password = `Senha-${randomUUID()}`;
  const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  users.push(u.user.id);
  const { data: tenantId, error: e2 } = await admin.rpc("create_tenant_with_admin", {
    p_name: `Next ${label}`,
    p_slug: `next-${label}-${run}`,
    p_admin_user_id: u.user.id,
  });
  if (e2) throw e2;
  tenants.push(tenantId as string);
  const c = createClient(URL!, ANON!, opts);
  const { data: s, error: e3 } = await c.auth.signInWithPassword({ email, password });
  if (e3) throw e3;
  const t = { tenantId, userId: u.user.id, token: s.session!.access_token } as T;

  const tag = await api(t, "/api/tags", { method: "POST", body: JSON.stringify({ name: `tag-${label}` }) });
  expect(tag.status).toBe(201);
  t.tagId = tag.body.id as string;
  const contact = await api(t, "/api/contacts", {
    method: "POST",
    body: JSON.stringify({ name: `Contato ${label}`, tag_ids: [t.tagId] }),
  });
  expect(contact.status).toBe(201);
  t.contactId = contact.body.id as string;
  t.stageId = contact.body.stage_id as string;
  const task = await api(t, "/api/tasks", { method: "POST", body: JSON.stringify({ title: `Tarefa ${label}`, contact_id: t.contactId }) });
  t.taskId = task.body.id as string;
  const inter = await api(t, "/api/interactions", {
    method: "POST",
    body: JSON.stringify({ contact_id: t.contactId, type: "nota", body: `segredo ${label}` }),
  });
  t.interactionId = inter.body.id as string;
  const dept = await api(t, "/api/departments", { method: "POST", body: JSON.stringify({ name: `Setor ${label}` }) });
  expect(dept.status).toBe(201);
  t.departmentId = dept.body.id as string;
  return t;
}

describe.skipIf(!enabled)("isolamento via API do app (Next.js)", () => {
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

  it("sem token: 401", async () => {
    const r = await fetch(`${APP}/api/contacts`);
    expect(r.status).toBe(401);
  });

  it("token inválido: 401", async () => {
    const r = await fetch(`${APP}/api/contacts`, { headers: { Authorization: "Bearer abc.def.ghi" } });
    expect(r.status).toBe(401);
  });

  it("/api/me reflete o tenant da sessão", async () => {
    const r = await api(A, "/api/me");
    expect(r.status).toBe(200);
    expect(r.body.tenant_id).toBe(A.tenantId);
  });

  it("LER: listas só trazem dados de A", async () => {
    const contacts = await api(A, "/api/contacts");
    const items = contacts.body.items as { id: string; tenant_id: string }[];
    expect(items.map((c) => c.id)).toEqual([A.contactId]);
    for (const p of ["/api/tags", "/api/stages", "/api/tasks", "/api/members"]) {
      const r = await api(A, p);
      expect(r.status, p).toBe(200);
      const ids = (r.body as unknown as { id: string }[]).map((x) => x.id);
      expect(ids, p).not.toContain(B.tagId);
      expect(ids, p).not.toContain(B.stageId);
      expect(ids, p).not.toContain(B.taskId);
    }
    const dash = await api(A, "/api/dashboard");
    expect(dash.body.contacts_total).toBe(1);
  });

  it("LER: acessar recurso de B por id retorna 404", async () => {
    expect((await api(A, `/api/contacts/${B.contactId}`)).status).toBe(404);
    const inter = await api(A, `/api/contacts/${B.contactId}/interactions`);
    expect(inter.body).toEqual([]);
  });

  it("não é possível escolher o tenant por query, header ou corpo", async () => {
    expect((await api(A, `/api/contacts?tenant_id=${B.tenantId}`)).status).toBe(400);
    expect((await api(A, "/api/contacts", { headers: { "X-Tenant-Id": B.tenantId } })).status).toBe(400);
    const r = await api(A, "/api/contacts", {
      method: "POST",
      body: JSON.stringify({ name: "invasor", tenant_id: B.tenantId }),
    });
    expect(r.status).toBe(400);
    const nested = await api(A, `/api/contacts/${A.contactId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "x", meta: { tenant_id: B.tenantId } }),
    });
    expect(nested.status).toBe(400);
  });

  it("CRIAR: A não cria registros ligados a dados de B", async () => {
    const i = await api(A, "/api/interactions", {
      method: "POST",
      body: JSON.stringify({ contact_id: B.contactId, type: "nota", body: "x" }),
    });
    expect(i.status).toBeGreaterThanOrEqual(400);
    const c = await api(A, "/api/contacts", {
      method: "POST",
      body: JSON.stringify({ name: "x", stage_id: B.stageId }),
    });
    expect(c.status).toBeGreaterThanOrEqual(400);
    const ct = await api(A, "/api/contacts", {
      method: "POST",
      body: JSON.stringify({ name: "y", tag_ids: [B.tagId] }),
    });
    expect(ct.status).toBeGreaterThanOrEqual(400);
    const t = await api(A, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "x", contact_id: B.contactId }),
    });
    expect(t.status).toBeGreaterThanOrEqual(400);
    const t2 = await api(A, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "x", assigned_to: B.userId }),
    });
    expect(t2.status).toBeGreaterThanOrEqual(400);
  });

  it("EDITAR: PATCH em recursos de B retorna 404 e nada muda", async () => {
    for (const [p, body] of [
      [`/api/contacts/${B.contactId}`, { name: "HACKEADO" }],
      [`/api/tags/${B.tagId}`, { name: "HACKEADO" }],
      [`/api/tasks/${B.taskId}`, { title: "HACKEADO" }],
      [`/api/stages/${B.stageId}`, { name: "HACKEADO" }],
    ] as const) {
      const r = await api(A, p, { method: "PATCH", body: JSON.stringify(body) });
      expect(r.status, p).toBe(404);
    }
    const mv = await api(A, `/api/contacts/${B.contactId}/move`, {
      method: "POST",
      body: JSON.stringify({ stage_id: A.stageId, position: 0 }),
    });
    expect(mv.status).toBe(404);
    const check = await api(B, `/api/contacts/${B.contactId}`);
    expect(check.body.name).toBe("Contato b");
    expect(check.body.stage_id).toBe(B.stageId);
  });

  it("EXCLUIR: DELETE em recursos de B retorna 404 e os dados permanecem", async () => {
    for (const p of [
      `/api/contacts/${B.contactId}`,
      `/api/tags/${B.tagId}`,
      `/api/tasks/${B.taskId}`,
      `/api/stages/${B.stageId}`,
      `/api/interactions/${B.interactionId}`,
    ]) {
      const r = await api(A, p, { method: "DELETE" });
      expect(r.status, p).toBe(404);
    }
    expect((await api(B, `/api/contacts/${B.contactId}`)).status).toBe(200);
    const tasks = await api(B, "/api/tasks");
    expect((tasks.body as unknown as { id: string }[]).map((t) => t.id)).toContain(B.taskId);
    const inter = await api(B, `/api/contacts/${B.contactId}/interactions`);
    expect((inter.body as unknown as { id: string }[]).map((i) => i.id)).toContain(B.interactionId);
  });

  it("membros/auditoria: admin de A não vê nem altera membros de B", async () => {
    const audit = await api(A, "/api/audit");
    expect(audit.status).toBe(200);
    const bMembers = await admin.from("memberships").select("id").eq("tenant_id", B.tenantId);
    const bMemberId = bMembers.data![0].id;
    expect((await api(A, `/api/members/${bMemberId}`, { method: "PATCH", body: JSON.stringify({ profile: "atendente" }) })).status).toBe(404);
    expect((await api(A, `/api/members/${bMemberId}`, { method: "DELETE" })).status).toBe(404);
  });

  it("setores: A não vê, não altera, não exclui e não usa setores de B", async () => {
    const list = await api(A, "/api/departments");
    expect((list.body as unknown as { id: string }[]).map((d) => d.id)).toEqual([A.departmentId]);
    expect((await api(A, `/api/departments/${B.departmentId}`, { method: "PATCH", body: JSON.stringify({ name: "x" }) })).status).toBe(404);
    expect((await api(A, `/api/departments/${B.departmentId}`, { method: "DELETE" })).status).toBe(404);
    // Ligar contato de A a setor de B falha (FK composta por tenant)
    const r = await api(A, `/api/contacts/${A.contactId}`, {
      method: "PATCH",
      body: JSON.stringify({ department_id: B.departmentId }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    // Criar usuário em A com setor de B é recusado (e nenhum login fica criado)
    const email = `next-x-${run}@teste.connecta.local`;
    const inv = await api(A, "/api/members", {
      method: "POST",
      body: JSON.stringify({ email, password: `Senha-${randomUUID()}`, display_name: "X", profile: "atendente", department_ids: [B.departmentId] }),
    });
    expect(inv.status).toBe(400);
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.some((u) => u.email === email)).toBe(false);
    const bDept = await admin.from("departments").select("name").eq("id", B.departmentId).single();
    expect(bDept.data!.name).toBe("Setor b");
  });

  it("perfis: usuário criado por A como atendente recebe as permissões do perfil e fica em A", async () => {
    const email = `next-at-${run}@teste.connecta.local`;
    const password = `Senha-${randomUUID()}`;
    const inv = await api(A, "/api/members", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name: "Atendente A", profile: "atendente", department_ids: [A.departmentId] }),
    });
    expect(inv.status).toBe(201);
    users.push(inv.body.user_id as string);
    const c = createClient(URL!, ANON!, opts);
    const { data: s } = await c.auth.signInWithPassword({ email, password });
    const at = { ...A, token: s.session!.access_token };
    const me = await api(at, "/api/me");
    expect(me.body.tenant_id).toBe(A.tenantId);
    expect(me.body.profile).toBe("atendente");
    expect(me.body.department_ids).toEqual([A.departmentId]);
    expect(me.body.permissions).not.toContain("equipe.gerenciar");
    // Atendente não gerencia equipe nem setores
    expect((await api(at, "/api/departments", { method: "POST", body: JSON.stringify({ name: "hack" }) })).status).toBe(403);
    expect((await api(at, "/api/members", { method: "POST", body: JSON.stringify({ email: `z-${run}@teste.connecta.local`, password: `Senha-${randomUUID()}`, display_name: "Z", profile: "admin" }) })).status).toBe(403);
    // Contato sem setor (criado pelo admin) é visível; criar contato vai para o setor dele
    const created = await api(at, "/api/contacts", { method: "POST", body: JSON.stringify({ name: "Lead do setor" }) });
    expect(created.status).toBe(201);
    expect(created.body.department_id).toBe(A.departmentId);
  });

  it("painel da CONNECTA: admin de um cliente não lista nem cria clientes", async () => {
    const list = await api(A, "/api/plataforma/clientes");
    expect(list.status).toBe(403);
    expect(JSON.stringify(list.body)).not.toContain(B.tenantId);
    const slug = `invasor-${run}`;
    const email = `invasor-${run}@teste.connecta.local`;
    const r = await api(A, "/api/plataforma/clientes", {
      method: "POST",
      body: JSON.stringify({ name: "Invasor", slug, admin_email: email, admin_password: `Senha-${randomUUID()}`, admin_name: "X" }),
    });
    expect(r.status).toBe(403);
    const t = await admin.from("tenants").select("id").eq("slug", slug);
    expect(t.data).toEqual([]);
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.some((u) => u.email === email)).toBe(false);
    // sem login: 401
    expect((await fetch(`${APP}/api/plataforma/clientes`)).status).toBe(401);
  });

  it("suspensão: admin de um cliente não suspende outro; cliente suspenso recebe 423 e não vê dados", async () => {
    const r = await api(A, `/api/plataforma/clientes/${B.tenantId}/suspensao`, {
      method: "POST",
      body: JSON.stringify({ suspenso: true, motivo: "invasão" }),
    });
    expect(r.status).toBe(403);
    const t = await admin.from("tenants").select("suspended_at").eq("id", B.tenantId).single();
    expect(t.data!.suspended_at).toBeNull();

    // suspende A pelo service_role (o painel faz isso via função do banco)
    await admin.from("tenants").update({ suspended_at: new Date().toISOString(), suspended_reason: "teste" }).eq("id", A.tenantId);
    try {
      for (const path of ["/api/me", "/api/contacts", "/api/tasks", "/api/dashboard"]) {
        const res = await api(A, path);
        expect(res.status, path).toBe(423);
        expect(JSON.stringify(res.body)).not.toContain(A.contactId);
      }
      expect((await api(A, "/api/contacts", { method: "POST", body: JSON.stringify({ name: "x" }) })).status).toBe(423);
      expect((await api(B, "/api/contacts")).status).toBe(200);
    } finally {
      await admin.from("tenants").update({ suspended_at: null, suspended_reason: null }).eq("id", A.tenantId);
    }
    expect((await api(A, `/api/contacts/${A.contactId}`)).status).toBe(200);
  });
});
