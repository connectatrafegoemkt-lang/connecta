import { withPlatform } from "@/server/http";
import { getMonthlyReport, monthlyReportCsv } from "@/server/platform";
import { parseMonth } from "@/shared/months";

/** Relatório mensal em CSV: /api/plataforma/relatorios?mes=AAAA-MM */
export const GET = withPlatform(async (req, p) => {
  const month = parseMonth(req.nextUrl.searchParams.get("mes"));
  const csv = monthlyReportCsv(await getMonthlyReport(p, month));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="relatorio-clientes-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
