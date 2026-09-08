'use client';
import { useEffect, useRef } from 'react';

export function MarkdownContent({
  html,
  className = '',
}: {
  html: string;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
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
      dangerouslySetInnerHTML={{ __html: html }}
      onErrorCapture={(event) => {
        const target = event.target;
        if (target instanceof HTMLImageElement)
          target.closest('.inline-image')?.setAttribute('data-failed', 'true');
      }}
    />
  );
}
