export type SearchField =
  | 'title'
  | 'summary'
  | 'body'
  | 'tags'
  | 'entities'
  | 'source'
  | 'briefing';
export type SearchWeights = Record<SearchField, number>;
export type SearchFilters = {
  q?: string;
  tag?: string;
  entity?: string;
  from?: string;
  to?: string;
  sort?: 'relevance' | 'newest' | 'oldest';
  match?: 'all' | 'any';
  scope?: 'all' | SearchField;
  weights?: Partial<SearchWeights>;
};
export type SearchStory = {
  id: string;
  title: string;
  briefingDate: string;
  summary?: string;
  body?: string;
  tags?: string[];
  entities?: string[];
  sources?: { title: string }[];
  briefingTitle?: string;
  briefingIntro?: string;
  briefingOutro?: string;
};
export type SearchTerm = {
  type: 'term';
  id: number;
  field: SearchField | 'date' | 'before' | 'after' | null;
  value: string;
  phrase: boolean;
  prefix: boolean;
};
export type SearchNode =
  | SearchTerm
  | { type: 'not'; child: SearchNode }
  | { type: 'and' | 'or'; left: SearchNode; right: SearchNode };
export type SearchError = { message: string; position: number };
export type SearchResult<T extends SearchStory = SearchStory> = {
  story: T;
  score: number;
  matchedFields: SearchField[];
  terms: SearchTerm[];
};
export type SearchIndex<T extends SearchStory = SearchStory> = {
  documents: {
    story: T;
    order: number;
    values: Record<SearchField, string[]>;
    lengths: Record<SearchField, number>;
  }[];
  averages: Record<SearchField, number>;
};
export type HighlightRange = [number, number];
export type SearchPresentation = {
  title: HighlightRange[];
  summary: HighlightRange[];
  snippet: {
    field: SearchField;
    text: string;
    ranges: HighlightRange[];
  } | null;
};
export const DEFAULT_SEARCH_WEIGHTS: Readonly<SearchWeights>;
export const SEARCH_FIELD_LABELS: Readonly<Record<SearchField, string>>;
export const SEARCH_LIMITS: Readonly<{
  length: number;
  terms: number;
  depth: number;
}>;
export function parseSearchQuery(
  input?: string,
  options?: Pick<SearchFilters, 'match'>,
): { ast: SearchNode | null; errors: SearchError[] };
export function createSearchIndex<T extends SearchStory>(
  records: T[],
): SearchIndex<T>;
export function isSearchIndexPayload(value: unknown): boolean;
export function searchStoriesDetailed<T extends SearchStory>(
  records: T[] | SearchIndex<T>,
  filters?: SearchFilters,
): { results: SearchResult<T>[]; errors: SearchError[] };
export function searchStories<T extends SearchStory>(
  records: T[] | SearchIndex<T>,
  filters?: SearchFilters,
): T[];
export function searchHighlightRanges(
  value: string,
  terms: SearchTerm[],
  field: SearchField,
): HighlightRange[];
export function searchPresentation(result: SearchResult): SearchPresentation;
