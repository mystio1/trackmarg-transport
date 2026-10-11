-- CreateEnum
CREATE TYPE "DeductionKind" AS ENUM ('FINE', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "baseSalary" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DriverDeduction" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "kind" "DeductionKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DriverDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverAdvance" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DriverAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverDeduction_groupId_idx" ON "DriverDeduction"("groupId");

-- CreateIndex
CREATE INDEX "DriverDeduction_driverId_deleted_date_idx" ON "DriverDeduction"("driverId", "deleted", "date");

-- CreateIndex
CREATE INDEX "DriverAdvance_groupId_idx" ON "DriverAdvance"("groupId");

-- CreateIndex
CREATE INDEX "DriverAdvance_driverId_deleted_date_idx" ON "DriverAdvance"("driverId", "deleted", "date");

-- AddForeignKey
ALTER TABLE "DriverDeduction" ADD CONSTRAINT "DriverDeduction_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverDeduction" ADD CONSTRAINT "DriverDeduction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAdvance" ADD CONSTRAINT "DriverAdvance_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAdvance" ADD CONSTRAINT "DriverAdvance_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
