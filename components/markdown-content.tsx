'use client';
import { memo, useEffect, useMemo, useRef } from 'react';
import { ImageGallery } from './image-gallery';
import { galleryParts } from '@/lib/gallery-content.mjs';

export const MarkdownContent = memo(function MarkdownContent({
  html,
  className = '',
}: {
  html: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const parts = useMemo(() => galleryParts(html), [html]);
  useEffect(() => {
    for (const image of root.current?.querySelectorAll('.inline-image img') ??
      []) {
      if (
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth === 0
      )
        image.closest('.inline-image')?.setAttribute('data-failed', 'true');
    }
  }, [html]);
  return (
    <div
      ref={root}
      className={`prose ${className}`}
      onErrorCapture={(event) => {
        const target = event.target;
        if (target instanceof HTMLImageElement)
          target.closest('.inline-image')?.setAttribute('data-failed', 'true');
      }}
    >
      {parts.map((part, index) =>
        'images' in part ? (
          <ImageGallery key={index} images={part.images} />
        ) : (
          <div
            className="markdown-fragment"
            key={index}
            dangerouslySetInnerHTML={{ __html: part.html }}
          />
        ),
      )}
    </div>
  );
});
