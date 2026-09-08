import {
  DEFAULT_SEARCH_WEIGHTS,
  SEARCH_LIMITS,
  searchStoriesDetailed,
} from './search.mjs';

export const searchToolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: {
      type: 'string',
      maxLength: SEARCH_LIMITS.length,
      description:
        'AND/OR/NOT, parentheses, quoted phrases, title:/body:/tag:/entity:/source:/briefing:, date:YYYY-MM-DD, before:/after: (exclusive), and trailing English prefix*.',
    },
    tag: { type: 'string' },
    entity: { type: 'string' },
    from: {
      type: 'string',
      description: 'Inclusive briefing date, YYYY-MM-DD.',
    },
    to: { type: 'string', description: 'Inclusive briefing date, YYYY-MM-DD.' },
    sort: { type: 'string', enum: ['relevance', 'newest', 'oldest'] },
    match: { type: 'string', enum: ['all', 'any'] },
    scope: {
      type: 'string',
      enum: ['all', ...Object.keys(DEFAULT_SEARCH_WEIGHTS)],
    },
    weights: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.keys(DEFAULT_SEARCH_WEIGHTS).map((field) => [
          field,
          { type: 'number', minimum: 0, maximum: 20 },
        ]),
      ),
    },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    offset: { type: 'integer', minimum: 0, maximum: 100000, default: 0 },
  },
};

export function executeSearchTool(index, input, link) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Expected a search filter object.');
  for (const key of Object.keys(input))
    if (!Object.hasOwn(searchToolSchema.properties, key))
      throw new Error('Unknown search filter.');
  const { limit = 20, offset = 0, ...filters } = input;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100000
  )
    throw new Error('Invalid search pagination.');
  const { results, errors } = searchStoriesDetailed(index, filters);
  if (errors.length)
    throw new Error(errors.map((error) => error.message).join(' '));
  return {
    total: results.length,
    offset,
    hasMore: offset + limit < results.length,
    results: results
      .slice(offset, offset + limit)
      .map(({ story, score, matchedFields }) => ({
        id: story.id,
        title: story.title,
        date: story.briefingDate,
        url: link(story.briefingDate, story.id),
        score,
        matchedFields,
      })),
  };
}
