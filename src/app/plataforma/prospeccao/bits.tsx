import { MessageCircle, Phone } from "lucide-react";
import { STATUS_COLOR, STATUS_LABEL, type ProspectStatus } from "@/shared/prospects";

export function StatusBadge({ status }: { status: string }) {
  const s = status as ProspectStatus;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `color-mix(in oklab, ${STATUS_COLOR[s] ?? "#64748b"} 16%, transparent)`, color: `color-mix(in oklab, ${STATUS_COLOR[s] ?? "#64748b"} 80%, var(--tag-mix, #000))` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s] ?? "#64748b" }} />
      {STATUS_LABEL[s] ?? status}
    </span>
  );
}

/** Abrir conversa no WhatsApp (app/web) e ligar. */
export function ContactButtons({ phone, name }: { phone: string | null; name: string }) {
  if (!phone) return null;
  return (
    <span className="flex items-center gap-1">
      <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer" className="icon-btn h-8 w-8 text-success" title={`WhatsApp de ${name}`} aria-label={`WhatsApp de ${name}`}>
        <MessageCircle className="h-4 w-4" />
      </a>
      <a href={`tel:+${phone}`} className="icon-btn h-8 w-8" title={`Ligar para ${name}`} aria-label={`Ligar para ${name}`}>
        <Phone className="h-4 w-4" />
      </a>
    </span>
  );
}

/** Seletor de próximo follow-up (atalhos + data). */
export function FollowupPicker({ defaultValue = "3dias" }: { defaultValue?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select name="quando" defaultValue={defaultValue} className="input w-auto py-1.5 text-sm" aria-label="Próximo follow-up">
        <option value="amanha">Amanhã</option>
        <option value="3dias">Em 3 dias</option>
        <option value="semana">Em 1 semana</option>
        <option value="2semanas">Em 2 semanas</option>
        <option value="mes">Em 1 mês</option>
        <option value="data">Escolher data…</option>
        <option value="sem">Sem follow-up</option>
      </select>
      <input type="datetime-local" name="followup_at" className="input w-auto py-1.5 text-sm" aria-label="Data do follow-up (se escolher data)" />
    </div>
  );
}
