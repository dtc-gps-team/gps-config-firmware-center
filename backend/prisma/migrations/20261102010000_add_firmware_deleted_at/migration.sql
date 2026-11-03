-- Soft delete ของ Firmware (DELETE /firmware/{id}) - additive, nullable
ALTER TABLE "Firmware" ADD COLUMN "deletedAt" TIMESTAMP(3);
