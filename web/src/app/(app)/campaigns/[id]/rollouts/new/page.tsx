import { CampaignRolloutCreateView } from "../../../campaign-rollout-create-view";

export const metadata = {
  title: "เริ่ม Rollout ใหม่ | GPS Config Center",
};

/** เริ่ม Rollout ใหม่ให้กลุ่มอุปกรณ์หนึ่งกลุ่ม (Campaign Monitor #22) */
export default async function CampaignRolloutNewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CampaignRolloutCreateView campaignId={id} />;
}
