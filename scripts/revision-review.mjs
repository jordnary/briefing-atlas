import { randomBytes } from 'node:crypto';
import { hash } from './archive-convert.mjs';

const TTL = 7 * 24 * 60 * 60 * 1000;
const canonical = (value) =>
  JSON.stringify(value, function (_key, item) {
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item;
  });

// The review envelope is excluded to avoid a circular digest. Pending checks,
// publication state and every source receipt remain part of this version.
export function checkpointVersion(state) {
  const { review: _review, pending: _pending, ...checkpoint } = state;
  return hash(canonical(checkpoint));
}

export function reviewBinding(input, state, options) {
  return {
    sourceCommit: options.sourceCommit ?? null,
    exportSha256: options.exportSha256 ?? hash(canonical(input)),
    inputHash: hash(canonical(input)),
    checkpointVersion: checkpointVersion(state),
    converterVersion: options.converterVersion,
  };
}

export function createReview(binding, now) {
  const createdAt = new Date(now).toISOString();
  return {
    ...binding,
    id: randomBytes(32).toString('hex'),
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + TTL).toISOString(),
  };
}

export function validateReview(review, reviewId, binding, now) {
  if (!review) throw new Error('REVIEW_NOT_FOUND');
  if (!/^[a-f0-9]{64}$/.test(reviewId ?? '') || review.id !== reviewId)
    throw new Error('REVIEW_ID_MISMATCH');
  if (
    !Number.isFinite(Date.parse(review.expiresAt)) ||
    Date.parse(now) >= Date.parse(review.expiresAt)
  )
    throw new Error('REVIEW_EXPIRED');
  for (const [field, code] of [
    ['sourceCommit', 'SOURCE_COMMIT'],
    ['exportSha256', 'EXPORT'],
    ['inputHash', 'INPUT'],
    ['checkpointVersion', 'CHECKPOINT'],
    ['converterVersion', 'CONVERTER'],
  ]) {
    if (review[field] !== binding[field])
      throw new Error(`REVIEW_${code}_MISMATCH`);
  }
}
