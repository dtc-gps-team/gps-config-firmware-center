import { CampaignRolloutDetailView } from "../../../campaign-rollout-detail-view";

export const metadata = {
  title: "รายละเอียด Rollout | GPS Config Center",
};

/** รายละเอียด Rollout 1 รอบ — ผล success/failure ต่อเครื่องจริง (Campaign
 * Monitor #22) */
export default async function CampaignRolloutDetailPage({
  params,
}: {
  params: Promise<{ id: string; rolloutId: string }>;
}) {
  const { id, rolloutId } = await params;
  return <CampaignRolloutDetailView campaignId={id} rolloutId={rolloutId} />;
}
