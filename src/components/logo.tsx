import Image from "next/image";

/** Símbolo da CONNECTA. `mix-blend-screen` some com o fundo preto da arte. */
export function LogoMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo-connecta.png"
      alt="CONNECTA"
      width={size}
      height={Math.round(size * 0.5)}
      priority
      className={`mix-blend-screen ${className}`}
      style={{ width: size, height: "auto" }}
    />
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[0.22em] text-fg ${className}`}>
      CONNECTA
    </span>
  );
}
