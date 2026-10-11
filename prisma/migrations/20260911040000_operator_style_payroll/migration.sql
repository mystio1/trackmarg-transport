-- AlterTable: driver joining date (salary accrual start), admin-editable alongside baseSalary
ALTER TABLE "User" ADD COLUMN     "joiningDate" TIMESTAMP(3);

-- AlterTable: mark which categories are the seeded starter set vs admin-added custom ones
ALTER TABLE "DriverTransactionCategory" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: switch DriverTransaction from a free-text category to a real FK, add the
-- businessEffect classification, drop the soft-delete pair (this feature is hard-delete only,
-- matching the reference payroll implementation it was ported from).
ALTER TABLE "DriverTransaction" ADD COLUMN     "categoryId" TEXT;
ALTER TABLE "DriverTransaction" ADD COLUMN     "businessEffect" TEXT NOT NULL DEFAULT 'ADVANCE_RECOVERABLE';

-- Data migration: link every existing row to the category row matching its old free-text name
-- within the same group (both already exist for every row created so far — the earlier
-- create-transaction logic always upserted a category row by name).
UPDATE "DriverTransaction" dt
SET "categoryId" = dtc.id
FROM "DriverTransactionCategory" dtc
WHERE dtc."groupId" = dt."groupId" AND dtc.name = dt.category AND dt."categoryId" IS NULL;

-- Hard-delete anything that was only soft-deleted before — the concept no longer exists.
DELETE FROM "DriverTransaction" WHERE "deleted" = true;

-- DropIndex
DROP INDEX "DriverTransaction_driverId_deleted_date_idx";

-- AlterTable: drop the now-migrated free-text category column and the soft-delete pair
ALTER TABLE "DriverTransaction" DROP COLUMN     "category";
ALTER TABLE "DriverTransaction" DROP COLUMN     "deleted";
ALTER TABLE "DriverTransaction" DROP COLUMN     "deletedAt";

-- CreateIndex
CREATE INDEX "DriverTransaction_driverId_date_idx" ON "DriverTransaction"("driverId", "date");

-- CreateIndex
CREATE INDEX "DriverTransaction_categoryId_idx" ON "DriverTransaction"("categoryId");

-- AddForeignKey
ALTER TABLE "DriverTransaction" ADD CONSTRAINT "DriverTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DriverTransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
