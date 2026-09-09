export type SkippedIssueItem = { inventoryItemId: string; name: string };

/**
 * Rozdeli polozky k vydeji na ty, ktere v inventari jeste existuji, a na ty
 * smazane. Smazana polozka nema rezervaci ani stav skladu, takze ji nejde
 * vydat - ale nesmi kvuli ni spadnout cely vydej akce. Jmeno se bere ze
 * snapshotu exportu, protoze radek v inventory_items uz neexistuje.
 */
export function splitKnownIssueItems<T extends { inventory_item_id: string }>(
  candidates: T[],
  knownItemIds: Set<string>,
  nameByItemId: Map<string, string>
): { known: T[]; skipped: SkippedIssueItem[] } {
  const known: T[] = [];
  const skipped: SkippedIssueItem[] = [];
  for (const candidate of candidates) {
    if (knownItemIds.has(candidate.inventory_item_id)) {
      known.push(candidate);
    } else {
      skipped.push({
        inventoryItemId: candidate.inventory_item_id,
        name: nameByItemId.get(candidate.inventory_item_id) ?? candidate.inventory_item_id
      });
    }
  }
  return { known, skipped };
}
