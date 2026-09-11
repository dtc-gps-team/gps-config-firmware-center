import { CampaignDetailView } from "../campaign-detail-view";

export const metadata = {
  title: "รายละเอียดแคมเปญ | GPS Config Center",
};

/** รายละเอียดแคมเปญ 1 รายการ */
export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CampaignDetailView campaignId={id} />;
}
