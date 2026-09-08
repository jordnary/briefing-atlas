import { DEFAULT_SEARCH_WEIGHTS } from './search.mjs';

export function defaultSearchState() {
  return {
    q: '',
    tag: '',
    entity: '',
    from: '',
    to: '',
    read: 'all',
    sort: 'relevance',
    match: 'all',
    scope: 'all',
    weights: { ...DEFAULT_SEARCH_WEIGHTS },
  };
}

export function readSearchState(query) {
  const params = new URLSearchParams(query);
  const state = defaultSearchState();
  for (const key of ['q', 'tag', 'entity', 'from', 'to'])
    state[key] = params.get(key) || '';
  for (const [key, options] of Object.entries({
    read: ['all', 'read', 'unread'],
    sort: ['relevance', 'newest', 'oldest'],
    match: ['all', 'any'],
    scope: ['all', ...Object.keys(DEFAULT_SEARCH_WEIGHTS)],
  }))
    if (options.includes(params.get(key))) state[key] = params.get(key);
  for (const field of Object.keys(state.weights)) {
    const value = params.get(`w_${field}`);
    if (
      value !== null &&
      value.trim() !== '' &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0 &&
      Number(value) <= 20
    )
      state.weights[field] = Number(value);
  }
  return state;
}

export function writeSearchState(state) {
  const defaults = defaultSearchState();
  const params = new URLSearchParams();
  for (const key of [
    'q',
    'tag',
    'entity',
    'from',
    'to',
    'read',
    'sort',
    'match',
    'scope',
  ])
    if (state[key] && state[key] !== defaults[key]) params.set(key, state[key]);
  for (const field of Object.keys(defaults.weights))
    if (state.weights[field] !== defaults.weights[field])
      params.set(`w_${field}`, String(state.weights[field]));
  return params.toString();
}
