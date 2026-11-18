/**
 * Testes de isolamento multi-tenant no NÍVEL DO BANCO (RLS).
 *
 * Cenário: dois tenants (A e B). Logado como usuários do tenant A, tentamos
 * ler, criar, editar e excluir dados do tenant B. TUDO deve falhar e os
 * dados de B devem permanecer intactos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  A = await createTenantFixture("a");
  B = await createTenantFixture("b");
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [
    [A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId].filter(Boolean),
  ]);
  await pool.end();
});

/** Tabelas de negócio e o id do registro de B em cada uma. */
const businessTables = () =>
  [
    ["contacts", B.contactId],
    ["pipeline_stages", B.stageId],
    ["tags", B.tagId],
    ["interactions", B.interactionId],
    ["tasks", B.taskId],
  ] as const;

describe("garantias estruturais do schema", () => {
  it("TODAS as tabelas do schema public têm RLS ativado", async () => {
    const rows = await raw<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("toda tabela de negócio tem tenant_id NOT NULL e índice iniciando por tenant_id", async () => {
    const tables = await raw<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'tenants'`,
    );
    expect(tables.length).toBeGreaterThan(5);
    for (const { relname } of tables) {
      const col = await raw<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
         where table_schema = 'public' and table_name = $1 and column_name = 'tenant_id'`,
        [relname],
      );
      expect(col, `${relname} sem tenant_id`).toHaveLength(1);
      expect(col[0].is_nullable, `${relname}.tenant_id aceita null`).toBe("NO");

      const idx = await raw(
        `select 1 from pg_index i
         join pg_class t on t.oid = i.indrelid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
         where n.nspname = 'public' and t.relname = $1 and a.attname = 'tenant_id'`,
        [relname],
      );
      expect(idx.length, `${relname} sem índice por tenant_id`).toBeGreaterThan(0);
    }
  });

  it("toda tabela com tenant_id tem o trigger que força o tenant da sessão", async () => {
    const rows = await raw<{ table_name: string }>(
      `select c.table_name from information_schema.columns c
       where c.table_schema = 'public' and c.column_name = 'tenant_id'
         and c.table_name not in ('audit_logs')
         and not exists (
           select 1 from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
           where tg.tgrelid = ('public.' || c.table_name)::regclass and p.proname = 'enforce_tenant_id')`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});

describe("tenant A tentando LER dados do tenant B", () => {
  for (const user of ["admin", "atendente"] as const) {
    it(`${user} de A não enxerga nenhuma linha de B em nenhuma tabela`, async () => {
      const uid = user === "admin" ? A.adminId : A.atendenteId;
      await as({ userId: uid }, async (q) => {
        for (const t of ["contacts", "pipeline_stages", "tags", "contact_tags", "interactions", "tasks", "memberships"]) {
          const byTenant = await q(`select * from public.${t} where tenant_id = $1`, [B.tenantId]);
          expect(byTenant.rowCount, `${t} vazou por tenant_id`).toBe(0);
          const all = await q<{ tenant_id: string }>(`select tenant_id from public.${t}`);
          expect(all.rows.every((r) => r.tenant_id === A.tenantId), `${t} retornou linha de outro tenant`).toBe(true);
          expect(all.rowCount, `${t} deveria ter dados de A`).toBeGreaterThan(0);
        }
        for (const [t, id] of businessTables()) {
          const byId = await q(`select * from public.${t} where id = $1`, [id]);
          expect(byId.rowCount, `${t} vazou por id`).toBe(0);
        }
        const tenants = await q<{ id: string }>("select id from public.tenants");
        expect(tenants.rows.map((r) => r.id)).toEqual([A.tenantId]);
      });
    });
  }

  it("admin de A não lê logs de auditoria de B (e atendente não lê nenhum)", async () => {
    await as({ userId: A.adminId }, async (q) => {
      const own = await q<{ tenant_id: string }>("select tenant_id from public.audit_logs");
      expect(own.rowCount).toBeGreaterThan(0);
      expect(own.rows.every((r) => r.tenant_id === A.tenantId)).toBe(true);
      const other = await q("select * from public.audit_logs where tenant_id = $1", [B.tenantId]);
      expect(other.rowCount).toBe(0);
    });
    await as({ userId: A.atendenteId }, async (q) => {
      expect((await q("select * from public.audit_logs")).rowCount).toBe(0);
    });
  });

  it("busca textual não encontra conteúdo de B", async () => {
    await as({ userId: A.adminId }, async (q) => {
      const r = await q("select * from public.interactions where body ilike '%tenant b%'");
      expect(r.rowCount).toBe(0);
    });
  });

  it("dashboard_summary e current_context só refletem o tenant A", async () => {
    await as({ userId: A.adminId }, async (q) => {
      const ctx = await q<{ tenant_id: string }>("select * from public.current_context()");
      expect(ctx.rows).toHaveLength(1);
      expect(ctx.rows[0].tenant_id).toBe(A.tenantId);
      const d = await q<{ s: { contacts_total: number; by_stage: { id: string }[] } }>(
        "select public.dashboard_summary() as s",
      );
      expect(d.rows[0].s.contacts_total).toBe(1);
      const stageIds = d.rows[0].s.by_stage.map((s) => s.id);
      expect(stageIds).not.toContain(B.stageId);
    });
  });

  it("A não lista nem lê arquivos do prefixo de B no storage", async () => {
    await as({ userId: A.atendenteId }, async (q) => {
      const r = await q<{ name: string }>("select name from storage.objects where bucket_id = 'tenant-files'");
      expect(r.rows.map((x) => x.name)).toEqual([A.filePath]);
      const direct = await q("select * from storage.objects where name = $1", [B.filePath]);
      expect(direct.rowCount).toBe(0);
    });
  });
});

describe("tenant A tentando CRIAR dados no tenant B", () => {
  it("insert com tenant_id de B é rejeitado em todas as tabelas", async () => {
    const attempts: [string, string, unknown[]][] = [
      ["contacts", "insert into public.contacts (tenant_id, name) values ($1, 'invasor')", [B.tenantId]],
      ["tags", "insert into public.tags (tenant_id, name) values ($1, 'invasora')", [B.tenantId]],
      ["tasks", "insert into public.tasks (tenant_id, title) values ($1, 'invasora')", [B.tenantId]],
      ["interactions", "insert into public.interactions (tenant_id, contact_id, type) values ($1, $2, 'nota')", [B.tenantId, B.contactId]],
      ["contact_tags", "insert into public.contact_tags (tenant_id, contact_id, tag_id) values ($1, $2, $3)", [B.tenantId, B.contactId, B.tagId]],
      ["pipeline_stages", "insert into public.pipeline_stages (tenant_id, name) values ($1, 'invasora')", [B.tenantId]],
      ["memberships", "insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'admin')", [B.tenantId, A.atendenteId]],
    ];
    const countB = async (table: string) =>
      (await raw<{ n: number }>(`select count(*)::int as n from public.${table} where tenant_id = $1`, [B.tenantId]))[0].n;
    for (const [table, sql, params] of attempts) {
      const before = await countB(table);
      for (const user of [A.adminId, A.atendenteId]) {
        await expectDbError(as({ userId: user }, (q) => q(sql, params)));
      }
      expect(await countB(table), `${table}: linha criada em B`).toBe(before);
    }
  });

  it("insert sem tenant_id é forçado para o tenant da sessão (A)", async () => {
    const [row] = await as({ userId: A.atendenteId }, (q) =>
      q<{ tenant_id: string }>("insert into public.contacts (name) values ('Novo de A') returning tenant_id").then((r) => r.rows),
    );
    expect(row.tenant_id).toBe(A.tenantId);
  });

  it("A não consegue vincular registros próprios a registros de B (FK composta)", async () => {
    // interação de A apontando para contato de B
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.interactions (contact_id, type, body) values ($1, 'nota', 'x')", [B.contactId]),
      ),
    );
    // tarefa de A apontando para contato de B
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.tasks (contact_id, title) values ($1, 'x')", [B.contactId]),
      ),
    );
    // contato de A em etapa do funil de B
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.contacts (name, stage_id) values ('x', $1)", [B.stageId]),
      ),
    );
    // tag de B em contato de A
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.contact_tags (contact_id, tag_id) values ($1, $2)", [A.contactId, B.tagId]),
      ),
    );
    // tarefa atribuída a usuário de B / contato com responsável de B
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.tasks (title, assigned_to) values ('x', $1)", [B.atendenteId]),
      ),
    );
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into public.contacts (name, owner_id) values ('x', $1)", [B.adminId]),
      ),
    );
  });

  it("A não consegue enviar arquivo para o prefixo de B no storage", async () => {
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into storage.objects (bucket_id, name) values ('tenant-files', $1)", [`${B.tenantId}/invasao.txt`]),
      ),
    );
    await expectDbError(
      as({ userId: A.atendenteId }, (q) =>
        q("insert into storage.objects (bucket_id, name) values ('tenant-files', 'sem-prefixo.txt')"),
      ),
    );
    const ok = await as({ userId: A.atendenteId }, (q) =>
      q("insert into storage.objects (bucket_id, name) values ('tenant-files', $1) returning id", [
        `${A.tenantId}/ok-${randomUUID()}.txt`,
      ]),
    );
    expect(ok.rowCount).toBe(1);
  });

  it("ninguém consegue escrever diretamente em audit_logs", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("insert into public.audit_logs (tenant_id, action, table_name) values ($1, 'INSERT', 'fake')", [A.tenantId]),
      ),
    );
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("insert into public.audit_logs (tenant_id, action, table_name) values ($1, 'INSERT', 'fake')", [B.tenantId]),
      ),
    );
  });

  it("usuário autenticado não cria tenants nem executa o onboarding", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) => q("insert into public.tenants (name, slug) values ('x', 'x-invasor')")),
    );
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("select public.create_tenant_with_admin('x', 'x-invasor2', $1)", [A.adminId]),
      ),
    );
  });
});

