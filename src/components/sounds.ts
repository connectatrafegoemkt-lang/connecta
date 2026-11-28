/**
 * Sons do CRM gerados no navegador (sem arquivo de áudio).
 * O navegador só libera som depois do primeiro clique/tecla na página.
 */
let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (typeof window === "undefined") return;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* sem suporte a áudio */
  }
}

function tone(freq: number, start: number, dur: number, volume = 0.18) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** "Plim" curto de mensagem nova. */
export function playMessageSound() {
  unlockAudio();
  if (!ctx || ctx.state !== "running") return;
  tone(988, 0, 0.18);
  tone(1319, 0.11, 0.28);
}

/** Alerta de WhatsApp fora do ar (3 bipes graves). */
export function playAlarmSound() {
  unlockAudio();
  if (!ctx || ctx.state !== "running") return;
  for (let i = 0; i < 3; i++) tone(440, i * 0.28, 0.2, 0.22);
}

const KEY = "connecta:som";
export const SOUND_EVENT = "connecta:som";

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* navegador sem armazenamento */
  }
  window.dispatchEvent(new Event(SOUND_EVENT));
}
