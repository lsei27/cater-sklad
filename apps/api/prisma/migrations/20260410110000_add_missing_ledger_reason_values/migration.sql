ALTER TYPE "LedgerReason" ADD VALUE IF NOT EXISTS 'transfer';
ALTER TYPE "LedgerReason" ADD VALUE IF NOT EXISTS 'issue';
ALTER TYPE "LedgerReason" ADD VALUE IF NOT EXISTS 'return';
