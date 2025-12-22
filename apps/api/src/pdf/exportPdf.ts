import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type ExportSnapshot = {
  event: {
    id: string;
    name: string;
    location: string;
    deliveryDatetime: string;
    pickupDatetime: string;
    version: number;
    exportedAt: string;
  };
  groups: Array<{
    parentCategory: string;
    category: string;
    items: Array<{
      inventoryItemId: string;
      name: string;
      unit: string;
      qty: number;
      notes?: string | null;
    }>;
  }>;
};

export async function buildExportPdf(snapshot: ExportSnapshot) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const cover = pdfDoc.addPage();
  let page = cover;
  let { width, height } = page.getSize();
  const title = `Balení akce – v${snapshot.event.version}`;
  page.drawText(title, { x: 50, y: height - 60, size: 20, font: bold });
  page.drawText(snapshot.event.name, { x: 50, y: height - 90, size: 14, font });
  page.drawText(`Místo: ${snapshot.event.location}`, { x: 50, y: height - 110, size: 12, font });
  page.drawText(`Doručení: ${snapshot.event.deliveryDatetime}`, { x: 50, y: height - 130, size: 12, font });
  page.drawText(`Svoz: ${snapshot.event.pickupDatetime}`, { x: 50, y: height - 150, size: 12, font });
  page.drawText(`Export: ${snapshot.event.exportedAt}`, { x: 50, y: height - 170, size: 10, font, color: rgb(0.3, 0.3, 0.3) });

  let y = height - 210;
  for (const group of snapshot.groups) {
    page.drawText(`${group.parentCategory} / ${group.category}`, { x: 50, y, size: 12, font: bold });
    y -= 16;
    for (const item of group.items) {
      page.drawText(`- ${item.name}: ${item.qty} ${item.unit}`, { x: 60, y, size: 11, font });
      y -= 14;
      if (y < 60) {
        page = pdfDoc.addPage();
        ({ width, height } = page.getSize());
        y = height - 60;
      }
    }
    y -= 10;
  }

  for (const group of snapshot.groups) {
    for (const item of group.items) {
      const p = pdfDoc.addPage();
      const { width: w, height: h } = p.getSize();
      p.drawText(`Položka (sklad) – v${snapshot.event.version}`, { x: 50, y: h - 50, size: 14, font: bold });
      p.drawText(`${group.parentCategory} / ${group.category}`, { x: 50, y: h - 70, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
      p.drawText(item.name, { x: 50, y: h - 110, size: 18, font: bold });
      p.drawText(`Množství: ${item.qty} ${item.unit}`, { x: 50, y: h - 140, size: 14, font });
      p.drawText(`Akce: ${snapshot.event.name}`, { x: 50, y: h - 165, size: 12, font });
      p.drawText(`Místo: ${snapshot.event.location}`, { x: 50, y: h - 185, size: 12, font });

      const boxY = h - 240;
      p.drawRectangle({ x: 50, y: boxY, width: w - 100, height: 40, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      p.drawText("Sbaleno / zkontrolováno", { x: 60, y: boxY + 14, size: 12, font });
      p.drawRectangle({ x: w - 140, y: boxY + 10, width: 18, height: 18, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    }
  }

  return pdfDoc.save();
}
