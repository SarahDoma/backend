-- Track intent between build-transaction and confirm calls
CREATE TABLE "PendingTx" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingTx_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PendingTx_expiresAt_idx" ON "PendingTx"("expiresAt");

CREATE INDEX "PendingTx_userId_idx" ON "PendingTx"("userId");

ALTER TABLE "PendingTx" ADD CONSTRAINT "PendingTx_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
