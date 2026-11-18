import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Criptografia das credenciais do WhatsApp (AES-256-GCM).
 *
 * - Chave mestra: WHATSAPP_CREDENTIALS_KEY (32 bytes, base64) — só no worker.
 * - Chave por tenant: HKDF(mestra, salt = tenant_id). Credenciais de um
 *   tenant não são decifráveis com a chave de outro.
 * - AAD = "<tenant_id>:<chave>": o texto cifrado fica amarrado ao tenant e
 *   ao registro; copiar o valor para outra linha/tenant faz a decifragem falhar.
 */
const VERSION = "v1";
const INFO = "connecta-whatsapp-credentials-v1";

export class CredentialCipher {
  private readonly master: Buffer;
  private readonly cache = new Map<string, Buffer>();

  constructor(masterKeyB64: string | undefined) {
    if (!masterKeyB64) throw new Error("WHATSAPP_CREDENTIALS_KEY não definida");
    const key = Buffer.from(masterKeyB64, "base64");
    if (key.length !== 32) throw new Error("WHATSAPP_CREDENTIALS_KEY deve ter 32 bytes em base64");
    this.master = key;
  }

  private keyFor(tenantId: string): Buffer {
    let k = this.cache.get(tenantId);
    if (!k) {
      k = Buffer.from(hkdfSync("sha256", this.master, Buffer.from(tenantId, "utf8"), INFO, 32));
      this.cache.set(tenantId, k);
    }
    return k;
  }

  encrypt(tenantId: string, recordKey: string, plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keyFor(tenantId), iv);
    cipher.setAAD(Buffer.from(`${tenantId}:${recordKey}`, "utf8"));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString("base64")}`;
  }

  decrypt(tenantId: string, recordKey: string, payload: string): string {
    const [version, data] = payload.split(":", 2);
    if (version !== VERSION || !data) throw new Error("Formato de credencial inválido");
    const raw = Buffer.from(data, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.keyFor(tenantId), iv);
    decipher.setAAD(Buffer.from(`${tenantId}:${recordKey}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  }
}
