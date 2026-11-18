import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Repositório do worker, PRESO A UM ÚNICO TENANT.
 *
 * O worker usa service_role (bypassa RLS), por isso toda operação aqui
 * filtra/grava explicitamente o tenant_id da sessão do WhatsApp à qual o
 * repositório pertence. O tenant nunca é derivado do conteúdo de uma
 * mensagem recebida.
 */
export interface OutboxItem {
  id: string;
  contact_id: string;
  body: string;
  attempts: number;
  phone: string;
  origin: "humano" | "ia";
  media_kind: "audio" | "image" | "video" | "document" | null;
  media_path: string | null;
  media_mime: string | null;
  media_filename: string | null;
}

export interface InboundRepo {
  readonly tenantId: string;
  findContactByPhones(phones: string[]): Promise<{ id: string } | null>;
  createContact(input: { name: string; phone: string }): Promise<{ id: string }>;
  insertInteraction(input: {
    contact_id: string;
    direction: "entrada" | "saida";
    body: string;
    external_id: string;
    occurred_at: string;
    status?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string } | null>;
  updateInteractionStatus(externalId: string, status: string): Promise<void>;
}

export class WorkerTenantRepo implements InboundRepo {
  constructor(
    private readonly sb: SupabaseClient,
    readonly tenantId: string,
  ) {
    if (!tenantId) throw new Error("WorkerTenantRepo sem tenantId");
  }

  // ---------- credenciais (valores já cifrados) ----------
  async getAuth(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < keys.length; i += 200) {
      const { data, error } = await this.sb
        .from("whatsapp_auth_keys")
        .select("key, value_enc")
        .eq("tenant_id", this.tenantId)
        .in("key", keys.slice(i, i + 200));
      if (error) throw error;
      for (const r of data ?? []) out.set(r.key, r.value_enc);
    }
    return out;
  }

  async setAuth(entries: { key: string; value_enc: string }[]) {
    if (!entries.length) return;
    const { error } = await this.sb
      .from("whatsapp_auth_keys")
      .upsert(entries.map((e) => ({ ...e, tenant_id: this.tenantId })), { onConflict: "tenant_id,key" });
    if (error) throw error;
  }

  async deleteAuth(keys: string[]) {
    if (!keys.length) return;
    const { error } = await this.sb.from("whatsapp_auth_keys").delete().eq("tenant_id", this.tenantId).in("key", keys);
    if (error) throw error;
  }

  async clearAuth() {
    const { error } = await this.sb.from("whatsapp_auth_keys").delete().eq("tenant_id", this.tenantId);
    if (error) throw error;
  }

  // ---------- sessão / QR ----------
  async setSession(patch: {
    status?: string;
    desired_state?: string;
    phone?: string | null;
    last_error?: string | null;
    connected_at?: string | null;
  }) {
    const { error } = await this.sb
      .from("whatsapp_sessions")
      .upsert({ ...patch, tenant_id: this.tenantId }, { onConflict: "tenant_id" });
    if (error) throw error;
  }

  async setQr(qr: string | null) {
    const { error } = await this.sb
      .from("whatsapp_qr")
      .upsert({ tenant_id: this.tenantId, qr }, { onConflict: "tenant_id" });
    if (error) throw error;
  }

  // ---------- contatos / interações ----------
  async findContactByPhones(phones: string[]) {
    const { data, error } = await this.sb
      .from("contacts")
      .select("id")
      .eq("tenant_id", this.tenantId)
      .in("phone", phones)
      .order("created_at")
      .limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  }

  async createContact(input: { name: string; phone: string }) {
    const { data, error } = await this.sb
      .from("contacts")
      .insert({ tenant_id: this.tenantId, name: input.name, phone: input.phone, source: "WhatsApp" })
      .select("id")
      .single();
    if (error) {
      // corrida: outro evento criou o mesmo telefone
      if (error.code === "23505") {
        const again = await this.findContactByPhones([input.phone]);
        if (again) return again;
      }
      throw error;
    }
    return data;
  }

