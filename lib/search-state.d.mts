import type { SearchFilters, SearchWeights } from './search.mjs';
export type SearchState = Required<Omit<SearchFilters, 'weights'>> & {
  read: 'all' | 'read' | 'unread';
  weights: SearchWeights;
};
export function defaultSearchState(): SearchState;
export function readSearchState(query: string | URLSearchParams): SearchState;
export function writeSearchState(state: SearchState): string;
