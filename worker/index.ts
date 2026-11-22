/**
 * Worker do WhatsApp — processo de longa duração (não roda no Next.js).
 *
 *   npm run worker
 *
 * Variáveis: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_CREDENTIALS_KEY
 */
import { createClient } from "@supabase/supabase-js";
import pino from "pino";
import { CredentialCipher } from "./crypto";
import { listSessionStates, WorkerTenantRepo } from "./repo";
import { planSession } from "./plan";
import { TenantSession } from "./session";
import OpenAI from "openai";
import { silenceSignalLogs } from "./quiet-console";

// Antes de tudo: a libsignal não pode despejar chaves no console/logs.
silenceSignalLogs();

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const cipher = new CredentialCipher(process.env.WHATSAPP_CREDENTIALS_KEY);
const sessions = new Map<string, TenantSession>();
// Chave da OpenAI da CONNECTA (paga o uso de todos os tenants; o consumo fica em ai_usage).
const aiClient = process.env.OPENAI_API_KEY ? new OpenAI() : null;
if (!aiClient) log.warn("OPENAI_API_KEY ausente: atendimento por IA desativado");
let ticking = false;
let shuttingDown = false;
let again = false;

async function tick() {
  if (shuttingDown) return;
  if (ticking) {
    again = true;
    return;
  }
  ticking = true;
  try {
    const states = await listSessionStates(sb);
    // Uma conexão por NÚMERO (sessão); cada uma presa ao seu tenant.
    for (const s of states) {
      const key = s.session_id;
      const ref = { id: s.session_id, isPrimary: s.is_primary };
      const tag = { tenant: s.tenant_id, numero: s.session_id };
      let running = sessions.get(key);
      // "Gerar novo QR code": apaga o login guardado e recomeça o pareamento.
      if (s.reset_requested_at && !s.suspended) {
        const repo = running?.repo ?? new WorkerTenantRepo(sb, s.tenant_id, ref);
        log.info(tag, "novo QR code pedido: reiniciando pareamento");
        if (running) {
          sessions.delete(key);
          await running.stop(true).catch((e) => log.error({ err: e }, "falha ao parar sessão"));
          running = undefined;
        } else {
          await repo.clearAuth().catch(() => undefined);
          await repo.setQr(null).catch(() => undefined);
        }
        await repo.setSession({ reset_requested_at: null, status: "conectando", desired_state: "conectado" }).catch(() => undefined);
        s.desired_state = "conectado";
      }
      const action = planSession({ desired: s.desired_state, suspended: s.suspended, running: Boolean(running) });
      if (action === "start") {
        const session = new TenantSession(
          new WorkerTenantRepo(sb, s.tenant_id, ref),
          cipher,
          log.child(tag) as unknown as pino.Logger,
          aiClient,
        );
        sessions.set(key, session);
        session.start().catch(async (e) => {
          log.error({ err: e, ...tag }, "falha ao iniciar sessão");
          sessions.delete(key);
          await session.repo.setSession({ status: "erro", last_error: "Falha ao iniciar a sessão" }).catch(() => undefined);
        });
      } else if (action === "logout" && running) {
        sessions.delete(key);
        await running.stop(true).catch((e) => log.error({ err: e }, "falha ao parar sessão"));
      } else if (action === "pause" && running) {
        // cliente suspenso: fecha a conexão SEM apagar o login do WhatsApp
        sessions.delete(key);
        log.info(tag, "cliente suspenso: sessão pausada");
        await running.stop(false).catch((e) => log.error({ err: e }, "falha ao pausar sessão"));
        await running.repo
          .setSession({ status: "desconectado", last_error: "Cliente suspenso pela CONNECTA" })
          .catch(() => undefined);
      }
    }
    // Número removido (desvincula o aparelho) ou cliente excluído (só fecha).
    const presentSessions = new Set(states.map((s) => s.session_id));
    const presentTenants = new Set(states.map((s) => s.tenant_id));
    for (const [key, running] of sessions) {
      if (presentSessions.has(key)) continue;
      sessions.delete(key);
      const tenantGone = !presentTenants.has(running.tenantId);
      log.info({ tenant: running.tenantId, numero: key }, tenantGone ? "cliente removido: sessão encerrada" : "número removido: desconectando");
      await running.stop(!tenantGone, { forget: true }).catch((e) => log.error({ err: e }, "falha ao encerrar sessão"));
    }
    await Promise.all([...sessions.values()].map((s) => s.flushOutbox().catch((e) => log.error({ err: e, tenant: s.tenantId, numero: s.repo.sessionId }, "falha na fila"))));
    await Promise.all([...sessions.values()].map((s) => s.syncLabels()));
  } catch (e) {
    log.error({ err: e }, "erro no ciclo do worker");
  } finally {
    ticking = false;
    if (again) {
      again = false;
      void tick();
    }
  }
}

// Realtime acelera a reação; o intervalo é a rede de segurança.
sb.channel("whatsapp-worker")
  .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_outbox" }, () => void tick())
  .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_sessions" }, () => void tick())
  .subscribe();
setInterval(() => void tick(), 2000);
void tick();
log.info("worker do WhatsApp iniciado");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("encerrando… (terminando envios em andamento)");
    // Espera o ciclo atual (envio em andamento) terminar, até 15s, para não
    // deixar mensagem presa em "enviando" num deploy.
    const deadline = Date.now() + 15_000;
    while (ticking && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    await Promise.all([...sessions.values()].map((s) => s.stop(false)));
    process.exit(0);
  });
}
