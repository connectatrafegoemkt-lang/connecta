import type { ContactFieldDef } from "@/shared/custom-fields";

/**
 * Inputs dos campos extras da ficha do lead (nome "cf.<chave>"). O servidor
 * valida cada valor contra os campos do tenant antes de gravar.
 */
export function CustomFieldInputs({
  fields,
  values = {},
  labelClassName = "label",
  className = "grid grid-cols-2 gap-3",
}: {
  fields: ContactFieldDef[];
  values?: Record<string, unknown>;
  labelClassName?: string;
  className?: string;
}) {
  if (!fields.length) return null;
  return (
    <div className={className}>
      {fields.map((f) => {
        const v = values[f.key];
        const name = `cf.${f.key}`;
        const wide = f.type === "texto" && /resumo|observ|descri/.test(f.key);
        let input: React.ReactNode;
        switch (f.type) {
          case "numero":
            input = <input name={name} inputMode="decimal" defaultValue={typeof v === "number" ? String(v).replace(".", ",") : ""} className="input" />;
            break;
          case "data":
            input = <input name={name} type="date" defaultValue={typeof v === "string" ? v : ""} className="input" />;
            break;
          case "opcoes":
            input = (
              <select name={name} defaultValue={typeof v === "string" ? v : ""} className="input">
                <option value="">—</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                {typeof v === "string" && v && !f.options.includes(v) && <option value={v}>{v}</option>}
              </select>
            );
            break;
          case "sim_nao":
            input = (
              <select name={name} defaultValue={v === true ? "sim" : v === false ? "nao" : ""} className="input">
                <option value="">—</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            );
            break;
          default:
            input = wide ? (
              <textarea name={name} defaultValue={typeof v === "string" ? v : v == null ? "" : String(v)} rows={2} className="input" />
            ) : (
              <input name={name} defaultValue={typeof v === "string" ? v : v == null ? "" : String(v)} className="input" />
            );
        }
        return (
          <label key={f.key} className={`block ${wide ? "col-span-full" : ""}`}>
            <span className={labelClassName}>{f.label}</span>
            {input}
          </label>
        );
      })}
    </div>
  );
}
