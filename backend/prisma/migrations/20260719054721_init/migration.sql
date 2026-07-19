-- CreateEnum
CREATE TYPE "SearchStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "SearchRequest" (
    "id" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "propertyAddress" TEXT,
    "status" "SearchStatus" NOT NULL DEFAULT 'PENDING',
    "resultJson" JSONB,
    "warningsJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchRequest_ownerName_idx" ON "SearchRequest"("ownerName");

-- CreateIndex
CREATE INDEX "SearchRequest_status_idx" ON "SearchRequest"("status");
