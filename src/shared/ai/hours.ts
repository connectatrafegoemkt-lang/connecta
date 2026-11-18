import type { AiSettings } from "./settings";

/** Hora e dia da semana em Brasília (0 = domingo). */
export function saoPauloClock(date: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function isWithinBusinessHours(hours: AiSettings["business_hours"], date = new Date()): boolean {
  if (!hours.enabled) return true;
  const { day, minutes } = saoPauloClock(date);
  if (!hours.days.includes(day)) return false;
  const start = toMin(hours.start);
  const end = toMin(hours.end);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** A IA deve atuar agora? (modo ligado e respeitando "só fora do horário"). */
export function aiShouldAct(settings: AiSettings, date = new Date()): boolean {
  if (settings.mode === "desligado") return false;
  if (settings.only_outside_hours && settings.business_hours.enabled) {
    return !isWithinBusinessHours(settings.business_hours, date);
  }
  return true;
}