describe("tenant A tentando EDITAR dados do tenant B", () => {
  it("update em registros de B afeta 0 linhas e nada muda", async () => {
    const before = await raw("select * from public.contacts where id = $1", [B.contactId]);
    await as({ userId: A.adminId }, async (q) => {
      for (const [t, id] of businessTables()) {
        const col = t === "tasks" ? "title" : t === "interactions" ? "body" : "name";
        const r = await q(`update public.${t} set ${col} = 'HACKEADO' where id = $1`, [id]);
        expect(r.rowCount, `${t} alterado`).toBe(0);
      }
      const all = await q("update public.contacts set notes = 'massa' where tenant_id = $1", [B.tenantId]);
      expect(all.rowCount).toBe(0);
      const m = await q("update public.memberships set role = 'atendente' where user_id = $1", [B.adminId]);
      expect(m.rowCount).toBe(0);
      const t = await q("update public.tenants set name = 'HACKEADO' where id = $1", [B.tenantId]);
      expect(t.rowCount).toBe(0);
    });
    const after = await raw("select * from public.contacts where id = $1", [B.contactId]);
    expect(after).toEqual(before);
    const hacked = await raw(
      `select 'x' from public.contacts where name = 'HACKEADO'
       union all select 'x' from public.tags where name = 'HACKEADO'
       union all select 'x' from public.tasks where title = 'HACKEADO'
       union all select 'x' from public.interactions where body = 'HACKEADO'
       union all select 'x' from public.tenants where name = 'HACKEADO'`,
    );
    expect(hacked).toHaveLength(0);
  });

  it("A não consegue mover um registro próprio para o tenant B", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("update public.contacts set tenant_id = $1 where id = $2", [B.tenantId, A.contactId]),
      ),
    );
    const [c] = await raw<{ tenant_id: string }>("select tenant_id from public.contacts where id = $1", [A.contactId]);
    expect(c.tenant_id).toBe(A.tenantId);
  });

  it("A não consegue apontar seu contato para a etapa de B via update", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("update public.contacts set stage_id = $1 where id = $2", [B.stageId, A.contactId]),
      ),
    );
  });

  it("A não consegue renomear/mover arquivo de B no storage", async () => {
    await as({ userId: A.adminId }, async (q) => {
      const r = await q("update storage.objects set name = $1 where name = $2", [
        `${A.tenantId}/roubado.pdf`,
        B.filePath,
      ]);
      expect(r.rowCount).toBe(0);
    });
    expect(await raw("select 1 from storage.objects where name = $1", [B.filePath])).toHaveLength(1);
  });
});

