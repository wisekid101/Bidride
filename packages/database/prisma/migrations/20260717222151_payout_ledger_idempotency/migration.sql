-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "correlation_id" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "financial_ledger_correlation_id_account_id_direction_key" ON "financial_ledger"("correlation_id", "account_id", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_correlation_id_key" ON "wallet_transactions"("correlation_id");
