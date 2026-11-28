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

import type { AdReferral } from "./ad-referral";
import type { LabelQueueItem, LabelRepo } from "./labels";
import { isPlaceholderName } from "../src/shared/contact-name";

/** Um número de WhatsApp do tenant (o principal guarda as chaves sem prefixo). */
export interface SessionRef {
  id: string;
  isPrimary: boolean;
}

export class WorkerTenantRepo implements InboundRepo, LabelRepo {
  readonly sessionId: string;
  readonly isPrimary: boolean;

  constructor(
    private readonly sb: SupabaseClient,
    readonly tenantId: string,
    session: SessionRef,
  ) {
    if (!tenantId) throw new Error("WorkerTenantRepo sem tenantId");
    if (!session?.id) throw new Error("WorkerTenantRepo sem sessão");
    this.sessionId = session.id;
    this.isPrimary = session.isPrimary;
  }

  /** Chave guardada: números extras ganham o prefixo "s:<sessão>:". */
  private authKey(key: string) {
    return this.isPrimary ? key : `s:${this.sessionId}:${key}`;
  }

  // ---------- credenciais (valores já cifrados) ----------
  async getAuth(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const back = new Map(keys.map((k) => [this.authKey(k), k]));
    const stored = [...back.keys()];
    for (let i = 0; i < stored.length; i += 200) {
      const { data, error } = await this.sb
        .from("whatsapp_auth_keys")
        .select("key, value_enc")
        .eq("tenant_id", this.tenantId)
        .in("key", stored.slice(i, i + 200));
      if (error) throw error;
      for (const r of data ?? []) out.set(back.get(r.key) ?? r.key, r.value_enc);
    }
    return out;
  }

  async setAuth(entries: { key: string; value_enc: string }[]) {
    if (!entries.length) return;
    const { error } = await this.sb
      .from("whatsapp_auth_keys")
      .upsert(entries.map((e) => ({ key: this.authKey(e.key), value_enc: e.value_enc, tenant_id: this.tenantId })), {
        onConflict: "tenant_id,key",
      });
    if (error) throw error;
  }

  async deleteAuth(keys: string[]) {
    if (!keys.length) return;
    const { error } = await this.sb
      .from("whatsapp_auth_keys")
      .delete()
      .eq("tenant_id", this.tenantId)
      .in("key", keys.map((k) => this.authKey(k)));
    if (error) throw error;
  }

  /** Apaga o login DESTE número (o principal não mexe nos extras e vice-versa). */
  async clearAuth() {
    const q = this.sb.from("whatsapp_auth_keys").delete().eq("tenant_id", this.tenantId);
    const { error } = this.isPrimary ? await q.not("key", "like", "s:%") : await q.like("key", `s:${this.sessionId}:%`);
    if (error) throw error;
  }

  // ---------- sessão / QR ----------
  async setSession(patch: {
    status?: string;
    desired_state?: string;
    phone?: string | null;
    last_error?: string | null;
    connected_at?: string | null;
    reset_requested_at?: string | null;
  }) {
    // update (não upsert): um número removido não "volta" por engano
    const { error } = await this.sb
      .from("whatsapp_sessions")
      .update(patch)
      .eq("tenant_id", this.tenantId)
      .eq("id", this.sessionId);
    if (error) throw error;
  }

