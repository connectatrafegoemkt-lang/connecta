/**
 * Setores e permissões dentro de um tenant (e o isolamento entre tenants
 * continua valendo para todos os perfis).
 *
 * Cenário no tenant A:
 *   setores: Comercial, Jurídico
 *   atendente  -> só Comercial
 *   gerente    -> perfil gerente (vê todos os setores)
 *   leitura    -> perfil só leitura, sem setor
 *   contatos: cCom (Comercial), cJur (Jurídico), cSem (sem setor)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";
import { PERMISSION_KEYS, PROFILE_PERMISSIONS } from "../../src/shared/permissions";

let A: TenantFixture;
let B: TenantFixture;
let gerente: string;
let leitura: string;
let depCom: string;
let depJur: string;
let cCom: string;
let cJur: string;
let cSem: string;
const extraUsers: string[] = [];

async function newUser(label: string) {
  const id = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [id, `${label}-${id.slice(0, 6)}@teste.local`]);
  extraUsers.push(id);
  return id;
}

beforeAll(async () => {
  A = await createTenantFixture("perm-a");
  B = await createTenantFixture("perm-b");
  gerente = await newUser("gerente");
  leitura = await newUser("leitura");

  await as({ userId: A.adminId }, async (q) => {
    await q("insert into public.memberships (user_id, profile, display_name) values ($1, 'gerente', 'Gerente A')", [gerente]);
    await q("insert into public.memberships (user_id, profile, display_name) values ($1, 'leitura', 'Leitura A')", [leitura]);
    depCom = (await q<{ id: string }>("insert into public.departments (name) values ('Comercial') returning id")).rows[0].id;
    depJur = (await q<{ id: string }>("insert into public.departments (name) values ('Jurídico') returning id")).rows[0].id;
    await q("insert into public.member_departments (user_id, department_id) values ($1, $2)", [A.atendenteId, depCom]);
    cCom = (await q<{ id: string }>("insert into public.contacts (name, department_id, phone) values ('Cliente Comercial', $1, '5511910000001') returning id", [depCom])).rows[0].id;
    cJur = (await q<{ id: string }>("insert into public.contacts (name, department_id, phone) values ('Cliente Jurídico', $1, '5511910000002') returning id", [depJur])).rows[0].id;
    cSem = (await q<{ id: string }>("insert into public.contacts (name, phone) values ('Cliente Sem Setor', '5511910000003') returning id")).rows[0].id;
    await q("insert into public.interactions (contact_id, type, body) values ($1, 'nota', 'segredo jurídico')", [cJur]);
    await q("insert into public.tasks (contact_id, title) values ($1, 'tarefa jurídica')", [cJur]);
    await q("insert into public.contact_tags (contact_id, tag_id) values ($1, $2)", [cJur, A.tagId]);
    await q("insert into public.whatsapp_outbox (contact_id, body, scheduled_at) values ($1, 'msg jurídica', now() + interval '1 day')", [cJur]);
  });
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [
    [A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId, ...extraUsers].filter(Boolean),
  ]);
  await pool.end();
});

const names = async (uid: string) =>
  (await as({ userId: uid }, (q) => q<{ name: string }>("select name from public.contacts order by name"))).rows.map((r) => r.name);

describe("perfis padrão", () => {
  it("cada perfil recebe as permissões do modelo e o contexto da sessão as devolve", async () => {
    const ctx = await as({ userId: A.atendenteId }, (q) =>
      q<{ profile: string; permissions: string[]; department_ids: string[] }>("select profile, permissions, department_ids from public.current_context()"),
    );
    expect(ctx.rows[0].profile).toBe("atendente");
    expect(ctx.rows[0].permissions).toContain("whatsapp.enviar");
    expect(ctx.rows[0].permissions).not.toContain("equipe.gerenciar");
    expect(ctx.rows[0].department_ids).toEqual([depCom]);
    const adm = await as({ userId: A.adminId }, (q) => q<{ permissions: string[] }>("select permissions from public.current_context()"));
    expect(adm.rows[0].permissions).toContain("equipe.gerenciar");
  });

  it("permissão desconhecida é recusada", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("update public.memberships set permissions = array['contatos.ver','tudo.liberado'] where user_id = $1", [leitura]),
      ),
    );
  });
});

describe("visibilidade por setor", () => {
  it("atendente do Comercial vê só Comercial + sem setor", async () => {
    const n = await names(A.atendenteId);
    expect(n).toContain("Cliente Comercial");
    expect(n).toContain("Cliente Sem Setor");
    expect(n).not.toContain("Cliente Jurídico");
  });

  it("e não vê nada ligado ao contato do Jurídico (histórico, tarefas, tags, fila)", async () => {
    await as({ userId: A.atendenteId }, async (q) => {
      expect((await q("select 1 from public.interactions where contact_id = $1", [cJur])).rowCount).toBe(0);
      expect((await q("select 1 from public.tasks where contact_id = $1", [cJur])).rowCount).toBe(0);
      expect((await q("select 1 from public.contact_tags where contact_id = $1", [cJur])).rowCount).toBe(0);
      expect((await q("select 1 from public.whatsapp_outbox where contact_id = $1", [cJur])).rowCount).toBe(0);
      const body = await q("select 1 from public.interactions where body = 'segredo jurídico'");
      expect(body.rowCount).toBe(0);
    });
  });

  it("atendente não altera, exclui, nem cria coisas no Jurídico", async () => {
    await as({ userId: A.atendenteId }, async (q) => {
      expect((await q("update public.contacts set name = 'HACK' where id = $1", [cJur])).rowCount).toBe(0);
      expect((await q("delete from public.tasks where contact_id = $1", [cJur])).rowCount).toBe(0);
    });
    for (const sql of [
      ["insert into public.contacts (name, department_id) values ('x', $1)", [depJur]],
      ["insert into public.interactions (contact_id, type, body) values ($1, 'nota', 'x')", [cJur]],
      ["insert into public.tasks (contact_id, title) values ($1, 'x')", [cJur]],
      ["insert into public.whatsapp_outbox (contact_id, body) values ($1, 'x')", [cJur]],
      ["update public.contacts set department_id = $1 where id = $2", [depJur, cCom]],
    ] as const) {
      await expectDbError(as({ userId: A.atendenteId }, (q) => q(sql[0], [...sql[1]])));
    }
    const [c] = await raw<{ department_id: string; name: string }>("select department_id, name from public.contacts where id = $1", [cCom]);
    expect(c.department_id).toBe(depCom);
    expect((await raw<{ name: string }>("select name from public.contacts where id = $1", [cJur]))[0].name).toBe("Cliente Jurídico");
  });

  it("gerente (todos os setores) vê tudo do próprio tenant e nada de B", async () => {
    const n = await names(gerente);
    expect(n).toEqual(expect.arrayContaining(["Cliente Comercial", "Cliente Jurídico", "Cliente Sem Setor"]));
    await as({ userId: gerente }, async (q) => {
      expect((await q("select 1 from public.contacts where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
      expect((await q("select 1 from public.departments where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
    });
  });

  it("excluir um setor devolve os contatos para 'sem setor'", async () => {
    const tmp = await as({ userId: A.adminId }, async (q) => {
      const d = (await q<{ id: string }>("insert into public.departments (name) values ('Temporário') returning id")).rows[0].id;
      const c = (await q<{ id: string }>("insert into public.contacts (name, department_id) values ('Contato temp', $1) returning id", [d])).rows[0].id;
      await q("delete from public.departments where id = $1", [d]);
      return c;
    });
    const [row] = await raw<{ department_id: string | null }>("select department_id from public.contacts where id = $1", [tmp]);
    expect(row.department_id).toBeNull();
  });
});

describe("permissões por ação", () => {
  it("perfil só leitura vê, mas não cria nem edita", async () => {
    expect(await names(leitura)).toContain("Cliente Sem Setor");
    await expectDbError(as({ userId: leitura }, (q) => q("insert into public.contacts (name) values ('x')")));
    await expectDbError(as({ userId: leitura }, (q) => q("insert into public.whatsapp_outbox (contact_id, body) values ($1, 'x')", [cSem])));
    const u = await as({ userId: leitura }, (q) => q("update public.contacts set name = 'HACK' where id = $1", [cSem]));
    expect(u.rowCount).toBe(0);
  });

  it("atendente não exclui contatos (sem 'contatos.excluir')", async () => {
    const d = await as({ userId: A.atendenteId }, (q) => q("delete from public.contacts where id = $1", [cSem]));
    expect(d.rowCount).toBe(0);
  });

  it("tirar 'whatsapp.enviar' do atendente bloqueia o envio", async () => {
    await as({ userId: A.adminId }, (q) =>
      q("update public.memberships set permissions = array['contatos.ver','whatsapp.ver'] where user_id = $1", [A.atendenteId]),
    );
    try {
      await expectDbError(as({ userId: A.atendenteId }, (q) => q("insert into public.whatsapp_outbox (contact_id, body) values ($1, 'x')", [cSem])));
    } finally {
      await as({ userId: A.adminId }, (q) =>
        q("update public.memberships set permissions = $1 where user_id = $2", [
          ["contatos.ver", "contatos.editar", "tarefas.editar", "whatsapp.ver", "whatsapp.enviar"],
          A.atendenteId,
        ]),
      );
    }
  });

  it("sem 'whatsapp.conectar' não vê o QR nem conecta o número", async () => {
    await expectDbError(as({ userId: gerente }, (q) => q("select public.whatsapp_request('conectar')")));
  });

  it("auditoria e IA respeitam as permissões", async () => {
    expect((await as({ userId: gerente }, (q) => q("select 1 from public.audit_logs"))).rowCount).toBeGreaterThan(0);
    expect((await as({ userId: A.atendenteId }, (q) => q("select 1 from public.audit_logs"))).rowCount).toBe(0);
    const ai = await as({ userId: gerente }, (q) => q("insert into public.ai_settings (mode) values ('automatico') on conflict do nothing").catch((e) => e));
    expect(ai instanceof Error).toBe(true);
  });
});

describe("gestão da equipe sem escalada de privilégio", () => {
  beforeAll(async () => {
    await as({ userId: A.adminId }, (q) =>
      q("update public.memberships set permissions = array_append(permissions, 'equipe.gerenciar') where user_id = $1", [gerente]),
    );
  });

  it("atendente não altera ninguém da equipe", async () => {
    const r = await as({ userId: A.atendenteId }, (q) => q("update public.memberships set profile = 'gerente' where user_id = $1", [A.atendenteId]));
    expect(r.rowCount).toBe(0);
    await expectDbError(
      as({ userId: A.atendenteId }, (q) => q("insert into public.member_departments (user_id, department_id) values ($1, $2)", [A.atendenteId, depJur])),
    );
  });

  it("gerente com 'equipe.gerenciar' não cria admin, não concede o que não tem e não mexe em si nem em admins", async () => {
    await expectDbError(as({ userId: gerente }, (q) => q("update public.memberships set profile = 'admin' where user_id = $1", [leitura])));
    await expectDbError(
      as({ userId: gerente }, (q) =>
        q("update public.memberships set permissions = array['contatos.ver','ia.configurar'] where user_id = $1", [leitura]),
      ),
    );
    await expectDbError(as({ userId: gerente }, (q) => q("update public.memberships set display_name = 'eu' where user_id = $1", [gerente])));
    await expectDbError(as({ userId: gerente }, (q) => q("update public.memberships set display_name = 'x' where user_id = $1", [A.adminId])));
    await expectDbError(as({ userId: gerente }, (q) => q("delete from public.memberships where user_id = $1", [A.adminId])));
    await expectDbError(
      as({ userId: gerente }, (q) => q("insert into public.member_departments (user_id, department_id) values ($1, $2)", [A.adminId, depJur])),
    );
    const [adm] = await raw<{ profile: string }>("select profile from public.memberships where user_id = $1", [A.adminId]);
    expect(adm.profile).toBe("admin");
  });

  it("gerente consegue ajustar um atendente dentro dos próprios limites", async () => {
    await as({ userId: gerente }, async (q) => {
      await q("update public.memberships set permissions = array['contatos.ver','contatos.editar','whatsapp.ver'] where user_id = $1", [leitura]);
      await q("insert into public.member_departments (user_id, department_id) values ($1, $2)", [leitura, depJur]);
    });
    const [m] = await raw<{ permissions: string[] }>("select permissions from public.memberships where user_id = $1", [leitura]);
    expect(m.permissions).toEqual(["contatos.ver", "contatos.editar", "whatsapp.ver"]);
  });

  it("gerente de A não toca em membros nem setores de B", async () => {
    await as({ userId: gerente }, async (q) => {
      expect((await q("update public.memberships set display_name = 'HACK' where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
      expect((await q("delete from public.departments where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
    });
  });
});

describe("catálogo do app = catálogo do banco", () => {
  it("permissões e perfis padrão de src/shared/permissions.ts batem com o banco", async () => {
    const [cat] = await raw<{ c: string[] }>("select app.permission_catalog() as c");
    expect([...cat.c].sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const [profile, perms] of Object.entries(PROFILE_PERMISSIONS)) {
      const [r] = await raw<{ p: string[] }>("select app.profile_permissions($1) as p", [profile]);
      expect([...r.p].sort(), profile).toEqual([...perms].sort());
    }
  });
});
