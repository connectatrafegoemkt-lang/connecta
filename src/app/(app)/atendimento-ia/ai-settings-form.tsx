"use client";

import { useState, useTransition } from "react";
import {
  Bot,
  Briefcase,
  CircleCheck,
  Clock,
  HelpCircle,
  Loader2,
  Lock,
  MessageSquareText,
  Plus,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  UserRound,
  Wand2,
} from "lucide-react";
import type { AiSettings } from "@/shared/ai/settings";
import { NICHE_PRESETS } from "@/shared/ai/settings";
import { saveAiSettingsAction, testAiAction } from "../actions";

const MODES = [
  { value: "desligado", title: "Desligado", text: "A IA não participa das conversas." },
  { value: "sugerir", title: "Sugerir respostas", text: "A IA escreve a resposta e o atendente revisa e envia." },
  { value: "automatico", title: "Responder sozinha", text: "A IA responde e passa para a equipe quando necessário." },
] as const;
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function Section({ icon: Icon, title, children, hint }: { icon: typeof Bot; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="section-title"><Icon className="h-4 w-4 text-accent" /> {title}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AiSettingsForm({
  initial,
  isAdmin,
  usage,
  aiAvailable,
}: {
  initial: AiSettings;
  isAdmin: boolean;
  usage: { mensagens: number; testes: number; input_tokens: number; output_tokens: number } | null;
  aiAvailable: boolean;
}) {
  const [s, setS] = useState<AiSettings>(initial);
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof AiSettings>(k: K, v: AiSettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const disabled = !isAdmin;

  const save = () =>
    startSave(async () => {
      const r = await saveAiSettingsAction(s);
      setMsg({ ok: !!r.ok, text: r.error ?? r.message ?? "" });
    });

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        {!isAdmin && (
          <p className="chip"><Lock className="h-3 w-3" /> Somente administradores alteram estas configurações.</p>
        )}
        {!aiAvailable && (
          <p className="card flex items-center gap-2 border-warning/40 text-sm text-warning">
            <TriangleAlert className="h-4 w-4 shrink-0" /> A chave da IA ainda não foi configurada no servidor. Fale com a CONNECTA.
          </p>
        )}

        <Section icon={Sparkles} title="Como a IA deve agir">
          <div role="radiogroup" className="grid gap-3 md:grid-cols-3">
            {MODES.map((m) => {
              const active = s.mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => set("mode", m.value)}
                  className={`rounded-xl border p-4 text-left transition ${active ? "border-brand-500 bg-accent-soft shadow-[0_0_0_1px_rgb(161_0_255/0.4)]" : "border-line hover:border-line-strong"}`}
                >
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {active ? <CircleCheck className="h-4 w-4 text-accent" /> : <span className="h-4 w-4 rounded-full border border-line-strong" />}
                    {m.title}
                  </p>
                  <p className="mt-1 text-xs text-muted">{m.text}</p>
                </button>
              );
            })}
          </div>
        </Section>

        <Section icon={Briefcase} title="Sobre o negócio" hint="Quanto mais detalhes, melhor a IA atende.">
          <div className="grid gap-3 md:grid-cols-2">
            <label><span className="label">Nome do atendente</span>
              <input className="input" disabled={disabled} value={s.assistant_name} onChange={(e) => set("assistant_name", e.target.value)} />
            </label>
            <label><span className="label">Nicho</span>
              <input className="input" disabled={disabled} placeholder="Ex.: Advocacia trabalhista" value={s.niche ?? ""} onChange={(e) => set("niche", e.target.value || null)} />
            </label>
            <label className="md:col-span-2"><span className="label">Área de atuação</span>
              <input className="input" disabled={disabled} placeholder="Ex.: Direitos de empregados, rescisões e horas extras em SP" value={s.business_area ?? ""} onChange={(e) => set("business_area", e.target.value || null)} />
            </label>
            <label className="md:col-span-2"><span className="label">Descrição da empresa</span>
              <textarea className="input" rows={4} disabled={disabled} placeholder="História, diferenciais, endereço, formas de atendimento, formas de pagamento…" value={s.company_description ?? ""} onChange={(e) => set("company_description", e.target.value || null)} />
            </label>
            <label><span className="label">Tom de voz</span>
              <select className="input" disabled={disabled} value={s.tone} onChange={(e) => set("tone", e.target.value as AiSettings["tone"])}>
                <option value="formal">Formal</option>
                <option value="amigavel">Amigável</option>
                <option value="descontraido">Descontraído</option>
              </select>
            </label>
          </div>
        </Section>

        <Section icon={MessageSquareText} title="Serviços e produtos" hint="A IA só informa preços e condições que estiverem aqui.">
          <div className="space-y-3">
            {s.services.map((sv, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-line bg-surface-2/40 p-3 md:grid-cols-[1fr_10rem_auto]">
                <input className="input" disabled={disabled} placeholder="Nome do serviço/produto" value={sv.name}
                  onChange={(e) => set("services", s.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input" disabled={disabled} placeholder="Preço (opcional)" value={sv.price}
                  onChange={(e) => set("services", s.services.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                <button type="button" disabled={disabled} className="icon-btn h-10 w-10 hover:text-danger" aria-label="Remover serviço"
                  onClick={() => set("services", s.services.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                <textarea className="input md:col-span-3" rows={2} disabled={disabled} placeholder="Descrição, o que inclui, prazos…" value={sv.description}
                  onChange={(e) => set("services", s.services.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              </div>
            ))}
            {!disabled && (
              <button type="button" className="btn-secondary" onClick={() => set("services", [...s.services, { name: "", description: "", price: "" }])}>
                <Plus className="h-4 w-4" /> Adicionar serviço ou produto
              </button>
            )}
          </div>
        </Section>

        <Section icon={HelpCircle} title="Perguntas frequentes">
          <div className="space-y-3">
            {s.faq.map((f, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-line bg-surface-2/40 p-3 md:grid-cols-[1fr_auto]">
                <input className="input" disabled={disabled} placeholder="Pergunta" value={f.question}
                  onChange={(e) => set("faq", s.faq.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
                <button type="button" disabled={disabled} className="icon-btn h-10 w-10 hover:text-danger" aria-label="Remover pergunta"
                  onClick={() => set("faq", s.faq.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                <textarea className="input md:col-span-2" rows={2} disabled={disabled} placeholder="Resposta" value={f.answer}
                  onChange={(e) => set("faq", s.faq.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
              </div>
            ))}
            {!disabled && (
              <button type="button" className="btn-secondary" onClick={() => set("faq", [...s.faq, { question: "", answer: "" }])}>
                <Plus className="h-4 w-4" /> Adicionar pergunta
              </button>
            )}
          </div>
        </Section>

        <Section icon={ShieldCheck} title="Regras e limites" hint="O que a IA não pode fazer ou dizer. Estas regras têm prioridade máxima.">
          {!disabled && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Usar modelo pronto:</span>
              {Object.entries(NICHE_PRESETS).map(([key, p]) => (
                <button key={key} type="button" className="btn-secondary btn-sm"
                  onClick={() => set("rules", [s.rules, p.rules].filter(Boolean).join("\n"))}>
                  <Wand2 className="h-3.5 w-3.5" /> {p.label}
                </button>
              ))}
            </div>
          )}
          <textarea className="input" rows={6} disabled={disabled} placeholder="Ex.: Não prometa resultados. Não informe valores fora da tabela…" value={s.rules ?? ""} onChange={(e) => set("rules", e.target.value || null)} />
        </Section>

        <Section icon={Clock} title="Horários e mensagens">
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={disabled} checked={s.business_hours.enabled} onChange={(e) => set("business_hours", { ...s.business_hours, enabled: e.target.checked })} />
              Informar horário de atendimento humano
            </label>
            {s.business_hours.enabled && (
              <div className="flex flex-wrap items-end gap-3">
                <label><span className="label">Das</span><input type="time" className="input w-32" disabled={disabled} value={s.business_hours.start} onChange={(e) => set("business_hours", { ...s.business_hours, start: e.target.value })} /></label>
                <label><span className="label">Até</span><input type="time" className="input w-32" disabled={disabled} value={s.business_hours.end} onChange={(e) => set("business_hours", { ...s.business_hours, end: e.target.value })} /></label>
                <div className="flex gap-1">
                  {DAYS.map((d, i) => {
                    const on = s.business_hours.days.includes(i);
                    return (
                      <button key={d} type="button" disabled={disabled} aria-pressed={on}
                        onClick={() => set("business_hours", { ...s.business_hours, days: on ? s.business_hours.days.filter((x) => x !== i) : [...s.business_hours.days, i].sort() })}
                        className={`h-10 w-11 rounded-lg border text-xs font-medium ${on ? "border-brand-500 bg-accent-soft text-accent-strong" : "border-line text-muted"}`}>
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {s.business_hours.enabled && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={disabled} checked={s.only_outside_hours} onChange={(e) => set("only_outside_hours", e.target.checked)} />
                IA atende <strong>somente fora</strong> do horário (no horário, só a equipe)
              </label>
            )}
            <label className="block"><span className="label">Saudação (primeira mensagem)</span>
              <input className="input" disabled={disabled} placeholder="Ex.: Olá! Sou a Ana, assistente do escritório. Como posso ajudar?" value={s.greeting ?? ""} onChange={(e) => set("greeting", e.target.value || null)} />
            </label>
            <label className="block"><span className="label">Mensagem ao transferir para a equipe</span>
              <input className="input" disabled={disabled} value={s.handoff_message} onChange={(e) => set("handoff_message", e.target.value)} />
            </label>
            <label className="block"><span className="label">Quando alguém da equipe responder, pausar a IA na conversa por (horas)</span>
              <input type="number" min={1} max={720} className="input w-32" disabled={disabled} value={s.human_pause_hours} onChange={(e) => set("human_pause_hours", Math.max(1, Math.min(720, Number(e.target.value) || 1)))} />
            </label>
          </div>
        </Section>

        {isAdmin && (
          <div className="sticky bottom-4 z-10 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg">
            <button type="button" className="btn-primary" disabled={saving} onClick={save}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar configuração
            </button>
            {msg && <span className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
          </div>
        )}
      </div>

      <div className="space-y-6">
        {isAdmin && <TestChat settings={s} available={aiAvailable} />}
        {usage && (
          <section className="card">
            <h2 className="section-title"><Sparkles className="h-4 w-4 text-accent" /> Uso neste mês</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs text-muted">Respostas/sugestões</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{usage.mensagens}</dd></div>
              <div className="rounded-xl bg-surface-2 p-3"><dt className="text-xs text-muted">Testes</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{usage.testes}</dd></div>
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

function TestChat({ settings, available }: { settings: AiSettings; available: boolean }) {
  const [history, setHistory] = useState<{ direction: "entrada" | "saida"; body: string; handoff?: boolean }[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    const next = [...history, { direction: "entrada" as const, body }];
    setHistory(next);
    setText("");
    start(async () => {
      const r = await testAiAction(settings, next.map(({ direction, body }) => ({ direction, body })));
      if (r.error || !r.reply) {
        setError(r.error ?? "Sem resposta");
        return;
      }
      setError(null);
      setHistory((h) => [...h, { direction: "saida", body: r.reply!, handoff: r.handoff }]);
    });
  };

  return (
    <section className="card flex flex-col p-0 xl:sticky xl:top-6">
      <div className="border-b border-line px-5 py-4">
        <h2 className="section-title"><Bot className="h-4 w-4 text-accent" /> Testar atendente</h2>
        <p className="mt-1 text-xs text-muted">Converse como se fosse um cliente. Usa a configuração da tela (mesmo sem salvar).</p>
      </div>
      <div className="max-h-[28rem] min-h-64 flex-1 space-y-2 overflow-y-auto bg-surface-2/40 p-4">
        {history.length === 0 && <p className="py-8 text-center text-xs text-subtle">Ex.: “Oi, vocês atendem online? Quanto custa a consulta?”</p>}
        {history.map((m, i) => (
          <div key={i} className={`flex ${m.direction === "entrada" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.direction === "entrada" ? "rounded-br-md bg-gradient-to-br from-brand-500 to-brand-700 text-white" : "rounded-bl-md border border-line bg-surface"}`}>
              {m.direction === "saida" && <p className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-accent"><Bot className="h-3 w-3" /> {settings.assistant_name}</p>}
              {m.direction === "entrada" && <p className="mb-0.5 flex items-center gap-1 text-[10px] text-white/70"><UserRound className="h-3 w-3" /> Cliente</p>}
              <p className="whitespace-pre-wrap">{m.body}</p>
              {m.handoff && <p className="mt-1 text-[10px] font-medium text-warning">→ Transferiria para a equipe</p>}
            </div>
          </div>
        ))}
        {pending && <p className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Digitando…</p>}
      </div>
      {error && <p className="px-4 pt-2 text-xs text-danger">{error}</p>}
      <div className="flex gap-2 border-t border-line p-3">
        <input className="input flex-1 rounded-full" disabled={!available || pending} placeholder={available ? "Mensagem do cliente" : "IA não configurada"} value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button type="button" className="btn-primary" disabled={!available || pending} onClick={send} aria-label="Enviar"><Send className="h-4 w-4" /></button>
      </div>
      {history.length > 0 && (
        <button type="button" className="btn-ghost btn-sm m-2 self-start" onClick={() => setHistory([])}>Limpar conversa</button>
      )}
    </section>
  );
}