  async setQr(qr: string | null) {
    const { error } = await this.sb
      .from("whatsapp_qr")
      .upsert({ tenant_id: this.tenantId, session_id: this.sessionId, qr }, { onConflict: "session_id" });
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
        { ...input, tenant_id: this.tenantId, session_id: this.sessionId, type: "whatsapp", metadata: input.metadata ?? {} },
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
      .or(this.outboxFilter(`or(scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()})`))
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

  /**
   * Fila DESTE número: as mensagens com session_id dele e, no principal,
   * também as sem número (compatível com a fila antiga). `extra` é uma
   * condição a mais (sintaxe PostgREST) aplicada aos dois casos.
   */
  private outboxFilter(extra: string) {
    const mine = `and(session_id.eq.${this.sessionId},${extra})`;
    return this.isPrimary ? `${mine},and(session_id.is.null,${extra})` : mine;
  }

  /** Linhas da fila presas em "enviando" (o worker caiu no meio do envio). */
  async listStuckOutbox(olderThanIso: string) {
    const { data, error } = await this.sb
      .from("whatsapp_outbox")
      .select("id, contact_id, body, created_at")
      .eq("tenant_id", this.tenantId)
      .or(this.outboxFilter("status.eq.enviando"))
      .eq("status", "enviando")
      .lt("updated_at", olderThanIso)
      .limit(50);
    if (error) throw error;
    return (data ?? []) as { id: string; contact_id: string; body: string; created_at: string }[];
  }

  /** A mensagem já aparece na conversa como enviada? */
  async findSentInteraction(contactId: string, body: string, sinceIso: string) {
    const { data, error } = await this.sb
      .from("interactions")
      .select("id")
      .eq("tenant_id", this.tenantId)
      .eq("contact_id", contactId)
      .eq("type", "whatsapp")
      .eq("direction", "saida")
      .eq("body", body)
      .gte("occurred_at", sinceIso)
      .order("occurred_at")
      .limit(1);
    if (error) throw error;
    return (data?.[0] as { id: string } | undefined) ?? null;
  }

  async getContactProfileState(contactId: string) {
    const { data, error } = await this.sb
      .from("contacts")
      .select("profile_checked_at")
      .eq("tenant_id", this.tenantId)
      .eq("id", contactId)
      .maybeSingle();
    if (error) throw error;
    return data as { profile_checked_at: string | null } | null;
  }

  async saveContactProfile(
    contactId: string,
    p: { avatar_path?: string | null; whatsapp_name?: string | null; whatsapp_about?: string | null },
  ) {
    if (p.avatar_path) this.assertOwnPath(p.avatar_path);
    const { error } = await this.sb
      .from("contacts")
      .update({ ...p, profile_checked_at: new Date().toISOString() })
      .eq("tenant_id", this.tenantId)
      .eq("id", contactId);
    if (error) throw error;
  }

  /**
   * Guarda o nome que a pessoa usa no WhatsApp. Se o contato ainda está só
   * com o telefone como nome (lead não cadastrada), usa esse nome também
   * como nome do contato. Nome digitado no CRM nunca é sobrescrito.
   */
  async setContactWhatsappName(contactId: string, name: string) {
    const wa = name.trim().slice(0, 120);
    if (!wa) return;
    const cur = await this.sb
      .from("contacts")
      .select("name, phone, whatsapp_name")
      .eq("tenant_id", this.tenantId)
      .eq("id", contactId)
      .maybeSingle();
    if (cur.error) throw cur.error;
    if (!cur.data) return;
    const row = cur.data as { name: string; phone: string | null; whatsapp_name: string | null };
    const patch: { whatsapp_name?: string; name?: string } = {};
    if (row.whatsapp_name !== wa) patch.whatsapp_name = wa;
    if (isPlaceholderName(row.name, row.phone) && row.name !== wa) patch.name = wa;
    if (!Object.keys(patch).length) return;
    const { error } = await this.sb.from("contacts").update(patch).eq("tenant_id", this.tenantId).eq("id", contactId);
    if (error) throw error;
  }

  /** Contatos com conversa recente (para atualizar fotos ao conectar). */
  async listRecentConversationContacts(limit = 30) {
    const { data, error } = await this.sb
      .from("contacts")
      .select("id, phone")
      .eq("tenant_id", this.tenantId)
      .not("phone", "is", null)
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as { id: string; phone: string }[];
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
      .select("id, name, ai_enabled, ai_paused_until")
      .eq("tenant_id", this.tenantId)
      .eq("id", contactId)
      .maybeSingle();
    if (error) throw error;
    return data as { id: string; name: string; ai_enabled: boolean; ai_paused_until: string | null } | null;
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
      .insert({ tenant_id: this.tenantId, session_id: this.sessionId, contact_id: contactId, body, origin: "ia" });
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
  // ---------- tráfego pago (anúncio Click-to-WhatsApp) ----------
  /** Marca o contato como lead de anúncio (só a 1ª vez) e aplica a etiqueta de tráfego pago. */
  async markContactFromAd(contactId: string, ref: AdReferral, at: string, sourceLabel: string) {
    const { data: c, error } = await this.sb
      .from("contacts")
      .select("id, ad_at, source")
      .eq("tenant_id", this.tenantId)
      .eq("id", contactId)
      .maybeSingle();
    if (error) throw error;
    if (!c || c.ad_at) return false;
    const patch: Record<string, unknown> = { ad_source: ref, ad_at: at };
    if (!c.source || c.source === "WhatsApp") patch.source = sourceLabel;
    const u = await this.sb.from("contacts").update(patch).eq("tenant_id", this.tenantId).eq("id", contactId).is("ad_at", null);
    if (u.error) throw u.error;
    const tagId = await this.ensurePaidTrafficTag();
    await this.sb
      .from("contact_tags")
      .upsert({ tenant_id: this.tenantId, contact_id: contactId, tag_id: tagId }, { onConflict: "tenant_id,contact_id,tag_id", ignoreDuplicates: true });
    return true;
  }

  private async ensurePaidTrafficTag(): Promise<string> {
    const { data } = await this.sb.from("tags").select("id").eq("tenant_id", this.tenantId).eq("paid_traffic", true).order("created_at").limit(1);
    if (data?.[0]) return data[0].id as string;
    const byName = await this.sb.from("tags").select("id").eq("tenant_id", this.tenantId).ilike("name", "tráfego pago").maybeSingle();
    if (byName.data) {
      await this.sb.from("tags").update({ paid_traffic: true }).eq("tenant_id", this.tenantId).eq("id", byName.data.id);
      return byName.data.id as string;
    }
    const ins = await this.sb
      .from("tags")
      .insert({ tenant_id: this.tenantId, name: "Tráfego pago", color: "#a100ff", paid_traffic: true })
      .select("id")
      .single();
    if (ins.error) throw ins.error;
    return ins.data.id as string;
  }

  // ---------- etiquetas do WhatsApp Business ----------
  async upsertTagFromWhatsapp(label: { id: string; name: string; color: string }) {
    const linked = await this.sb.from("tags").select("id, name").eq("tenant_id", this.tenantId).eq("wa_label_id", label.id).maybeSingle();
    if (linked.error) throw linked.error;
    if (linked.data) {
      const u = await this.sb.from("tags").update({ name: label.name, color: label.color }).eq("tenant_id", this.tenantId).eq("id", linked.data.id);
      if (u.error && u.error.code !== "23505") throw u.error;
      return;
    }
    const same = await this.sb.from("tags").select("id, wa_label_id").eq("tenant_id", this.tenantId).ilike("name", label.name).limit(1);
    if (same.error) throw same.error;
    const t = same.data?.[0];
    if (t && !t.wa_label_id) {
      const u = await this.sb.from("tags").update({ wa_label_id: label.id }).eq("tenant_id", this.tenantId).eq("id", t.id);
      if (u.error) throw u.error;
      return;
    }
    const name = t ? `${label.name} (WhatsApp)`.slice(0, 50) : label.name;
    const paid = /tr[aá]fego|an[uú]ncio|\bads\b/i.test(name);
    const ins = await this.sb
      .from("tags")
      .insert({ tenant_id: this.tenantId, name, color: label.color, wa_label_id: label.id, paid_traffic: paid });
    if (ins.error && ins.error.code !== "23505") throw ins.error;
  }

  async deleteTagByWaLabel(waLabelId: string) {
    const { error } = await this.sb.from("tags").delete().eq("tenant_id", this.tenantId).eq("wa_label_id", waLabelId);
    if (error) throw error;
  }

  /** Etiqueta aplicada/removida de uma conversa no celular. */
  async setContactLabel(phone: string, waLabelId: string, on: boolean) {
    const tag = await this.sb.from("tags").select("id").eq("tenant_id", this.tenantId).eq("wa_label_id", waLabelId).maybeSingle();
    if (tag.error) throw tag.error;
    if (!tag.data) return; // etiqueta ainda não sincronizada
    let contact = await this.findContactByPhones([phone]);
    if (!contact && on) contact = await this.createContact({ name: `+${phone}`, phone });
    if (!contact) return;
    if (on) {
      const r = await this.sb
        .from("contact_tags")
        .upsert({ tenant_id: this.tenantId, contact_id: contact.id, tag_id: tag.data.id }, { onConflict: "tenant_id,contact_id,tag_id", ignoreDuplicates: true });
      if (r.error) throw r.error;
    } else {
      const r = await this.sb.from("contact_tags").delete().eq("tenant_id", this.tenantId).eq("contact_id", contact.id).eq("tag_id", tag.data.id);
      if (r.error) throw r.error;
    }
  }

  async claimLabelQueue(limit = 20): Promise<LabelQueueItem[]> {
    const { data, error } = await this.sb
      .from("whatsapp_label_queue")
      .select("id, kind, contact_id, tag_id, wa_label_id, attempts")
      .eq("tenant_id", this.tenantId)
      .eq("status", "pendente")
      .order("created_at")
      .limit(limit);
    if (error) throw error;
    const ids = (data ?? []).map((d) => d.id);
    if (ids.length) {
      await this.sb.from("whatsapp_label_queue").update({ status: "processando" }).eq("tenant_id", this.tenantId).in("id", ids);
    }
    return (data ?? []) as LabelQueueItem[];
  }

  async finishLabelQueue(id: string, ok: boolean, error?: string) {
    if (ok) {
      await this.sb.from("whatsapp_label_queue").update({ status: "feito", error: null }).eq("tenant_id", this.tenantId).eq("id", id);
      return;
    }
    const { data } = await this.sb.from("whatsapp_label_queue").select("attempts").eq("tenant_id", this.tenantId).eq("id", id).maybeSingle();
    const attempts = ((data?.attempts as number | undefined) ?? 0) + 1;
    await this.sb
      .from("whatsapp_label_queue")
      .update({ status: attempts >= 5 ? "erro" : "pendente", attempts, error: error ?? null })
      .eq("tenant_id", this.tenantId)
      .eq("id", id);
  }

  async getTag(tagId: string) {
    const { data, error } = await this.sb.from("tags").select("id, name, color, wa_label_id").eq("tenant_id", this.tenantId).eq("id", tagId).maybeSingle();
    if (error) throw error;
    return (data as { id: string; name: string; color: string; wa_label_id: string | null } | null) ?? null;
  }

  async listWaLabelIds(): Promise<string[]> {
    const { data, error } = await this.sb.from("tags").select("wa_label_id").eq("tenant_id", this.tenantId).not("wa_label_id", "is", null);
    if (error) throw error;
    return (data ?? []).map((d) => d.wa_label_id as string);
  }

  async setTagWaLabel(tagId: string, waLabelId: string) {
    const { error } = await this.sb.from("tags").update({ wa_label_id: waLabelId }).eq("tenant_id", this.tenantId).eq("id", tagId);
    if (error) throw error;
  }

  async getContactPhone(contactId: string): Promise<string | null> {
    const { data, error } = await this.sb.from("contacts").select("phone").eq("tenant_id", this.tenantId).eq("id", contactId).maybeSingle();
    if (error) throw error;
    return (data?.phone as string | null) ?? null;
  }

  /** Limpa a fila já processada (mais de 7 dias). */
  async pruneLabelQueue() {
    await this.sb
      .from("whatsapp_label_queue")
      .delete()
      .eq("tenant_id", this.tenantId)
      .in("status", ["feito", "erro"])
      .lt("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  }

}

/** Única leitura entre tenants do worker: quais sessões devem estar ativas (e se o cliente está suspenso). */
export async function listSessionStates(sb: SupabaseClient) {
  const { data, error } = await sb
    .from("whatsapp_sessions")
    .select("id, is_primary, tenant_id, desired_state, status, reset_requested_at, tenants(suspended_at)");
  if (error) throw error;
  type Row = {
    id: string;
    is_primary: boolean;
    tenant_id: string;
    desired_state: "conectado" | "desconectado";
    status: string;
    reset_requested_at: string | null;
    tenants: { suspended_at: string | null } | { suspended_at: string | null }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const t = Array.isArray(r.tenants) ? r.tenants[0] : r.tenants;
    return {
      session_id: r.id,
      is_primary: r.is_primary,
      tenant_id: r.tenant_id,
      desired_state: r.desired_state,
      status: r.status,
      reset_requested_at: r.reset_requested_at,
      suspended: Boolean(t?.suspended_at),
    };
  });

}
