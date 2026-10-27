-- CreateIndex
CREATE INDEX "Task_deviceId_idx" ON "Task"("deviceId");

-- CreateIndex
CREATE INDEX "Incident_deviceId_idx" ON "Incident"("deviceId");

-- CreateIndex
CREATE INDEX "CampaignRolloutTarget_deviceId_idx" ON "CampaignRolloutTarget"("deviceId");
