-- CreateTable
CREATE TABLE "public"."ClimateReading" (
    "id" SERIAL NOT NULL,
    "city" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClimateReading_pkey" PRIMARY KEY ("id")
);
