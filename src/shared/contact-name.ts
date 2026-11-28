/**
 * Contato criado automaticamente (mensagem de número não cadastrado) fica com
 * o telefone como nome ("+5511988887777"). Nesse caso mostramos o nome que a
 * pessoa usa no WhatsApp, até alguém cadastrar um nome de verdade.
 */
export function isPlaceholderName(name: string | null | undefined, phone: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return true;
  if (/[a-zA-ZÀ-ÿ]/.test(n)) return false; // tem letra: é um nome
  const digits = n.replace(/\D/g, "");
  if (!digits) return false;
  const p = (phone ?? "").replace(/\D/g, "");
  return !p || digits === p || p.endsWith(digits) || digits.endsWith(p);
}

/** Nome para exibir: o cadastrado, ou o do WhatsApp se o cadastrado for só o telefone. */
export function displayName(c: { name: string | null | undefined; phone?: string | null; whatsapp_name?: string | null }): string {
  const wa = c.whatsapp_name?.trim();
  if (wa && isPlaceholderName(c.name, c.phone)) return wa;
  return c.name?.trim() || wa || "Contato";
}
