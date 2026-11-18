import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Helpers para testar o RLS diretamente no Postgres, simulando exatamente
 * o que o PostgREST faz em cada requisição: `set local role authenticated`
 * + claims do JWT em `request.jwt.claims`.
 */

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/connecta_test";

export const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });

export type Actor = { userId: string } | "anon" | "service";

export type Query = <R extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<{ rows: R[]; rowCount: number }>;

async function setActor(client: PoolClient, actor: Actor) {
  if (actor === "service") {
    await client.query("set local role service_role");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
  } else if (actor === "anon") {
    await client.query("set local role anon");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "anon" }),
    ]);
  } else {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: actor.userId, role: "authenticated", aud: "authenticated" }),
    ]);
  }
}

/** Executa `fn` em uma transação como o ator informado (commit ao final). */
export async function as<T>(actor: Actor, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setActor(client, actor);
    const q: Query = async (sql, params) => {
      const r = await client.query(sql, params as unknown[]);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    };
    const result = await fn(q);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

/** Consulta como superusuário (fora do RLS) — só para verificar o estado real. */
export async function raw<R extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) {
  const r = await pool.query(sql, params as unknown[]);
  return r.rows as R[];
}

export interface TenantFixture {
  tenantId: string;
  adminId: string;
  atendenteId: string;
  stageId: string;
  contactId: string;
  tagId: string;
  interactionId: string;
  taskId: string;
  filePath: string;
}

async function createUser(label: string) {
  const id = randomUUID();
  await raw("insert into auth.users (id, email) values ($1, $2)", [
    id,
    `${label}-${id.slice(0, 8)}@teste.connecta.local`,
  ]);
  return id;
}

/** Cria um tenant completo (admin, atendente e um registro de cada tabela). */
export async function createTenantFixture(label: string): Promise<TenantFixture> {
  const adminId = await createUser(`${label}-admin`);
  const atendenteId = await createUser(`${label}-atendente`);
  const slug = `${label}-${randomUUID().slice(0, 8)}`.toLowerCase();

  const [{ id: tenantId }] = await as("service", (q) =>
    q<{ id: string }>("select public.create_tenant_with_admin($1, $2, $3, $4) as id", [
      `Tenant ${label}`,
      slug,
      adminId,
      `Admin ${label}`,
    ]).then((r) => r.rows),
  );

  await as({ userId: adminId }, (q) =>
    q("insert into public.memberships (user_id, role, display_name) values ($1, 'atendente', $2)", [
      atendenteId,
      `Atendente ${label}`,
    ]),
  );

  return as({ userId: atendenteId }, async (q) => {
    const stage = await q<{ id: string }>(
      "select id from public.pipeline_stages order by position limit 1",
    );
    const stageId = stage.rows[0].id;
    const contact = await q<{ id: string }>(
      `insert into public.contacts (name, email, phone, stage_id, value_cents)
       values ($1, $2, $3, $4, 100000) returning id`,
      [`Contato ${label}`, `contato-${label}@exemplo.com`, `55119${Math.floor(Math.random() * 1e8)}`, stageId],
    );
    const contactId = contact.rows[0].id;
    // etiquetas são configuração (perfil admin/gerente); o atendente só as aplica
    const tagId = await as({ userId: adminId }, (qa) =>
      qa<{ id: string }>("insert into public.tags (name) values ($1) returning id", [`tag-${label}`]),
    ).then((r) => r.rows[0].id);
    await q("insert into public.contact_tags (contact_id, tag_id) values ($1, $2)", [contactId, tagId]);
    const inter = await q<{ id: string }>(
      "insert into public.interactions (contact_id, type, body) values ($1, 'nota', $2) returning id",
      [contactId, `Segredo do tenant ${label}`],
    );
    const task = await q<{ id: string }>(
      "insert into public.tasks (contact_id, title, assigned_to) values ($1, $2, $3) returning id",
      [contactId, `Tarefa ${label}`, atendenteId],
    );
    const filePath = `${tenantId}/contatos/${contactId}/contrato.pdf`;
    await q("insert into storage.objects (bucket_id, name) values ('tenant-files', $1)", [filePath]);
    return {
      tenantId,
      adminId,
      atendenteId,
      stageId,
      contactId,
      tagId,
      interactionId: inter.rows[0].id,
      taskId: task.rows[0].id,
      filePath,
    };
  });
}

/** Garante que uma operação falha (erro do Postgres). Retorna a mensagem. */
export async function expectDbError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("Era esperado que a operação falhasse, mas ela foi concluída.");
}
