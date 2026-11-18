import makeWASocket, {
  Browsers,
  downloadMediaMessage,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import { loadTenantAuthState } from "./auth-state";
import type { CredentialCipher } from "./crypto";
import { ackToStatus, handleIncoming, type IncomingMessage } from "./inbound";
import { phoneToJid, jidToPhone } from "./phone";
import { describeMedia, extFromMime, MAX_MEDIA_BYTES, safeName, toOggOpus, type MediaMeta } from "./media";
import type { WorkerTenantRepo } from "./repo";
import type { ChatClient } from "../src/shared/ai/agent";
import { AiResponder } from "./ai-responder";

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
  private readonly ai: AiResponder;

  constructor(
    readonly repo: WorkerTenantRepo,
    private readonly cipher: CredentialCipher,
    private readonly log: Logger,
    aiClient: ChatClient | null = null,
  ) {
    this.ai = new AiResponder(repo, aiClient, log, () => {
      void this.flushOutbox().catch((e) => this.log.error({ err: e }, "falha ao enviar resposta da IA"));
    });
  }

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

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      // "notify" = mensagem nova, em tempo real. "append" = histórico/mensagens
      // antigas entregues ao conectar: só guardamos, sem acionar a IA nem
      // pausar conversas (senão a IA responderia conversas antigas).
      const live = type === "notify";
      for (const m of messages) {
        try {
          await handleIncoming(this.repo, m as unknown as IncomingMessage, {
            onStored: ({ contactId, fromMe }) => {
              if (!live) return;
              // Mensagem enviada pelo celular por uma pessoa = humano assumiu.
              if (fromMe) void this.ai.pauseForHuman(contactId).catch(() => undefined);
              else this.ai.schedule(contactId);
            },
            // Mídia de mensagens antigas não é baixada (evita pico de memória/CPU ao conectar).
            saveMedia: live ? ({ contactId, externalId }) => this.saveIncomingMedia(m, contactId, externalId) : undefined,
          });
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

  /** Baixa a mídia recebida e guarda em <tenant>/whatsapp/<contato>/. */
  private async saveIncomingMedia(m: unknown, contactId: string, externalId: string): Promise<MediaMeta | null> {
    const info = describeMedia((m as IncomingMessage).message);
    if (!info || info.size > MAX_MEDIA_BYTES) return null;
    const buf = (await downloadMediaMessage(m as never, "buffer", {}, {
      logger: this.log,
      reuploadRequest: this.sock!.updateMediaMessage,
    })) as Buffer;
    const name = info.filename ? safeName(info.filename) : `${safeName(externalId)}.${extFromMime(info.mime)}`;
    const path = `${this.tenantId}/whatsapp/${contactId}/${Date.now()}-${name}`;
    await this.repo.uploadMedia(path, buf, info.mime.split(";")[0]);
    return { kind: info.kind, path, mime: info.mime, filename: info.filename };
  }

  /** Monta o conteúdo do Baileys para um item da fila (texto ou mídia). */
  private async contentFor(item: Awaited<ReturnType<WorkerTenantRepo["claimOutbox"]>>[number]) {
    if (!item.media_path || !item.media_kind) return { text: item.body };
    const buf = await this.repo.downloadMedia(item.media_path);
    const caption = item.body || undefined;
    switch (item.media_kind) {
      case "audio": {
        const isOgg = (item.media_mime ?? "").startsWith("audio/ogg");
        return { audio: isOgg ? buf : await toOggOpus(buf), mimetype: "audio/ogg; codecs=opus", ptt: true };
      }
      case "image":
        return { image: buf, caption };
      case "video":
        return { video: buf, caption };
      default:
        return {
          document: buf,
          mimetype: item.media_mime ?? "application/octet-stream",
          fileName: item.media_filename ?? "arquivo",
          caption,
        };
    }
  }

  /** Envia as mensagens pendentes da fila DESTE tenant. */
  async flushOutbox() {
    if (!this.sock || !this.connected) return;
    const items = await this.repo.claimOutbox();
    for (const item of items) {
      try {
        const sent = await this.sock.sendMessage(phoneToJid(item.phone), (await this.contentFor(item)) as never);
        const externalId = sent?.key.id;
        if (!externalId) throw new Error("sem id de mensagem");
        const inter = await this.repo.insertInteraction({
          contact_id: item.contact_id,
          direction: "saida",
          body: item.body || ({ audio: "[áudio]", image: "[imagem]", video: "[vídeo]", document: `[documento] ${item.media_filename ?? ""}`.trim() } as Record<string, string>)[item.media_kind ?? ""] || "",
          external_id: externalId,
          occurred_at: new Date().toISOString(),
          status: "enviado",
          metadata: {
            outbox_id: item.id,
            ai: item.origin === "ia",
            ...(item.media_path ? { media: { kind: item.media_kind, path: item.media_path, mime: item.media_mime, filename: item.media_filename } } : {}),
          },
        });
        await this.repo.finishOutbox(item.id, "enviado", { interaction_id: inter?.id });
        if (item.origin === "humano") await this.ai.pauseForHuman(item.contact_id).catch(() => undefined);
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
    this.ai.cancelAll();
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
