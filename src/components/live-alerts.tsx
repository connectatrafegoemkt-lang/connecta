"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BellOff, TriangleAlert, X } from "lucide-react";
import { downNumbers, downReason, type AlertNumber } from "@/shared/whatsapp-alerts";
import { playAlarmSound, playMessageSound, setSoundEnabled, SOUND_EVENT, soundEnabled, unlockAudio } from "./sounds";

const POLL_MS = 8_000;

interface Payload {
  numbers: AlertNumber[];
  lastInbound: { id: string; at: string; contact_id: string; contact: string; preview: string } | null;
}

function notify(title: string, body: string, tag: string, href: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag, icon: "/logo-tile.png" });
    n.onclick = () => {
      window.focus();
      window.location.href = href;
      n.close();
    };
  } catch {
    /* navegador sem notificações */
  }
}

/**
 * Avisos em todas as telas do CRM:
 *  - faixa vermelha + bipe + notificação quando um número de WhatsApp cai,
 *    é bloqueado ou desconectado (depois de uma tolerância curta);
 *  - "plim" + notificação a cada mensagem recebida.
 */
export function LiveAlerts({ enabled }: { enabled: boolean }) {
  const [down, setDown] = useState<AlertNumber[]>([]);
  const [hidden, setHidden] = useState<string>("");
  const since = useRef(new Map<string, number>());
  const alerted = useRef(new Set<string>());
  const lastInbound = useRef<string | null | undefined>(undefined);
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;
    const unlock = () => {
      unlockAudio();
      // pede (uma vez) permissão para avisar mesmo com a aba em segundo plano
      try {
        if (typeof Notification !== "undefined" && Notification.permission === "default" && !localStorage.getItem("connecta:notif-pedido")) {
          localStorage.setItem("connecta:notif-pedido", "1");
          void Notification.requestPermission();
        }
      } catch {
        /* sem suporte */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function check() {
      try {
        const res = await fetch("/api/avisos", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Payload;
        // WhatsApp fora do ar
        const now = Date.now();
        const out = downNumbers(data.numbers, since.current, now);
        setDown(out);
        for (const id of [...alerted.current]) if (!out.some((n) => n.id === id)) alerted.current.delete(id);
        const fresh = out.filter((n) => !alerted.current.has(n.id));
        if (fresh.length) {
          fresh.forEach((n) => alerted.current.add(n.id));
          if (soundEnabled()) playAlarmSound();
          const n = fresh[0];
          notify(`WhatsApp "${n.label}" fora do ar`, downReason(n), `wa-down-${n.id}`, "/whatsapp");
        }
        // Mensagem nova recebida
        const li = data.lastInbound;
        if (lastInbound.current === undefined) {
          lastInbound.current = li?.id ?? null; // primeira leitura: só marca
        } else if (li && li.id !== lastInbound.current) {
          lastInbound.current = li.id;
          if (soundEnabled()) playMessageSound();
          if (document.hidden) notify(li.contact, li.preview, `msg-${li.contact_id}`, `/whatsapp?contato=${li.contact_id}`);
        }
      } catch {
        /* sem rede: tenta no próximo ciclo */
      } finally {
        if (!stop) timer = setTimeout(check, document.hidden ? POLL_MS * 2 : POLL_MS);
      }
    }
    void check();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [enabled]);

  const visible = down.filter((n) => !hidden.split(",").includes(n.id));
  if (!enabled || visible.length === 0) return null;
  const onWhatsapp = pathname?.startsWith("/whatsapp");
  return (
    <div role="alert" className="z-30 md:sticky md:top-0 border-b border-danger/30 bg-danger px-4 py-2.5 text-sm text-white shadow-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">
          {visible.map((n) => (
            <span key={n.id} className="block">
              <strong>WhatsApp “{n.label}” fora do ar.</strong> {downReason(n)}
            </span>
          ))}
        </p>
        {!onWhatsapp && (
          <Link href="/whatsapp" className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-danger hover:bg-white/90">
            Reconectar
          </Link>
        )}
        <button
          type="button"
          className="rounded-full p-1 hover:bg-white/15"
          aria-label="Ocultar aviso"
          title="Ocultar (volta a avisar se cair de novo)"
          onClick={() => setHidden(visible.map((n) => n.id).join(","))}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Botão para ligar/desligar o som e permitir notificações do navegador. */
export function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const sync = () => setOn(soundEnabled());
    sync();
    window.addEventListener(SOUND_EVENT, sync);
    return () => window.removeEventListener(SOUND_EVENT, sync);
  }, []);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={on}
      aria-label={on ? "Desligar som das mensagens" : "Ligar som das mensagens"}
      title={on ? "Som e avisos ligados (clique para desligar)" : "Som desligado (clique para ligar)"}
      onClick={() => {
        const next = !on;
        setSoundEnabled(next);
        if (next) {
          unlockAudio();
          playMessageSound();
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
          } catch {
            /* sem suporte */
          }
        }
      }}
    >
      {on ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
    </button>
  );
}
