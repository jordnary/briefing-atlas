// Share URL rules between import validation and HTML rendering.
export function isWebUrl(value) {
  if (
    typeof value !== 'string' ||
    Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char === '\\')
  )
    return false;
  try {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function isImagePath(value) {
  return (
    typeof value === 'string' &&
    /^\/?images\/[a-z0-9/_-]+(?:\.[a-z0-9_-]+)*\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(
      value,
    ) &&
    !value.includes('..') &&
    !value.includes('//')
  );
}

export function isImageUrl(value) {
  return (
    isImagePath(value) || (isWebUrl(value) && value.startsWith('https://'))
  );
}

export function imageHref(value, basePath = '') {
  return isImagePath(value) ? `${basePath}/${value.replace(/^\//, '')}` : value;
}
