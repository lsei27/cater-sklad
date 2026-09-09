import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { formatCzechDate, formatCzechTime } from "../lib/czechDate.js";

export type ExportSnapshot = {
  event: {
    id: string;
    name: string;
    location: string;
    address?: string | null;
    notes?: string | null;
    eventDate?: string | null;
    deliveryDatetime: string;
    pickupDatetime: string;
    version: number;
    exportedAt: string;
    managerName: string;
  };
  groups: Array<{
    parentCategory: string;
    category: string;
    items: Array<{
      inventoryItemId: string;
      name: string;
      unit: string;
      qty: number;
      masterPackageQty?: number | null;
      notes?: string | null;
      /// Chybi u exportu vytvorenych pred zavedenim skladu v balenu.
      warehouseName?: string | null;
      warehouseIsHome?: boolean | null;
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

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  const paragraphs = value.split(/\r?\n/);
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      lines.push("");
      continue;
    }
    const words = trimmed.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(pdfText(candidate), size);
      if (width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function buildExportPdf(snapshot: ExportSnapshot, subtitle?: string) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();

  // Title: Event Name
  const mainTitle = snapshot.event.name;
  const fullTitle = subtitle ? `${mainTitle} - ${subtitle}` : mainTitle;
  page.drawText(pdfText(fullTitle), { x: 50, y: height - 50, size: 20, font: bold });

  if (snapshot.event.managerName) {
    page.drawText(pdfText(`Event Manager: ${snapshot.event.managerName}`), { x: 400, y: height - 50, size: 10, font });
  }

  // Event Date (if available)
  let yPos = height - 80;
  if (snapshot.event.eventDate) {
    page.drawText(pdfText(`Datum akce: ${formatCzechDate(snapshot.event.eventDate)}`), { x: 50, y: yPos, size: 12, font });
    yPos -= 18;
  }

  // Delivery datetime (when warehouse must deliver to venue)
  page.drawText(pdfText(`Doruceni: ${formatCzechDate(snapshot.event.deliveryDatetime)}, ${formatCzechTime(snapshot.event.deliveryDatetime)}`), { x: 50, y: yPos, size: 12, font: bold });
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
  yPos -= 20;

  const eventNotes = (snapshot.event.notes ?? "").trim();
  if (eventNotes) {
    if (yPos < 80) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      yPos = height - 50;
    }

    page.drawText(pdfText("Poznamka:"), { x: 50, y: yPos, size: 11, font: bold });
    yPos -= 14;

    const noteLines = wrapText(eventNotes, font, 10, width - 100);
    for (const line of noteLines) {
      if (yPos < 60) {
        page = pdfDoc.addPage();
        ({ width, height } = page.getSize());
        yPos = height - 50;
      }
      if (line) {
        page.drawText(pdfText(line), { x: 50, y: yPos, size: 10, font });
      }
      yPos -= 12;
    }
    yPos -= 10;
  }

  // Polozky mimo domaci sklad se musi na papire poznat na prvni pohled, jinak
  // je sklad zabali z Libce a zjisti to az na miste. Starsi exporty sklad
  // nenesou (warehouseName === undefined) - tam se nehlasi nic.
  const offSiteItems = snapshot.groups.flatMap((g) =>
    (g.items ?? []).filter((it) => it.warehouseName !== undefined && it.warehouseIsHome !== true)
  );
  if (offSiteItems.length > 0) {
    if (yPos < 120) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      yPos = height - 50;
    }
    // Seznam se v boxu omezuje, at nepretece stranku. Uplny vycet je nize
    // u jednotlivych polozek, tohle je jen upozorneni na prvni pohled.
    const listed = offSiteItems.slice(0, 12);
    const boxHeight = 22 + (listed.length + (offSiteItems.length > listed.length ? 1 : 0)) * 12;
    page.drawRectangle({
      x: 46,
      y: yPos - boxHeight + 10,
      width: width - 96,
      height: boxHeight,
      color: rgb(1, 0.94, 0.94),
      borderColor: rgb(0.7, 0.1, 0.1),
      borderWidth: 1.5
    });
    page.drawText(pdfText(`POZOR - ${offSiteItems.length} polozek neni v domacim sklade!`), {
      x: 54, y: yPos, size: 12, font: bold, color: rgb(0.7, 0.1, 0.1)
    });
    yPos -= 14;
    for (const it of listed) {
      page.drawText(pdfText(`- ${it.name}: ${it.warehouseName ?? "bez prirazeneho skladu"}`), {
        x: 58, y: yPos, size: 9, font, color: rgb(0.5, 0.05, 0.05)
      });
      yPos -= 12;
    }
    if (offSiteItems.length > listed.length) {
      page.drawText(pdfText(`- a dalsich ${offSiteItems.length - listed.length} (viz oznaceni u polozek)`), {
        x: 58, y: yPos, size: 9, font: bold, color: rgb(0.5, 0.05, 0.05)
      });
      yPos -= 12;
    }
    yPos -= 16;
  }

  // Section Header: Items to Pack
  if (yPos < 60) {
    page = pdfDoc.addPage();
    ({ width, height } = page.getSize());
    yPos = height - 50;
  }
  page.drawText(pdfText("Polozky k zabaleni"), { x: 50, y: yPos, size: 14, font: bold });
  yPos -= 20;

  // Table Header
  const colMargin = 50;
  const colCheck = 50;
  const colName = 70;
  const colQty = 420;

  // Group snapshot groups by Role (Sklad/Kitchen)
  const sections = [
    { title: "Event Manager", groups: snapshot.groups.filter(g => g.parentCategory.toLowerCase() !== "kuchyn" && g.parentCategory.toLowerCase() !== "kuchyň") },
    { title: "Kuchyn", groups: snapshot.groups.filter(g => g.parentCategory.toLowerCase() === "kuchyn" || g.parentCategory.toLowerCase() === "kuchyň") }
  ];

  for (const s of sections) {
    if (s.groups.length === 0) continue;

    if (yPos < 60) {
      page = pdfDoc.addPage();
      ({ width, height } = page.getSize());
      yPos = height - 50;
    }

    // Role Section Header
    yPos -= 10;
    page.drawText(pdfText(s.title), { x: colMargin, y: yPos, size: 12, font: bold });
    yPos -= 4;
    page.drawLine({ start: { x: colMargin, y: yPos }, end: { x: width - 50, y: yPos }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
    yPos -= 14;

    for (const group of s.groups) {
      if (yPos < 60) {
        page = pdfDoc.addPage();
        yPos = height - 50;
      }

      // Group Header (Category)
      const groupLabel = group.category ? `${group.parentCategory} / ${group.category}` : group.parentCategory;
      page.drawText(pdfText(groupLabel), { x: colMargin, y: yPos, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) });
      yPos -= 14;

      for (const item of group.items) {
        if (yPos < 60) {
          page = pdfDoc.addPage();
          ({ width, height } = page.getSize());
          yPos = height - 50;
        }

        // Checkbox (moved to the left)
        page.drawRectangle({ x: colCheck, y: yPos - 2, width: 12, height: 12, borderColor: rgb(0, 0, 0), borderWidth: 1 });

        // Item Name
        page.drawText(pdfText(item.name), { x: colName, y: yPos, size: 10, font });

        // U domaciho skladu se nic netiskne - opakovane "Liboc" u kazdeho radku
        // by upozorneni jen rozmelnilo.
        if (item.warehouseName !== undefined && item.warehouseIsHome !== true) {
          const tag = `! ${item.warehouseName ?? "bez skladu"}`;
          const nameWidth = font.widthOfTextAtSize(pdfText(item.name), 10);
          page.drawText(pdfText(tag), {
            x: Math.min(colName + nameWidth + 8, colQty - 100),
            y: yPos,
            size: 9,
            font: bold,
            color: rgb(0.7, 0.1, 0.1)
          });
        }

        // Quantity + master package info
        let qtyLabel = `${item.qty} ${item.unit}`;
        if (item.masterPackageQty && item.masterPackageQty > 0) {
          const masterPkgs = Math.ceil(item.qty / item.masterPackageQty);
          qtyLabel += ` (${masterPkgs} bal.)`;
        }
        page.drawText(pdfText(qtyLabel), { x: colQty, y: yPos, size: 10, font });

        yPos -= 16;
      }
      yPos -= 4;
    }
    yPos -= 10;
  }

  return pdfDoc.save();
}

export async function buildClosureReportPdf(event: any) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();

  // Title: Final Report
  page.drawText(pdfText(`Zaverecny report: ${event.name}`), { x: 50, y: height - 50, size: 20, font: bold });

  const managerLabel = event.createdBy?.name?.trim() || event.createdBy?.email?.trim();
  if (managerLabel) {
    page.drawText(pdfText(`Event Manager: ${managerLabel}`), { x: 400, y: height - 50, size: 10, font });
  }

  let yPos = height - 80;
  // Date and Location
  page.drawText(pdfText(`Misto: ${event.location}`), { x: 50, y: yPos, size: 12, font });
  yPos -= 18;
  if (event.eventDate) {
    page.drawText(pdfText(`Datum: ${formatCzechDate(event.eventDate.toISOString())}`), { x: 50, y: yPos, size: 12, font });
    yPos -= 18;
  }
  yPos -= 20;

  // Header
  page.drawText(pdfText("Prehled polozek a strat"), { x: 50, y: yPos, size: 14, font: bold });
  yPos -= 20;

  // Table Header
  const colName = 50;
  const colRes = 300;
  const colRet = 360;
  const colBro = 400;
  const colMis = 450;
  const colCon = 500;

  page.drawText(pdfText("Polozka"), { x: colName, y: yPos, size: 10, font: bold });
  page.drawText(pdfText("Rez."), { x: colRes, y: yPos, size: 10, font: bold });
  page.drawText(pdfText("Vrac."), { x: colRet, y: yPos, size: 10, font: bold });
  page.drawText(pdfText("Rozb."), { x: colBro, y: yPos, size: 10, font: bold });
  page.drawText(pdfText("Chybi"), { x: colMis, y: yPos, size: 10, font: bold });
  page.drawText(pdfText("Spotr."), { x: colCon, y: yPos, size: 10, font: bold });
  yPos -= 4;
  page.drawLine({ start: { x: 50, y: yPos }, end: { x: width - 50, y: yPos }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  yPos -= 14;

  const reservations = event.reservations ?? [];
  const returns = event.returns ?? [];
  const issues = event.issues ?? [];

  const sections = [
    { title: "Event Manager", items: reservations.filter((r: any) => (r.item?.category?.parent?.name || "").toLowerCase() !== "kuchyň") },
    { title: "Kuchyn", items: reservations.filter((r: any) => (r.item?.category?.parent?.name || "").toLowerCase() === "kuchyň") }
  ];

  for (const s of sections) {
    if (s.items.length === 0) continue;

    if (yPos < 80) {
      page = pdfDoc.addPage();
      yPos = height - 50;
    }

    yPos -= 10;
    page.drawText(pdfText(s.title), { x: colName, y: yPos, size: 12, font: bold });
    yPos -= 4;
    page.drawLine({ start: { x: 50, y: yPos }, end: { x: width - 50, y: yPos }, thickness: 1, color: rgb(0.2, 0.2, 0.2) });
    yPos -= 14;

    for (const res of s.items) {
      if (yPos < 60) {
        page = pdfDoc.addPage();
        yPos = height - 50;
      }

      const itemReturns = returns.filter((r: any) => r.inventoryItemId === res.inventoryItemId);
      const itemIssues = issues.filter((i: any) => i.inventoryItemId === res.inventoryItemId);

      const returnedQty = itemReturns.reduce((sum: number, r: any) => sum + r.returnedQuantity, 0);
      const brokenQty = itemIssues.filter((i: any) => i.type === "broken").reduce((sum: number, i: any) => sum + (i.issuedQuantity || 0), 0);
      const missingQty = itemIssues.filter((i: any) => i.type === "missing").reduce((sum: number, i: any) => sum + (i.issuedQuantity || 0), 0);
      // Spotreba u zbozi neni ztrata, tak se nezvyrazni cervene.
      const consumedQty = itemIssues.filter((i: any) => i.type === "consumed").reduce((sum: number, i: any) => sum + (i.issuedQuantity || 0), 0);

      const isLoss = brokenQty > 0 || missingQty > 0;
      const itemFont = isLoss ? bold : font;
      const textColor = isLoss ? rgb(0.7, 0, 0) : rgb(0, 0, 0);

      page.drawText(pdfText(res.item?.name ?? "Unknown"), { x: colName, y: yPos, size: 9, font: itemFont, color: textColor });
      page.drawText(pdfText(res.reservedQuantity), { x: colRes, y: yPos, size: 9, font });
      page.drawText(pdfText(returnedQty), { x: colRet, y: yPos, size: 9, font });
      page.drawText(pdfText(brokenQty), { x: colBro, y: yPos, size: 9, font, color: brokenQty > 0 ? textColor : rgb(0, 0, 0) });
      page.drawText(pdfText(missingQty), { x: colMis, y: yPos, size: 9, font, color: missingQty > 0 ? textColor : rgb(0, 0, 0) });
      page.drawText(pdfText(consumedQty), { x: colCon, y: yPos, size: 9, font });

      yPos -= 14;
    }
    yPos -= 10;
  }

  yPos -= 20;
  if (yPos < 60) {
    page = pdfDoc.addPage();
    yPos = height - 50;
  }
  page.drawText(pdfText("Tento report slouzi pro vyuctovani akce."), { x: 50, y: yPos, size: 10, font });

  return pdfDoc.save();
}

export async function buildItemLabelPdf(item: { id: string; name: string; sku: string | null }) {
  const { default: QRCode } = await import("qrcode");
  const pdfDoc = await PDFDocument.create();
  
  // 50mm x 30mm at 72dpi: 141.7 x 85 points
  const width = 141.7;
  const height = 85.0;
  const page = pdfDoc.addPage([width, height]);
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  // QR Code must stay stable forever, so labels always encode the immutable item ID.
  const qrData = item.id;
  const qrBuffer = await QRCode.toBuffer(qrData, {
    margin: 1,
    width: 60, // size in pixels
  });
  const qrImage = await pdfDoc.embedPng(qrBuffer);
  
  // Draw QR
  page.drawImage(qrImage, {
    x: width - 65,
    y: (height - 60) / 2,
    width: 60,
    height: 60
  });

  // Text Info
  const textX = 10;
  const maxWidth = width - 75;

  // Name (wrapped)
  const nameLines = wrapText(item.name, bold, 8, maxWidth);
  let yPos = height - 15;
  for (let i = 0; i < Math.min(nameLines.length, 3); i++) {
    page.drawText(pdfText(nameLines[i]), {
      x: textX,
      y: yPos,
      size: 8,
      font: bold
    });
    yPos -= 10;
  }

  // SKU
  if (item.sku) {
    page.drawText(pdfText(`SKU: ${item.sku}`), {
      x: textX,
      y: 15,
      size: 7,
      font
    });
  }

  return pdfDoc.save();
}
