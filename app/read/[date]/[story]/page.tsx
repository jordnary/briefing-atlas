import { notFound } from 'next/navigation';
import { briefings } from '@/lib/content';
import { Reader } from '@/components/reader';

export const dynamicParams = false;

export function generateStaticParams() {
  return briefings.flatMap((briefing) =>
    briefing.stories.map((story) => ({
      date: briefing.briefingDate,
      story: story.id,
    })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string; story: string }>;
}) {
  const { date, story: storyId } = await params;
  const briefing = briefings.find((item) => item.briefingDate === date);
  const story = briefing?.stories.find((item) => item.id === storyId);
  return {
    title: story
      ? `${story.title} · 阅读模式 · Briefing Atlas`
      : '文章未找到 · Briefing Atlas',
    description: story?.summary,
  };
}

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ date: string; story: string }>;
}) {
  const { date, story: storyId } = await params;
  const briefing = briefings.find((item) => item.briefingDate === date);
  const index =
    briefing?.stories.findIndex((item) => item.id === storyId) ?? -1;
  const story = index >= 0 ? briefing?.stories[index] : undefined;
  if (!briefing || !story) notFound();
  return (
    <Reader
      briefing={{
        briefingDate: briefing.briefingDate,
        outro: briefing.outro ? '结语' : '',
        stories: briefing.stories.map(({ id, title }) => ({ id, title })),
      }}
      story={story}
      index={index}
    />
  );
}
