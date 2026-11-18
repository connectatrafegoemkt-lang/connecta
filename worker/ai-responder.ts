import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import { generateReply } from "../src/shared/ai/agent";
import { aiShouldAct, isAiPaused } from "../src/shared/ai/hours";
import { settingsFromRow } from "../src/shared/ai/settings";
import type { WorkerTenantRepo } from "./repo";

const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS ?? 6000);

/**
 * Atendimento por IA de UM tenant. Usa só o repositório desse tenant:
 * configuração, histórico e fila são sempre do tenant da sessão.
 */
export class AiResponder {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = new Set<string>();

  constructor(
    private readonly repo: WorkerTenantRepo,
    private readonly client: Anthropic | null,
    private readonly log: Logger,
    private readonly afterEnqueue: () => void,
  ) {}

  /** Agenda a resposta: espera o cliente terminar de digitar várias mensagens. */
  schedule(contactId: string) {
    if (!this.client) return;
    const t = this.timers.get(contactId);
    if (t) clearTimeout(t);
    this.timers.set(
      contactId,
      setTimeout(() => {
        this.timers.delete(contactId);
        void this.run(contactId).catch((e) => this.log.error({ err: e, contactId }, "falha no atendimento por IA"));
      }, DEBOUNCE_MS),
    );
  }

  /** Humano assumiu a conversa: pausa a IA pelo tempo configurado. */
  async pauseForHuman(contactId: string) {
    const settings = settingsFromRow(await this.repo.getAiSettingsRow());
    if (settings.mode === "desligado") return;
    const until = new Date(Date.now() + settings.human_pause_hours * 3600_000).toISOString();
    const state = await this.repo.getContactAiState(contactId);
    if (state?.ai_paused_until === "infinity") return; // já pausada até reativarem
    await this.repo.setContactAiPause(contactId, until);
  }

  cancelAll() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  async run(contactId: string) {
    if (!this.client || this.running.has(contactId)) return;
    this.running.add(contactId);
    try {
      const settings = settingsFromRow(await this.repo.getAiSettingsRow());
      if (!aiShouldAct(settings)) return;
      const contact = await this.repo.getContactAiState(contactId);
      if (!contact) return;
      if (isAiPaused(contact.ai_paused_until)) return;

      const history = await this.repo.listWhatsappHistory(contactId, 30);
      if (history.at(-1)?.direction !== "entrada") return; // já respondido

      const reply = await generateReply({
        client: this.client,
        settings,
        companyName: await this.repo.getCompanyName(),
        history,
      });
      if (!reply) return;

      const kind = settings.mode === "sugerir" ? "sugestao" : "resposta";
      await this.repo.recordAiUsage({ contact_id: contactId, kind, ...reply.usage });

      if (settings.mode === "sugerir") {
        await this.repo.insertSuggestion(contactId, reply.reply);
        return;
      }
      await this.repo.enqueueAiMessage(contactId, reply.reply);
      if (reply.handoff) {
        await this.repo.setContactAiPause(contactId, "infinity");
        await this.repo.createHandoffTask(contactId, reply.reason || "Cliente precisa de atendimento humano");
      }
      this.afterEnqueue();
    } finally {
      this.running.delete(contactId);
    }
  }
}
