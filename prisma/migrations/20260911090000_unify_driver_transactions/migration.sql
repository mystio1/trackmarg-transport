-- DropTable
-- Replacing the two-table FINE/OTHER-deduction + advance split with one unified,
-- category-driven DriverTransaction ledger. No production data existed in either table yet.
DROP TABLE "DriverDeduction";

-- DropTable
DROP TABLE "DriverAdvance";

-- DropEnum
DROP TYPE "DeductionKind";

-- CreateTable
CREATE TABLE "DriverTransaction" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "deductFromSalary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DriverTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverTransactionCategory" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverTransactionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverTransaction_groupId_idx" ON "DriverTransaction"("groupId");

-- CreateIndex
CREATE INDEX "DriverTransaction_driverId_deleted_date_idx" ON "DriverTransaction"("driverId", "deleted", "date");

-- CreateIndex
CREATE INDEX "DriverTransactionCategory_groupId_idx" ON "DriverTransactionCategory"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverTransactionCategory_groupId_name_key" ON "DriverTransactionCategory"("groupId", "name");

-- AddForeignKey
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverTransactionCategory" ADD CONSTRAINT "DriverTransactionCategory_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
