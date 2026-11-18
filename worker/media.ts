import { spawn } from "node:child_process";
import type { IncomingMessage } from "./inbound";

export type MediaKind = "audio" | "image" | "video" | "document";

export interface MediaMeta {
  kind: MediaKind;
  path: string;
  mime: string;
  filename: string | null;
}

export { extFromMime, safeName } from "../src/shared/media-names";

/** Identifica a mídia de uma mensagem recebida (ou null se for só texto). */
export function describeMedia(message: IncomingMessage["message"]): {
  kind: MediaKind;
  mime: string;
  filename: string | null;
  size: number;
} | null {
  if (!message) return null;
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message;
  const size = (x: { fileLength?: number | { toNumber(): number } }) =>
    typeof x.fileLength === "number" ? x.fileLength : x.fileLength?.toNumber?.() ?? 0;
  if (m.imageMessage) return { kind: "image", mime: m.imageMessage.mimetype ?? "image/jpeg", filename: null, size: size(m.imageMessage) };
  if (m.stickerMessage) return { kind: "image", mime: m.stickerMessage.mimetype ?? "image/webp", filename: null, size: size(m.stickerMessage) };
  if (m.videoMessage) return { kind: "video", mime: m.videoMessage.mimetype ?? "video/mp4", filename: null, size: size(m.videoMessage) };
  if (m.audioMessage) return { kind: "audio", mime: m.audioMessage.mimetype ?? "audio/ogg", filename: null, size: size(m.audioMessage) };
  if (m.documentMessage)
    return {
      kind: "document",
      mime: m.documentMessage.mimetype ?? "application/octet-stream",
      filename: m.documentMessage.fileName ?? null,
      size: size(m.documentMessage),
    };
  return null;
}

/** Converte qualquer áudio (ex.: webm do navegador) para OGG/Opus, formato de áudio de voz do WhatsApp. */
export function toOggOpus(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "32k", "-f", "ogg", "pipe:1"]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    ff.stdout.on("data", (d) => out.push(d));
    ff.stderr.on("data", (d) => err.push(d));
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg: ${Buffer.concat(err).toString().slice(0, 300)}`))));
    ff.stdin.on("error", () => undefined);
    ff.stdin.end(input);
  });
}

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
