import type { PrismaClient } from "../../generated/prisma/client.js";
import { diffSnapshots, type SnapshotItemChange } from "../lib/snapshotDiff.js";
import type { ExportSnapshot } from "../pdf/exportPdf.js";

/// Verze, se kterou se porovnává: potvrzená skladem, jinak první předání.
export function ackBaseVersion(warehouseAckVersion: number | null) {
  return warehouseAckVersion ?? 1;
}

export function hasUnseenChanges(ev: { status: string; warehouseAckVersion: number | null; latestExportVersion: number | null }) {
  return (
    ev.status === "SENT_TO_WAREHOUSE" &&
    ev.latestExportVersion !== null &&
    ev.latestExportVersion > ackBaseVersion(ev.warehouseAckVersion)
  );
}

export async function loadSnapshot(prisma: PrismaClient, eventId: string, version: number) {
  const row = await prisma.eventExport.findFirst({ where: { eventId, version }, select: { snapshotJson: true } });
  return row ? (JSON.parse(JSON.stringify(row.snapshotJson)) as ExportSnapshot) : null;
}

/// Změny v balení, které sklad ještě nepotvrdil. Null = není co ukazovat.
export async function getUnseenChanges(
  prisma: PrismaClient,
  eventId: string
): Promise<{ baseVersion: number; latestVersion: number; changes: SnapshotItemChange[] } | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      status: true,
      warehouseAckVersion: true,
      exports: { orderBy: { version: "desc" }, take: 1, select: { version: true, snapshotJson: true } }
    }
  });
  const latest = event?.exports[0];
  if (!event || !latest) return null;
  if (!hasUnseenChanges({ status: event.status, warehouseAckVersion: event.warehouseAckVersion, latestExportVersion: latest.version })) {
    return null;
  }

  const baseVersion = ackBaseVersion(event.warehouseAckVersion);
  const base = await loadSnapshot(prisma, eventId, baseVersion);
  if (!base) return null;
  const next = JSON.parse(JSON.stringify(latest.snapshotJson)) as ExportSnapshot;
  return { baseVersion, latestVersion: latest.version, changes: diffSnapshots(base, next) };
}

/// Potvrzuje se verze, kterou skladník viděl, ne „poslední“: kdyby mezitím
/// vznikla další, nesmí se tiše odkliknout. Zpět se nikdy nejde.
export async function ackChanges(prisma: PrismaClient, eventId: string, version: number) {
  await prisma.event.updateMany({
    where: { id: eventId, OR: [{ warehouseAckVersion: null }, { warehouseAckVersion: { lt: version } }] },
    data: { warehouseAckVersion: version }
  });
}
