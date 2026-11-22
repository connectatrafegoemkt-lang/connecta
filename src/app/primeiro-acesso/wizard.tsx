"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Building,
  Check,
  ClipboardList,
  HeartPulse,
  Home,
  Layers,
  Loader2,
  Lock,
  MessageSquareText,
  Scale,
  Shapes,
  Tag,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  buildNicheSetup,
  FIELD_TYPE_LABEL,
  NICHE_KEYS,
  NICHES,
  SETUP_GROUP_LABEL,
  SETUP_GROUPS,
  type Answers,
  type NicheKey,
  type Question,
  type SetupGroup,
} from "@/shared/niches";
import { applyNicheSetupAction, skipNicheSetupAction } from "../(app)/actions";

const NICHE_ICON: Record<NicheKey, LucideIcon> = {
  advocacia: Scale,
  arquitetura: Building,
  saude: HeartPulse,
  imobiliaria: Home,
  outro: Shapes,
};
const GROUP_ICON: Record<SetupGroup, LucideIcon> = {
  stages: Layers,
  tags: Tag,
  quick_replies: MessageSquareText,
  departments: Users,
  contact_fields: ClipboardList,
  ai: Bot,
};

function defaults(niche: NicheKey): Answers {
  const a: Answers = {};
  for (const q of NICHES[niche].questions) if (q.default !== undefined) a[q.id] = q.default;
  return a;
}

