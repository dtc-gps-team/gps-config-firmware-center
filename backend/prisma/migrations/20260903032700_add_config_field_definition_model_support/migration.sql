-- CreateTable
CREATE TABLE "ConfigFieldDefinitionModelSupport" (
    "id" TEXT NOT NULL,
    "fieldDefinitionId" TEXT NOT NULL,
    "deviceModel" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,

    CONSTRAINT "ConfigFieldDefinitionModelSupport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigFieldDefinitionModelSupport_fieldDefinitionId_deviceM_key" ON "ConfigFieldDefinitionModelSupport"("fieldDefinitionId", "deviceModel", "protocol");

-- AddForeignKey
ALTER TABLE "ConfigFieldDefinitionModelSupport" ADD CONSTRAINT "ConfigFieldDefinitionModelSupport_fieldDefinitionId_fkey" FOREIGN KEY ("fieldDefinitionId") REFERENCES "ConfigFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
