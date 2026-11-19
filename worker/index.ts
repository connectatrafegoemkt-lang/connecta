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
    for (const s of states) {
      const running = sessions.get(s.tenant_id);
      const action = planSession({ desired: s.desired_state, suspended: s.suspended, running: Boolean(running) });
      if (action === "start") {
        const session = new TenantSession(
          new WorkerTenantRepo(sb, s.tenant_id),
          cipher,
          log.child({ tenant: s.tenant_id }) as unknown as pino.Logger,
          aiClient,
        );
        sessions.set(s.tenant_id, session);
        session.start().catch(async (e) => {
          log.error({ err: e, tenant: s.tenant_id }, "falha ao iniciar sessão");
          sessions.delete(s.tenant_id);
          await session.repo.setSession({ status: "erro", last_error: "Falha ao iniciar a sessão" }).catch(() => undefined);
        });
      } else if (action === "logout" && running) {
        sessions.delete(s.tenant_id);
        await running.stop(true).catch((e) => log.error({ err: e }, "falha ao parar sessão"));
      } else if (action === "pause" && running) {
        // cliente suspenso: fecha a conexão SEM apagar o login do WhatsApp
        sessions.delete(s.tenant_id);
        log.info({ tenant: s.tenant_id }, "cliente suspenso: sessão pausada");
        await running.stop(false).catch((e) => log.error({ err: e }, "falha ao pausar sessão"));
        await running.repo
          .setSession({ status: "desconectado", last_error: "Cliente suspenso pela CONNECTA" })
          .catch(() => undefined);
      }
    }
    // Cliente excluído: a sessão dele some da lista; fecha a conexão.
    const present = new Set(states.map((s) => s.tenant_id));
    for (const [tenantId, running] of sessions) {
      if (present.has(tenantId)) continue;
      sessions.delete(tenantId);
      log.info({ tenant: tenantId }, "cliente removido: sessão encerrada");
      await running.stop(false).catch((e) => log.error({ err: e }, "falha ao encerrar sessão"));
    }
    await Promise.all([...sessions.values()].map((s) => s.flushOutbox().catch((e) => log.error({ err: e, tenant: s.tenantId }, "falha na fila"))));
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
