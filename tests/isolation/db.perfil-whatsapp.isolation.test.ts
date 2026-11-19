/** Foto/recado do WhatsApp no contato: só o worker grava, e só na pasta do próprio tenant. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTenantFixture, expectDbError, pool, raw, type TenantFixture } from "./db-helpers";

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  A = await createTenantFixture("perfil-a");
  B = await createTenantFixture("perfil-b");
});

afterAll(async () => {
  await raw("delete from public.tenants where id = any($1)", [[A?.tenantId, B?.tenantId].filter(Boolean)]);
  await raw("delete from auth.users where id = any($1)", [[A?.adminId, A?.atendenteId, B?.adminId, B?.atendenteId].filter(Boolean)]);
  await pool.end();
});

describe("perfil do WhatsApp no contato", () => {
  it("worker grava foto/recado na pasta do próprio tenant", async () => {
    await as("service", (q) =>
      q("update public.contacts set avatar_path = $1, whatsapp_about = 'Disponível', whatsapp_name = 'Maria' where id = $2", [
        `${A.tenantId}/avatars/${A.contactId}.jpg`,
        A.contactId,
      ]),
    );
    const [c] = await raw<{ avatar_path: string; whatsapp_about: string }>("select avatar_path, whatsapp_about from public.contacts where id = $1", [A.contactId]);
    expect(c.whatsapp_about).toBe("Disponível");
  });

  it("nem o worker aponta a foto para a pasta de outro tenant", async () => {
    await expectDbError(
      as("service", (q) => q("update public.contacts set avatar_path = $1 where id = $2", [`${B.tenantId}/avatars/x.jpg`, A.contactId])),
    );
    await expectDbError(
      as("service", (q) => q("update public.contacts set avatar_path = $1 where id = $2", [`${A.tenantId}/../${B.tenantId}/x.jpg`, A.contactId])),
    );
  });

  it("usuário (mesmo admin) não altera foto/recado, e ao criar contato os campos ficam vazios", async () => {
    await expectDbError(
      as({ userId: A.adminId }, (q) => q("update public.contacts set avatar_path = $1 where id = $2", [`${A.tenantId}/avatars/outro.jpg`, A.contactId])),
    );
    await expectDbError(as({ userId: A.adminId }, (q) => q("update public.contacts set whatsapp_about = 'hack' where id = $1", [A.contactId])));
    const r = await as({ userId: A.adminId }, (q) =>
      q<{ avatar_path: string | null }>("insert into public.contacts (name, avatar_path) values ('Novo', $1) returning avatar_path", [`${A.tenantId}/x.jpg`]),
    );
    expect(r.rows[0].avatar_path).toBeNull();
    // editar outros campos continua funcionando
    const u = await as({ userId: A.adminId }, (q) => q("update public.contacts set notes = 'ok' where id = $1", [A.contactId]));
    expect(u.rowCount).toBe(1);
  });
});
