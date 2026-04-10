import { LedgerReason, Prisma } from "../../generated/prisma/client.js";

type LedgerWriteClient = Pick<Prisma.TransactionClient, "inventoryLedger">;

const LEGACY_REASON_FALLBACK: Partial<Record<LedgerReason, LedgerReason>> = {
  issue: LedgerReason.manual,
  return: LedgerReason.manual,
  transfer: LedgerReason.manual
};

function isInvalidLedgerReasonError(error: unknown, reason: LedgerReason) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2007") return false;
  const meta = error.meta as { driverAdapterError?: { cause?: { message?: string; originalMessage?: string } } } | undefined;
  const raw = [
    meta?.driverAdapterError?.cause?.message,
    meta?.driverAdapterError?.cause?.originalMessage,
    error.message
  ]
    .filter(Boolean)
    .join(" ");
  return raw.includes('enum "LedgerReason"') && raw.includes(`"${reason}"`);
}

function withReasonMarker(reason: LedgerReason, note?: string | null) {
  const marker = `[ledger:${reason}]`;
  if (!note) return marker;
  if (note.startsWith(marker)) return note;
  return `${marker} ${note}`;
}

export async function createInventoryLedgerEntry(
  client: LedgerWriteClient,
  data: Prisma.InventoryLedgerUncheckedCreateInput
) {
  try {
    return await client.inventoryLedger.create({ data });
  } catch (error) {
    const fallbackReason = LEGACY_REASON_FALLBACK[data.reason];
    if (!fallbackReason || !isInvalidLedgerReasonError(error, data.reason)) {
      throw error;
    }

    return client.inventoryLedger.create({
      data: {
        ...data,
        reason: fallbackReason,
        note: withReasonMarker(data.reason, data.note)
      }
    });
  }
}
