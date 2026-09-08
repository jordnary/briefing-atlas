import data from '@/generated/briefings.json';
export type Source = {
  title: string;
  url: string;
  type: 'paper' | 'official' | 'report';
  publishedAt?: string | null;
};
export type Story = {
  id: string;
  title: string;
  summary: string;
  body: string;
  html: string;
  eventDate: string | null;
  tags: string[];
  entities: string[];
  sources: Source[];
  verificationStatus: 'verified' | 'pending' | 'correction';
  verificationNote: string;
  relatedEventId?: string;
  image?: {
    path: string;
    alt: string;
    caption: string;
    source: string;
    available: boolean;
  };
};
export type Briefing = {
  id: string;
  briefingDate: string;
  title: string;
  summary: string;
  publishedAt: string;
  updatedAt: string;
  status: 'published';
  sample: boolean;
  stories: Story[];
};
export type IndexStory = Story & {
  briefingDate: string;
  briefingTitle: string;
  sample: boolean;
};
export type BriefingMeta = Omit<Briefing, 'stories'> & {
  count: number;
  tags: string[];
};
export const briefings = data as Briefing[];
export const briefingMeta: BriefingMeta[] = briefings.map(
  ({ stories, ...item }) => ({
    ...item,
    count: stories.length,
    tags: [...new Set(stories.flatMap((story) => story.tags))],
  }),
);
export const entities = [
  ...new Set(
    briefings.flatMap((item) =>
      item.stories.flatMap((story) => story.entities),
    ),
  ),
].sort();
