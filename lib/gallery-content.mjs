// This format is produced by render-markdown; other HTML remains untouched.
export function galleryParts(html) {
  const parts = [];
  const pattern =
    /<div class="media-gallery" data-gallery="([^"]+)"[^>]*>[\s\S]*?<\/div>/g;
  let offset = 0;
  for (const match of html.matchAll(pattern)) {
    if (match.index > offset)
      parts.push({ html: html.slice(offset, match.index) });
    const data = match[1]
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
    parts.push({ images: JSON.parse(data) });
    offset = match.index + match[0].length;
  }
  if (offset < html.length) parts.push({ html: html.slice(offset) });
  return parts;
}
