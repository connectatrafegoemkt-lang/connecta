import Image from "next/image";

/**
 * Símbolo da CONNECTA dentro do selo escuro (a arte original tem fundo preto,
 * então ela é sempre exibida sobre esse selo para manter as cores fiéis).
 */
export function LogoMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo-tile.png"
      alt="CONNECTA"
      width={size}
      height={size}
      priority
      className={`shrink-0 rounded-[24%] shadow-[0_6px_18px_-6px_rgb(54_0_90/0.45)] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Arte completa, sem selo — usar somente sobre fundo escuro. */
export function LogoArt({ width = 320, className = "" }: { width?: number; className?: string }) {
  return (
    <Image
      src="/logo-connecta.png"
      alt="CONNECTA"
      width={width}
      height={Math.round(width * 0.48)}
      priority
      className={`mix-blend-screen ${className}`}
      style={{ width, height: "auto" }}
    />
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-semibold tracking-[0.22em] text-fg ${className}`}>CONNECTA</span>;
}
