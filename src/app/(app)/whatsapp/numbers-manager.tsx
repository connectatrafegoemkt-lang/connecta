"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Smartphone, Trash2, X } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { addWhatsappNumberAction, removeWhatsappNumberAction, renameWhatsappNumberAction } from "../actions";

export interface NumberItem {
  id: string;
  label: string;
  is_primary: boolean;
  status: string;
  phone: string | null;
}

const STATUS: Record<string, string> = {
  conectado: "Conectado",
  aguardando_qr: "Aguardando QR",
  conectando: "Conectando…",
  desconectado: "Desconectado",
  erro: "Erro",
};

/** Lista os números de WhatsApp do cliente: adicionar, renomear e remover. */
export function NumbersManager({ numbers, limit }: { numbers: NumberItem[]; limit: number }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const canAdd = numbers.length < limit;

  return (
    <div className="border-b border-line/60 px-3 py-2 text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 font-medium text-muted hover:text-fg">
        <span className="flex items-center gap-1.5">
          <Smartphone className="h-3.5 w-3.5" /> Números de WhatsApp ({numbers.length}/{limit})
        </span>
        <span>{open ? "Fechar" : "Gerenciar"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <ul className="space-y-1.5">
            {numbers.map((n) => (
              <li key={n.id} className="rounded-lg bg-surface-2/60 px-2 py-1.5">
                {editing === n.id ? (
                  <ActionForm action={renameWhatsappNumberAction} className="flex items-center gap-1.5" submitLabel="Salvar" submitIcon={<Check className="h-3 w-3" />} submitClassName="btn-secondary btn-sm">
                    <input type="hidden" name="id" value={n.id} />
                    <input name="label" defaultValue={n.label} required maxLength={40} className="input flex-1 py-1 text-xs" aria-label="Nome do número" autoFocus />
                    <button type="button" className="icon-btn h-6 w-6" onClick={() => setEditing(null)} aria-label="Cancelar"><X className="h-3 w-3" /></button>
                  </ActionForm>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg">
                        {n.label} {n.is_primary && <span className="text-subtle">(principal)</span>}
                      </span>
                      <span className="block text-subtle">
                        {STATUS[n.status] ?? n.status}
                        {n.phone ? ` · +${n.phone}` : ""}
                      </span>
                    </span>
                    <button type="button" className="icon-btn h-6 w-6" onClick={() => setEditing(n.id)} title="Renomear" aria-label={`Renomear ${n.label}`}>
                      <Pencil className="h-3 w-3" />
                    </button>
                    {!n.is_primary && (
                      <ActionForm action={removeWhatsappNumberAction} submitLabel="Remover" submitIcon={<Trash2 className="h-3 w-3" />} submitClassName="btn-ghost btn-sm px-1.5 text-[11px] hover:text-danger">
                        <input type="hidden" name="id" value={n.id} />
                      </ActionForm>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canAdd ? (
            <ActionForm action={addWhatsappNumberAction} resetOnSuccess className="flex items-center gap-1.5" submitLabel="Adicionar" submitIcon={<Plus className="h-3 w-3" />} submitClassName="btn-primary btn-sm">
              <input name="label" required maxLength={40} placeholder="Nome (ex.: Comercial, Suporte)" className="input flex-1 py-1 text-xs" aria-label="Nome do novo número" />
            </ActionForm>
          ) : (
            <p className="text-subtle">Limite de {limit} número(s) atingido. Fale com a CONNECTA para aumentar.</p>
          )}
          <p className="text-subtle">Remover um número desconecta o aparelho; as conversas já recebidas continuam no CRM.</p>
        </div>
      )}
    </div>
  );
}
