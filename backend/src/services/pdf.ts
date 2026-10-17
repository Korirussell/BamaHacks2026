import { getDocumentProxy } from "unpdf";

/**
 * A PDF's text as rows of cells, top to bottom per page. Text items on the same baseline
 * (within 2pt) form a row; items are ordered left to right. Table-shaped PDFs like the Banner
 * transcript come out one table row per entry.
 */
export async function pdfRows(bytes: Uint8Array): Promise<string[][]> {
  const pdf = await getDocumentProxy(bytes);
  const out: string[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const rows: { y: number; items: { x: number; s: string }[] }[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x, s: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) out.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s));
  }
  return out;
}
