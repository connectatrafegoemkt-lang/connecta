/** Utilitários de nome/extensão de arquivo (usados pelo app e pelo worker). */
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "application/pdf": "pdf",
};

export function extFromMime(mime: string | null | undefined, filename?: string | null): string {
  const fromName = filename?.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return EXT[base] ?? "bin";
}

/** Nome de arquivo seguro (sem barras nem "..") para compor caminhos no storage. */
export function safeName(name: string): string {
  const clean = name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\w.-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^\.+/, "");
  return clean.slice(0, 120) || "arquivo";
}

