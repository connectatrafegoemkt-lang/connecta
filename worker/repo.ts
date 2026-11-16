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
      .select("id, contact_id, body, attempts, contacts(phone)")
      .eq("tenant_id", this.tenantId)
      .eq("status", "pendente")
      .order("created_at")
      .limit(limit);
    if (error) throw error;
    const claimed: OutboxItem[] = [];
    for (const row of (data ?? []) as unknown as {
      id: string;
      contact_id: string;
      body: string;
      attempts: number;
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
      claimed.push({ id: row.id, contact_id: row.contact_id, body: row.body, attempts: row.attempts + 1, phone: row.contacts.phone });
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
}

/** Única leitura entre tenants do worker: quais sessões devem estar ativas. */
export async function listSessionStates(sb: SupabaseClient) {
  const { data, error } = await sb.from("whatsapp_sessions").select("tenant_id, desired_state, status");
  if (error) throw error;
  return (data ?? []) as { tenant_id: string; desired_state: "conectado" | "desconectado"; status: string }[];
}
