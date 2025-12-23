-- AlterTable
ALTER TABLE "event_issues" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'issued';
