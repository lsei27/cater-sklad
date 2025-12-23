import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type ExportSnapshot = {
  event: {
    id: string;
    name: string;
    location: string;
    address?: string | null;
    eventDate?: string | null;
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

function pdfText(value: unknown) {
  const s = value === null || value === undefined ? "" : String(value);
  return s
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function formatCzechDate(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  return `${day}. ${month}. ${year}`;
}

function formatCzechTime(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export async function buildExportPdf(snapshot: ExportSnapshot) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();

  // Title: Event Name
  page.drawText(pdfText(snapshot.event.name), { x: 50, y: height - 50, size: 22, font: bold });

  // Event Date (if available)
  let yPos = height - 80;
  if (snapshot.event.eventDate) {
    page.drawText(pdfText(`Datum akce: ${formatCzechDate(snapshot.event.eventDate)}`), { x: 50, y: yPos, size: 12, font });
    yPos -= 18;
  }

  // Start Time (from deliveryDatetime)
  page.drawText(pdfText(`Zacatek akce: ${formatCzechTime(snapshot.event.deliveryDatetime)}`), { x: 50, y: yPos, size: 12, font });
  yPos -= 18;

  // Location
  page.drawText(pdfText(`Misto konani: ${snapshot.event.location}`), { x: 50, y: yPos, size: 12, font });
  yPos -= 18;

  // Address (if available)
  if (snapshot.event.address) {
    page.drawText(pdfText(`Adresa: ${snapshot.event.address}`), { x: 50, y: yPos, size: 12, font });
    yPos -= 18;
  }

  // Pickup Time
  page.drawText(pdfText(`Svoz: ${formatCzechDate(snapshot.event.pickupDatetime)}, ${formatCzechTime(snapshot.event.pickupDatetime)}`), { x: 50, y: yPos, size: 12, font });
  yPos -= 30;

  // Section Header: Items to Pack
  page.drawText(pdfText("Polozky k zabaleni"), { x: 50, y: yPos, size: 14, font: bold });
  yPos -= 20;

  // Table Header
  const colName = 50;
  const colQty = 380;
  const colCheck = 480;

  page.drawText(pdfText("Nazev"), { x: colName, y: yPos, size: 11, font: bold });
  page.drawText(pdfText("Mnozstvi"), { x: colQty, y: yPos, size: 11, font: bold });
  page.drawText(pdfText("OK"), { x: colCheck, y: yPos, size: 11, font: bold });
  yPos -= 4;
  page.drawLine({ start: { x: 50, y: yPos }, end: { x: width - 50, y: yPos }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  yPos -= 14;

  // Flatten items across groups for a single list
  const allItems: Array<{ name: string; qty: number; unit: string; category: string }> = [];
  for (const group of snapshot.groups) {
    for (const item of group.items) {
      allItems.push({
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        category: `${group.parentCategory} / ${group.category}`
      });
    }
  }

  for (const item of allItems) {
    if (yPos < 60) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      yPos = height - 50;
    }

    // Item Name
    page.drawText(pdfText(item.name), { x: colName, y: yPos, size: 10, font });

    // Quantity
    page.drawText(pdfText(`${item.qty} ${item.unit}`), { x: colQty, y: yPos, size: 10, font });

    // Checkbox
    page.drawRectangle({ x: colCheck, y: yPos - 2, width: 12, height: 12, borderColor: rgb(0, 0, 0), borderWidth: 1 });

    yPos -= 16;
  }

  return pdfDoc.save();
}
