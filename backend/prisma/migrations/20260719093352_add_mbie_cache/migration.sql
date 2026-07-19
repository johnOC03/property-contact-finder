-- CreateTable
CREATE TABLE "MbieCache" (
    "id" TEXT NOT NULL,
    "requestSignature" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MbieCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MbieCache_requestSignature_key" ON "MbieCache"("requestSignature");

-- CreateIndex
CREATE INDEX "MbieCache_expiresAt_idx" ON "MbieCache"("expiresAt");
