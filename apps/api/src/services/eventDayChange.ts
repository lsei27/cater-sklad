import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Po změně termínu přizpůsobí řádky rezervací nové délce akce.
 *
 * Řádek končící na novém posledním dni nebo za ním se zkrátí na „do konce
 * akce“ a sečte se s případným řádkem stejného rozsahu. Řádek, který by
 * celý vypadl mimo akci, se nepřesouvá: EM ho musí vyřešit sám, jinak by
 * zboží tiše zmizelo z plánu nebo se přesunulo na jiný den.
 */
export async function fitReservationsToDayCountTx(
  tx: Prisma.TransactionClient,
  eventId: string,
  dayCount: number
): Promise<{ changed: boolean }> {
  const rows = await tx.eventReservation.findMany({
    where: { eventId },
    select: {
      id: true,
      inventoryItemId: true,
      dayFrom: true,
      dayTo: true,
      reservedQuantity: true,
      item: { select: { name: true } }
    }
  });

  const outside = rows.filter((r) => r.dayFrom > dayCount);
  if (outside.length > 0) {
    const err = new Error("DAYS_OUT_OF_RANGE") as Error & { itemNames?: string[] };
    err.itemNames = Array.from(new Set(outside.map((r) => r.item.name)));
    throw err;
  }

  const toTrim = rows.filter((r) => r.dayTo !== null && r.dayTo >= dayCount);
  for (const row of toTrim) {
    const target = rows.find(
      (r) => r.id !== row.id && r.inventoryItemId === row.inventoryItemId && r.dayFrom === row.dayFrom && r.dayTo === null
    );
    if (target) {
      await tx.eventReservation.update({
        where: { id: target.id },
        data: { reservedQuantity: target.reservedQuantity + row.reservedQuantity }
      });
      target.reservedQuantity += row.reservedQuantity;
      await tx.eventReservation.delete({ where: { id: row.id } });
      row.reservedQuantity = 0;
    } else {
      await tx.eventReservation.update({ where: { id: row.id }, data: { dayTo: null } });
      row.dayTo = null;
    }
  }

  if (toTrim.length > 0) {
    // Stav balení se váže na klíč řádku. U změněných řádků ho skladník projde znovu.
    await tx.eventPacking.deleteMany({ where: { eventId, dayTo: { gte: dayCount } } });
  }

  return { changed: toTrim.length > 0 };
}
