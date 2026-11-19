"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

const COLORS = ["#00a884", "#53bdeb", "#a100ff", "#f59e0b", "#ef4444", "#0ea5e9", "#22c55e", "#ec4899"];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

function colorFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/**
 * Foto do contato (ou iniciais). Com `zoomable`, clicar abre a foto ampliada,
 * como no WhatsApp. O link é temporário e assinado (bucket privado do tenant).
 */
export function Avatar({ name, url, size = 48, zoomable = false }: { name: string; url?: string | null; size?: number; zoomable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const showImg = url && !broken;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const face = showImg ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={`Foto de ${name}`} onError={() => setBroken(true)} className="h-full w-full object-cover" />
  ) : (
    <span className="flex h-full w-full items-center justify-center font-semibold text-white" style={{ backgroundColor: colorFor(name), fontSize: size * 0.36 }}>
      {initials(name)}
    </span>
  );

  return (
    <>
      {zoomable && showImg ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className="shrink-0 overflow-hidden rounded-full ring-offset-2 transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--wa-green)]"
          style={{ width: size, height: size }}
          aria-label={`Ver foto de ${name}`}
        >
          {face}
        </button>
      ) : (
        <span className="block shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size }}>
          {face}
        </span>
      )}
      {open && showImg && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Foto de ${name}`} onClick={() => setOpen(false)}>
          <div className="flex items-center justify-between px-5 py-4 text-white">
            <span className="font-medium">{name}</span>
            <button type="button" className="rounded-full p-2 hover:bg-white/10" aria-label="Fechar" onClick={() => setOpen(false)}>
              <X className="h-6 w-6" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Foto de ${name}`} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </>
  );
}
