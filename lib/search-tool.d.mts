import type { SearchIndex, SearchStory } from './search.mjs';
export const searchToolSchema: object;
export function executeSearchTool<T extends SearchStory>(
  index: SearchIndex<T>,
  input: unknown,
  link: (date: string, id: string) => string,
): {
  total: number;
  offset: number;
  hasMore: boolean;
  results: {
    id: string;
    title: string;
    date: string;
    url: string;
    score: number;
    matchedFields: string[];
  }[];
};
