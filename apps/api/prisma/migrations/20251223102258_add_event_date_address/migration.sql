-- AlterTable
ALTER TABLE "events" ADD COLUMN     "address" TEXT,
ADD COLUMN     "event_date" TIMESTAMPTZ(6);