describe("tenant A tentando EXCLUIR dados do tenant B", () => {
  it("delete em registros de B afeta 0 linhas e os dados permanecem", async () => {
    await as({ userId: A.adminId }, async (q) => {
      for (const [t, id] of businessTables()) {
        const r = await q(`delete from public.${t} where id = $1`, [id]);
        expect(r.rowCount, `${t} excluído`).toBe(0);
      }
      expect((await q("delete from public.contact_tags where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
      expect((await q("delete from public.memberships where tenant_id = $1", [B.tenantId])).rowCount).toBe(0);
      expect((await q("delete from storage.objects where name = $1", [B.filePath])).rowCount).toBe(0);
    });
    // tenants e audit_logs: DELETE nem é permitido pela API (permission denied)
    await expectDbError(as({ userId: A.adminId }, (q) => q("delete from public.tenants where id = $1", [B.tenantId])));
    await expectDbError(as({ userId: A.adminId }, (q) => q("delete from public.audit_logs")));
    expect(await raw("select 1 from public.tenants where id = $1", [B.tenantId])).toHaveLength(1);
    for (const [t, id] of businessTables()) {
      expect(await raw(`select 1 from public.${t} where id = $1`, [id]), `${t} sumiu`).toHaveLength(1);
    }
    expect(await raw("select 1 from public.contact_tags where tenant_id = $1", [B.tenantId])).toHaveLength(1);
    expect(await raw("select 1 from public.memberships where tenant_id = $1", [B.tenantId])).toHaveLength(2);
    expect(await raw("select 1 from storage.objects where name = $1", [B.filePath])).toHaveLength(1);
    expect((await raw("select count(*)::int as n from public.audit_logs where tenant_id = $1", [B.tenantId]))[0].n).toBeGreaterThan(0);
  });
});

describe("usuários sem vínculo e anônimos", () => {
  it("anon não acessa nenhuma tabela", async () => {
    for (const t of ["contacts", "tenants", "memberships", "interactions", "tasks", "tags", "audit_logs"]) {
      const msg = await expectDbError(as("anon", (q) => q(`select * from public.${t}`)));
      expect(msg).toMatch(/permission denied/);
    }
  });

  it("usuário autenticado sem tenant não vê nem cria nada", async () => {
    const orphan = randomUUID();
    await raw("insert into auth.users (id, email) values ($1, $2)", [orphan, `orfao-${orphan}@teste.local`]);
    try {
      await as({ userId: orphan }, async (q) => {
        expect((await q("select * from public.contacts")).rowCount).toBe(0);
        expect((await q("select * from public.current_context()")).rowCount).toBe(0);
      });
      await expectDbError(as({ userId: orphan }, (q) => q("insert into public.contacts (name) values ('x')")));
      await expectDbError(
        as({ userId: orphan }, (q) =>
          q("insert into public.contacts (tenant_id, name) values ($1, 'x')", [B.tenantId]),
        ),
      );
    } finally {
      await raw("delete from auth.users where id = $1", [orphan]);
    }
  });
});

describe("roles dentro do tenant", () => {
  it("atendente não altera etapas do funil nem membros", async () => {
    await expectDbError(
      as({ userId: A.atendenteId }, (q) => q("insert into public.pipeline_stages (name) values ('nova')")),
    );
    await as({ userId: A.atendenteId }, async (q) => {
      expect((await q("update public.pipeline_stages set name = 'x' where id = $1", [A.stageId])).rowCount).toBe(0);
      expect((await q("delete from public.pipeline_stages where id = $1", [A.stageId])).rowCount).toBe(0);
      expect((await q("update public.memberships set role = 'admin' where user_id = $1", [A.atendenteId])).rowCount).toBe(0);
    });
  });

  it("admin gerencia etapas do próprio tenant", async () => {
    const r = await as({ userId: A.adminId }, (q) =>
      q<{ tenant_id: string }>("insert into public.pipeline_stages (name, position) values ('Negociação', 9) returning tenant_id"),
    );
    expect(r.rows[0].tenant_id).toBe(A.tenantId);
  });

  it("admin não consegue trocar o user_id de um vínculo (sequestro de conta)", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) =>
        q("update public.memberships set user_id = $1 where user_id = $2", [B.atendenteId, A.atendenteId]),
      ),
    );
  });
});

describe("auditoria", () => {
  it("registra tenant_id e user_id de quem fez a alteração", async () => {
    await as({ userId: A.atendenteId }, (q) =>
      q("update public.contacts set notes = 'auditado' where id = $1", [A.contactId]),
    );
    const logs = await raw<{ tenant_id: string; user_id: string; action: string }>(
      `select tenant_id, user_id, action from public.audit_logs
       where table_name = 'contacts' and record_id = $1 and action = 'UPDATE'
       order by id desc limit 1`,
      [A.contactId],
    );
    expect(logs[0]).toEqual({ tenant_id: A.tenantId, user_id: A.atendenteId, action: "UPDATE" });
  });
});