  async insertInteraction(input: Parameters<InboundRepo["insertInteraction"]>[0]) {
    const { data, error } = await this.sb
      .from("interactions")
      .upsert(
        { ...input, tenant_id: this.tenantId, type: "whatsapp", metadata: input.metadata ?? {} },
        { onConflict: "tenant_id,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw error;
    return data?.[0] ?? null;
  }

  async updateInteractionStatus(externalId: string, status: string) {
    const { error } = await this.sb
      .from("interactions")
      .update({ status })
      .eq("tenant_id", this.tenantId)
      .eq("external_id", externalId);
    if (error) throw error;
  }

  // ---------- fila de envio ----------
  async claimOutbox(limit = 10): Promise<OutboxItem[]> {
    const { data, error } = await this.sb
      .from("whatsapp_outbox")
      .select("id, contact_id, body, attempts, origin, media_kind, media_path, media_mime, media_filename, contacts(phone)")
      .eq("tenant_id", this.tenantId)
      .eq("status", "pendente")
      .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`)
      .order("created_at")
      .limit(limit);
    if (error) throw error;
    const claimed: OutboxItem[] = [];
    for (const row of (data ?? []) as unknown as {
      id: string;
      contact_id: string;
      body: string;
      attempts: number;
      origin: "humano" | "ia";
      media_kind: OutboxItem["media_kind"];
      media_path: string | null;
      media_mime: string | null;
      media_filename: string | null;
      contacts: { phone: string | null } | null;
    }[]) {
      // trava otimista: só pega se ainda estiver pendente
      const upd = await this.sb
        .from("whatsapp_outbox")
        .update({ status: "enviando", attempts: row.attempts + 1 })
        .eq("tenant_id", this.tenantId)
        .eq("id", row.id)
        .eq("status", "pendente")
        .select("id");
      if (upd.error) throw upd.error;
      if (!upd.data?.length) continue;
      if (!row.contacts?.phone) {
        await this.finishOutbox(row.id, "erro", { error: "Contato sem telefone" });
        continue;
      }
      claimed.push({
        id: row.id,
        contact_id: row.contact_id,
        body: row.body,
        attempts: row.attempts + 1,
        phone: row.contacts.phone,
        origin: row.origin,
        media_kind: row.media_kind,
        media_path: row.media_path,
        media_mime: row.media_mime,
        media_filename: row.media_filename,
      });
    }
    return claimed;
  }

  async finishOutbox(id: string, status: "enviado" | "erro" | "pendente", extra: { error?: string; interaction_id?: string } = {}) {
    const { error } = await this.sb
      .from("whatsapp_outbox")
      .update({ status, error: extra.error ?? null, interaction_id: extra.interaction_id ?? null })
      .eq("tenant_id", this.tenantId)
      .eq("id", id);
    if (error) throw error;
  }

  // ---------- mídia (sempre dentro da pasta do tenant) ----------
  private assertOwnPath(path: string) {
    if (!path.startsWith(`${this.tenantId}/`) || path.includes("..")) {
      throw new Error("caminho de mídia fora da pasta do tenant");
    }
  }

  async uploadMedia(path: string, data: Buffer, contentType: string) {
    this.assertOwnPath(path);
    const { error } = await this.sb.storage.from("tenant-files").upload(path, data, { contentType, upsert: true });
    if (error) throw error;
  }

  async downloadMedia(path: string): Promise<Buffer> {
    this.assertOwnPath(path);
    const { data, error } = await this.sb.storage.from("tenant-files").download(path);
    if (error || !data) throw error ?? new Error("arquivo não encontrado");
    return Buffer.from(await data.arrayBuffer());
  }

  // ---------- atendimento por IA ----------
  async getAiSettingsRow() {
    const { data, error } = await this.sb.from("ai_settings").select("*").eq("tenant_id", this.tenantId).maybeSingle();
    if (error) throw error;
    return data as Record<string, unknown> | null;
  }

  async getCompanyName(): Promise<string> {
    const { data, error } = await this.sb.from("tenants").select("name").eq("id", this.tenantId).single();
    if (error) throw error;
    return (data as { name: string }).name;
  }

  async getContactAiState(contactId: string) {
    const { data, error } = await this.sb
      .from("contacts")
      .select("id, name, ai_paused_until")
      .eq("tenant_id", this.tenantId)
      .eq("id", contactId)
      .maybeSingle();
    if (error) throw error;
    return data as { id: string; name: string; ai_paused_until: string | null } | null;
  }

  /** Pausa a IA na conversa. `until = null` reativa; "infinity" pausa até alguém reativar. */
  async setContactAiPause(contactId: string, until: string | null) {
    const { error } = await this.sb
      .from("contacts")
      .update({ ai_paused_until: until })
      .eq("tenant_id", this.tenantId)
      .eq("id", contactId);
    if (error) throw error;
  }

  async listWhatsappHistory(contactId: string, limit = 30) {
    const { data, error } = await this.sb
      .from("interactions")
      .select("direction, body, occurred_at")
      .eq("tenant_id", this.tenantId)
      .eq("contact_id", contactId)
      .eq("type", "whatsapp")
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as { direction: "entrada" | "saida"; body: string }[]).reverse();
  }

  async enqueueAiMessage(contactId: string, body: string) {
    const { error } = await this.sb
      .from("whatsapp_outbox")
      .insert({ tenant_id: this.tenantId, contact_id: contactId, body, origin: "ia" });
    if (error) throw error;
  }

  async insertSuggestion(contactId: string, body: string) {
    // substitui sugestões pendentes anteriores da mesma conversa
    await this.sb
      .from("ai_suggestions")
      .update({ status: "descartada" })
      .eq("tenant_id", this.tenantId)
      .eq("contact_id", contactId)
      .eq("status", "pendente");
    const { error } = await this.sb.from("ai_suggestions").insert({ tenant_id: this.tenantId, contact_id: contactId, body });
    if (error) throw error;
  }

  async createHandoffTask(contactId: string, reason: string) {
    const { error } = await this.sb.from("tasks").insert({
      tenant_id: this.tenantId,
      contact_id: contactId,
      title: "Assumir atendimento no WhatsApp",
      description: `A IA transferiu a conversa. Motivo: ${reason}`.slice(0, 5000),
      due_at: new Date().toISOString(),
      remind_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async recordAiUsage(u: { contact_id: string | null; kind: "resposta" | "sugestao" | "teste"; model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number }) {
    const { error } = await this.sb.from("ai_usage").insert({ ...u, tenant_id: this.tenantId });
    if (error) throw error;
  }
}

/** Única leitura entre tenants do worker: quais sessões devem estar ativas. */
export async function listSessionStates(sb: SupabaseClient) {
  const { data, error } = await sb.from("whatsapp_sessions").select("tenant_id, desired_state, status");
  if (error) throw error;
  return (data ?? []) as { tenant_id: string; desired_state: "conectado" | "desconectado"; status: string }[];
}
