import makeWASocket, {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import { loadTenantAuthState } from "./auth-state";
import type { CredentialCipher } from "./crypto";
import { ackToStatus, handleIncoming, type IncomingMessage } from "./inbound";
import { phoneToJid, jidToPhone } from "./phone";
import type { WorkerTenantRepo } from "./repo";

/**
 * Uma conexão WhatsApp de UM tenant. Cada instância tem seu próprio socket,
 * suas próprias credenciais (cifradas com a chave do tenant) e um
 * repositório preso ao tenant — não há estado compartilhado entre tenants.
 */
export class TenantSession {
  private sock: WASocket | null = null;
  private stopped = false;
  private retries = 0;
  connected = false;

  constructor(
    readonly repo: WorkerTenantRepo,
    private readonly cipher: CredentialCipher,
    private readonly log: Logger,
  ) {}

  get tenantId() {
    return this.repo.tenantId;
  }

  async start() {
    this.stopped = false;
    const { state, saveCreds } = await loadTenantAuthState(this.repo, this.cipher);
    const sock = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.log) },
      logger: this.log,
      browser: Browsers.ubuntu("CONNECTA CRM"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;
    await this.repo.setSession({ status: "conectando", last_error: null });

    sock.ev.on("creds.update", () => {
      saveCreds().catch((e) => this.log.error({ err: e }, "falha ao salvar credenciais"));
    });

    sock.ev.on("connection.update", async (u) => {
      try {
        if (u.qr) {
          await this.repo.setQr(u.qr);
          await this.repo.setSession({ status: "aguardando_qr" });
        }
        if (u.connection === "open") {
          this.connected = true;
          this.retries = 0;
          await this.repo.setQr(null);
          await this.repo.setSession({
            status: "conectado",
            phone: jidToPhone(sock.user?.id),
            connected_at: new Date().toISOString(),
            last_error: null,
          });
          this.log.info("WhatsApp conectado");
        }
        if (u.connection === "close") {
          this.connected = false;
          const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            // Desconectado pelo celular: apaga credenciais e para.
            await this.repo.clearAuth();
            await this.repo.setQr(null);
            await this.repo.setSession({ status: "desconectado", desired_state: "desconectado", phone: null });
            this.stopped = true;
            return;
          }
          if (!this.stopped) {
            this.retries += 1;
            const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.retries, 5));
            await this.repo.setSession({ status: "conectando", last_error: `Reconectando (código ${code ?? "?"})` });
            setTimeout(() => {
              if (!this.stopped) this.start().catch((e) => this.log.error({ err: e }, "falha ao reconectar"));
            }, wait);
          }
        }
      } catch (e) {
        this.log.error({ err: e }, "erro em connection.update");
      }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const m of messages) {
        try {
          await handleIncoming(this.repo, m as unknown as IncomingMessage);
        } catch (e) {
          this.log.error({ err: e }, "falha ao registrar mensagem");
        }
      }
    });

    sock.ev.on("messages.update", async (updates) => {
      for (const { key, update } of updates) {
        const status = ackToStatus(update.status as number | undefined);
        if (key.id && status) {
          await this.repo.updateInteractionStatus(key.id, status).catch(() => undefined);
        }
      }
    });
  }

  /** Envia as mensagens pendentes da fila DESTE tenant. */
  async flushOutbox() {
    if (!this.sock || !this.connected) return;
    const items = await this.repo.claimOutbox();
    for (const item of items) {
      try {
        const sent = await this.sock.sendMessage(phoneToJid(item.phone), { text: item.body });
        const externalId = sent?.key.id;
        if (!externalId) throw new Error("sem id de mensagem");
        const inter = await this.repo.insertInteraction({
          contact_id: item.contact_id,
          direction: "saida",
          body: item.body,
          external_id: externalId,
          occurred_at: new Date().toISOString(),
          status: "enviado",
          metadata: { outbox_id: item.id },
        });
        await this.repo.finishOutbox(item.id, "enviado", { interaction_id: inter?.id });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn({ err: e, outbox: item.id }, "falha ao enviar");
        await this.repo.finishOutbox(item.id, item.attempts >= 3 ? "erro" : "pendente", { error: msg.slice(0, 500) });
      }
    }
  }

  /** Para a sessão. Com logout=true desvincula o aparelho e apaga credenciais. */
  async stop(logout: boolean) {
    this.stopped = true;
    this.connected = false;
    const sock = this.sock;
    this.sock = null;
    try {
      if (logout && sock) await sock.logout();
      else sock?.end(undefined);
    } catch {
      /* socket já fechado */
    }
    if (logout) {
      await this.repo.clearAuth();
      await this.repo.setQr(null);
      await this.repo.setSession({ status: "desconectado", phone: null, connected_at: null });
    }
  }
}
