import { Prisma } from "@prisma/client";
import { type ExportSnapshot } from "../pdf/exportPdf.js";

export async function createExportTx(params: {
    tx: Prisma.TransactionClient;
    eventId: string;
    userId: string;
}) {
    const { tx, eventId, userId } = params;

    const [ev] = await tx.$queryRaw<
        { id: string; name: string; location: string; address: string | null; event_date: Date | null; delivery_datetime: Date; pickup_datetime: Date; status: string; manager_name: string }[]
    >`
    SELECT e.id, e.name, e.location, e.address, e.event_date, e.delivery_datetime, e.pickup_datetime, e.status::text, u.name as manager_name
    FROM events e
    JOIN users u ON u.id = e.created_by
    WHERE e.id = ${eventId}::uuid
    FOR UPDATE
  `;
    if (!ev) throw new Error("NOT_FOUND");
    if (ev.status === "ISSUED" || ev.status === "CLOSED" || ev.status === "CANCELLED") throw new Error("READ_ONLY");

    await tx.eventReservation.updateMany({
        where: { eventId: eventId },
        data: { state: "confirmed", expiresAt: null }
    });

    const [v] = await tx.$queryRaw<{ next_version: number }[]>`
    SELECT COALESCE(MAX(version),0) + 1 AS next_version
    FROM event_exports
    WHERE event_id = ${eventId}::uuid
  `;
    const version = Number(v?.next_version ?? 1);

    const reservations = await tx.eventReservation.findMany({
        where: { eventId: eventId, state: "confirmed", reservedQuantity: { gt: 0 } },
        include: { item: { include: { category: { include: { parent: true } } } } },
        orderBy: { inventoryItemId: "asc" }
    });
    if (reservations.length === 0) throw new Error("NO_ITEMS_TO_EXPORT");

    const groupsMap = new Map<string, ExportSnapshot["groups"][number]>();
    for (const r of reservations) {
        const child = r.item.category;
        const parentName = child.parent?.name ?? "Nezařazeno";
        const key = `${parentName}||${child.name}`;
        const group =
            groupsMap.get(key) ??
            (() => {
                const g = { parentCategory: parentName, category: child.name, items: [] as any[] };
                groupsMap.set(key, g);
                return g;
            })();
        group.items.push({
            inventoryItemId: r.inventoryItemId,
            name: r.item.name,
            unit: r.item.unit,
            qty: r.reservedQuantity,
            notes: r.item.notes
        });
    }

    const exportedAt = new Date();
    const snapshot: ExportSnapshot = {
        event: {
            id: ev.id,
            name: ev.name,
            location: ev.location,
            address: ev.address ?? null,
            eventDate: ev.event_date?.toISOString() ?? null,
            deliveryDatetime: ev.delivery_datetime.toISOString(),
            pickupDatetime: ev.pickup_datetime.toISOString(),
            version,
            exportedAt: exportedAt.toISOString(),
            managerName: ev.manager_name
        },
        groups: Array.from(groupsMap.values())
    };

    const exportRow = await tx.eventExport.create({
        data: {
            eventId: eventId,
            version,
            exportedAt,
            exportedById: userId,
            snapshotJson: snapshot as any
        }
    });

    await tx.event.update({
        where: { id: eventId },
        data: { status: "SENT_TO_WAREHOUSE", exportNeedsRevision: false }
    });

    await tx.auditLog.create({
        data: { actorUserId: userId, entityType: "event", entityId: eventId, action: "export_created", diffJson: { version } }
    });

    return { exportRow, snapshot };
}