function QuestionInput({ q, value, onChange }: { q: Question; value: Answers[string]; onChange: (v: string | string[]) => void }) {
  if (q.type === "text") {
    return (
      <textarea
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        maxLength={q.max ?? 300}
        rows={q.max && q.max > 200 ? 3 : 1}
        placeholder={q.placeholder}
        className="input mt-2"
      />
    );
  }
  const selected = new Set(Array.isArray(value) ? value : value ? [value] : []);
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {q.options!.map((o) => {
        const on = selected.has(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (q.type === "single") return onChange(o.value);
              const next = new Set(selected);
              if (on) next.delete(o.value);
              else next.add(o.value);
              onChange(q.options!.filter((x) => next.has(x.value)).map((x) => x.value));
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
              on ? "border-brand-500 bg-brand-500/15 text-accent-strong" : "border-line text-muted hover:border-brand-500/50 hover:text-fg"
            }`}
          >
            {on && <Check className="h-3.5 w-3.5" />} {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function NicheWizard({
  companyName,
  initialNiche,
  allowed,
  firstTime,
}: {
  companyName: string;
  initialNiche: NicheKey | null;
  allowed: SetupGroup[];
  firstTime: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [niche, setNiche] = useState<NicheKey | null>(initialNiche);
  const [answers, setAnswers] = useState<Answers>(initialNiche ? defaults(initialNiche) : {});
  const [include, setInclude] = useState<Set<SetupGroup>>(new Set(allowed));
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, number | boolean> | null>(null);
  const [busy, start] = useTransition();

  const preview = useMemo(
    () => (niche ? buildNicheSetup(niche, answers, companyName, SETUP_GROUPS) : null),
    [niche, answers, companyName],
  );

  function chooseNiche(n: NicheKey) {
    if (n !== niche) setAnswers(defaults(n));
    setNiche(n);
    setStep(1);
  }

  function apply() {
    if (!niche) return;
    setError(null);
    start(async () => {
      const r = await applyNicheSetupAction({ niche, answers, include: [...include] });
      if (!r.ok) {
        setError(r.error ?? "Não foi possível aplicar. Tente de novo.");
        return;
      }
      setResult(r.result ?? {});
      setStep(3);
    });
  }

  function skip() {
    start(async () => {
      const r = await skipNicheSetupAction();
      if (!r.ok) setError(r.error ?? "Não foi possível pular.");
      else router.push("/dashboard");
    });
  }

  const steps = ["Segmento", "Perguntas", "Revisar"];

  return (
    <div className="card">
      {step < 3 && (
        <ol className="mb-6 flex items-center gap-2 text-xs font-medium">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full ${
                  i <= step ? "bg-brand-500 text-white" : "bg-surface-2 text-subtle"
                }`}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={i === step ? "text-fg" : "text-subtle"}>{s}</span>
              {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-line" />}
            </li>
          ))}
        </ol>
      )}

      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold">Qual é o segmento da sua empresa?</h2>
          <p className="mt-1 text-sm text-muted">Com isso, o CRM já vem com funil, etiquetas e mensagens prontas para o seu dia a dia.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {NICHE_KEYS.map((k) => {
              const Icon = NICHE_ICON[k];
              const active = niche === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => chooseNiche(k)}
                  className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition hover:border-brand-500/60 hover:bg-brand-500/5 ${
                    active ? "border-brand-500 bg-brand-500/10" : "border-line"
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium">{NICHES[k].label}</span>
                    <span className="block text-sm text-muted">{NICHES[k].description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            {firstTime ? (
              <button type="button" onClick={skip} disabled={busy} className="btn-ghost text-sm">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Pular por enquanto
              </button>
            ) : (
              <Link href="/configuracoes" className="btn-ghost text-sm"><ArrowLeft className="h-4 w-4" /> Voltar às configurações</Link>
            )}
            <span className="text-xs text-subtle">Você pode refazer isso depois em Configurações.</span>
          </div>
        </div>
      )}

      {step === 1 && niche && (
        <div>
          <h2 className="text-lg font-semibold">{NICHES[niche].label}: algumas perguntas rápidas</h2>
          <div className="mt-5 space-y-6">
            {NICHES[niche].questions.map((q) => (
              <div key={q.id}>
                <p className="font-medium">{q.label}</p>
                {q.help && <p className="text-xs text-muted">{q.help}</p>}
                <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
            <button type="button" onClick={() => setStep(0)} className="btn-ghost"><ArrowLeft className="h-4 w-4" /> Voltar</button>
            <button type="button" onClick={() => setStep(2)} className="btn-primary">Ver o que será criado <ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {step === 2 && niche && preview && (
        <div>
          <h2 className="text-lg font-semibold">Confira o que vamos preparar</h2>
          <p className="mt-1 text-sm text-muted">
            Desmarque o que não quiser. Nada é apagado: etapas do funil que já têm leads continuam, e etiquetas, mensagens e campos com o mesmo nome são mantidos. A IA continua desligada até você ligar.
          </p>
          <div className="mt-5 space-y-3">
            {SETUP_GROUPS.map((g) => {
              const Icon = GROUP_ICON[g];
              const permitted = allowed.includes(g);
              const on = permitted && include.has(g);
              const items: string[] =
                g === "stages" ? preview.stages!.map((s) => s.name + (s.is_won ? " (ganho)" : s.is_lost ? " (perdido)" : ""))
                : g === "tags" ? preview.tags!.map((t) => t.name)
                : g === "quick_replies" ? preview.quick_replies!.map((q) => `/${q.shortcut} · ${q.title}`)
                : g === "departments" ? preview.departments!.map((d) => d.name)
                : g === "contact_fields" ? preview.contact_fields!.map((f) => `${f.label} (${FIELD_TYPE_LABEL[f.type]})`)
                : [preview.ai!.business_area || preview.ai!.niche, "Regras de atendimento do segmento", "Saudação inicial"];
              if (items.length === 0 && g === "departments") {
                return (
                  <div key={g} className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3 text-sm text-subtle">
                    <Icon className="h-4 w-4" /> {SETUP_GROUP_LABEL[g]}: nenhum (você escolheu não separar em setores)
                  </div>
                );
              }
              return (
                <label key={g} className={`block rounded-xl border p-3 transition ${on ? "border-brand-500/50 bg-brand-500/5" : "border-line opacity-70"}`}>
                  <span className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!permitted}
                      onChange={(e) =>
                        setInclude((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(g);
                          else n.delete(g);
                          return n;
                        })
                      }
                      className="h-4 w-4 accent-[var(--color-brand-500,#a100ff)]"
                    />
                    <Icon className="h-4 w-4 text-accent" />
                    <span className="font-medium">{SETUP_GROUP_LABEL[g]}</span>
                    {!permitted && <span className="chip ml-auto"><Lock className="h-3 w-3" /> sem permissão</span>}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1.5 pl-11">
                    {items.map((it) => (
                      <span key={it} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{it}</span>
                    ))}
                  </span>
                </label>
              );
            })}
          </div>
          {error && (
            <p className="mt-4 flex items-center gap-2 text-sm text-danger"><TriangleAlert className="h-4 w-4" /> {error}</p>
          )}
          <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
            <button type="button" onClick={() => setStep(1)} className="btn-ghost" disabled={busy}><ArrowLeft className="h-4 w-4" /> Voltar</button>
            <button type="button" onClick={apply} className="btn-primary" disabled={busy || include.size === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Aplicar ao meu CRM
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="py-6 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-xl font-semibold">Tudo pronto!</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Seu CRM foi configurado para {niche ? NICHES[niche].label.toLowerCase() : "o seu segmento"}.
            {result && (
              <>
                {" "}Criamos{" "}
                {[
                  typeof result.stages === "number" && `${result.stages} etapa(s)`,
                  typeof result.tags === "number" && `${result.tags} etiqueta(s)`,
                  typeof result.quick_replies === "number" && `${result.quick_replies} mensagem(ns) rápida(s)`,
                  typeof result.departments === "number" && result.departments > 0 && `${result.departments} setor(es)`,
                  typeof result.contact_fields === "number" && `${result.contact_fields} campo(s) na ficha`,
                ]
                  .filter(Boolean)
                  .join(", ")}
                {result.ai ? " e preenchemos as instruções da IA" : ""}.
              </>
            )}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/funil" className="btn-secondary">Ver o funil</Link>
            <Link href="/dashboard" className="btn-primary">Ir para o painel <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      )}
    </div>
  );
}
