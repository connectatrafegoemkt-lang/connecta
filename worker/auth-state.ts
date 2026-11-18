import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from "@whiskeysockets/baileys";
import type { CredentialCipher } from "./crypto";
import type { WorkerTenantRepo } from "./repo";

/**
 * Estado de autenticação do Baileys persistido no Postgres, CIFRADO e
 * isolado por tenant (substitui o useMultiFileAuthState, que grava em disco).
 */
export async function loadTenantAuthState(repo: WorkerTenantRepo, cipher: CredentialCipher) {
  const tenant = repo.tenantId;
  const encode = (key: string, value: unknown) => cipher.encrypt(tenant, key, JSON.stringify(value, BufferJSON.replacer));
  const decode = (key: string, enc: string) => JSON.parse(cipher.decrypt(tenant, key, enc), BufferJSON.reviver);

  const stored = await repo.getAuth(["creds"]);
  const creds: AuthenticationCreds = stored.has("creds") ? decode("creds", stored.get("creds")!) : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const keys = ids.map((id) => `${type}-${id}`);
        const rows = await repo.getAuth(keys);
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const enc = rows.get(`${type}-${id}`);
          if (!enc) continue;
          let value = decode(`${type}-${id}`, enc);
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          out[id] = value;
        }
        return out;
      },
      set: async (data) => {
        const upserts: { key: string; value_enc: string }[] = [];
        const deletes: string[] = [];
        for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          for (const [id, value] of Object.entries(data[category] ?? {})) {
            const key = `${category}-${id}`;
            if (value) upserts.push({ key, value_enc: encode(key, value) });
            else deletes.push(key);
          }
        }
        await repo.setAuth(upserts);
        await repo.deleteAuth(deletes);
      },
    },
  };

  return {
    state,
    saveCreds: () => repo.setAuth([{ key: "creds", value_enc: encode("creds", creds) }]),
  };
}
