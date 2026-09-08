export function readingRange(bodyTop, bodyHeight, viewportHeight, inset = 110) {
  const start = Math.max(0, bodyTop - inset);
  const end = Math.max(start + 1, bodyTop + bodyHeight - viewportHeight + 40);
  return { start, end };
}

export function readingProgress(scrollY, range) {
  return Math.round(
    Math.min(
      100,
      Math.max(0, ((scrollY - range.start) / (range.end - range.start)) * 100),
    ),
  );
}

export function readingOffset(progress, range) {
  return (
    range.start +
    (Math.min(100, Math.max(0, progress)) / 100) * (range.end - range.start)
  );
}
