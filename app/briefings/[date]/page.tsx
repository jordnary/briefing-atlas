import { notFound } from 'next/navigation';
import Atlas from '@/components/atlas';
import { briefings, briefingMeta } from '@/lib/content';
export const dynamicParams = false;
export function generateStaticParams() {
  return briefings.map((item) => ({ date: item.briefingDate }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const item = briefings.find((item) => item.briefingDate === date);
  return {
    title: item
      ? `${date} · ${item.title} · Briefing Atlas`
      : '简报未找到 · Briefing Atlas',
    description: item?.summary,
  };
}
export default async function BriefingPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const item = briefings.find((item) => item.briefingDate === date);
  if (!item) notFound();
  return <Atlas view="issue" meta={briefingMeta} briefing={item} />;
}
