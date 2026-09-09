'use client';

import './image-gallery.css';
import type { GalleryImage } from '@/lib/gallery-content.mjs';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Expand,
  ExternalLink,
  ImageOff,
  X,
} from 'lucide-react';

function ImageAsset({
  image,
  eager = false,
}: {
  image: GalleryImage;
  eager?: boolean;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );
  const element = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (element.current?.complete)
      setStatus(element.current.naturalWidth ? 'ready' : 'failed');
  }, []);
  return (
    <>
      <img
        ref={element}
        src={image.src}
        alt={image.alt}
        className={`gallery-asset is-${status}`}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('failed')}
      />
      {status !== 'ready' && (
        <span className="gallery-image-status" role="status">
          {status === 'failed' ? (
            <ImageOff size={28} />
          ) : (
            <span className="gallery-loading-dot" />
          )}
          {status === 'failed' ? '图片暂时无法加载' : '图片加载中'}
        </span>
      )}
    </>
  );
}

function ImageCaption({ image }: { image: GalleryImage }) {
  const id = useId();
  const text = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    if (!text.current) return;
    const measure = () => {
      if (text.current && !expanded)
        setOverflow(text.current.scrollHeight > text.current.clientHeight + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(text.current);
    measure();
    return () => observer.disconnect();
  }, [expanded]);
  if (!image.caption && !image.captionHtml) return null;
  return (
    <figcaption className="gallery-caption">
      {image.captionHtml ? (
        <div
          ref={text}
          id={id}
          className={`gallery-caption-text ${expanded ? 'is-expanded' : ''}`}
          dangerouslySetInnerHTML={{ __html: image.captionHtml }}
        />
      ) : (
        <div
          ref={text}
          id={id}
          className={`gallery-caption-text ${expanded ? 'is-expanded' : ''}`}
        >
          {image.caption}
        </div>
      )}
      {(overflow || expanded) && (
        <button
          type="button"
          className="gallery-caption-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起图注' : '展开图注'}
        </button>
      )}
    </figcaption>
  );
}

function ImageViewer({
  images,
  index,
  onChange,
  onDismiss,
}: {
  images: GalleryImage[];
  index: number;
  onChange: (index: number) => void;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    element.showModal();
    const frame = requestAnimationFrame(() => closeButton.current?.focus());
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  const image = images[index];
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Native dialog supports modal keyboard and backdrop dismissal.
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label="图片预览"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          const focusable = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href]',
            ) ?? [],
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (
            first &&
            last &&
            ((event.shiftKey && document.activeElement === first) ||
              (!event.shiftKey && document.activeElement === last))
          ) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
          }
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          onChange(
            Math.min(
              images.length - 1,
              Math.max(0, index + (event.key === 'ArrowRight' ? 1 : -1)),
            ),
          );
        }
      }}
    >
      <div className="image-viewer-panel">
        <div className="image-viewer-toolbar">
          <span className="image-viewer-count" aria-live="polite">
            {index + 1} / {images.length}
          </span>
          <a href={image.src} target="_blank" rel="noopener noreferrer">
            查看原图 <ExternalLink size={16} />
          </a>
          <button
            type="button"
            className="gallery-button"
            aria-label="关闭图片预览"
            ref={closeButton}
            onClick={onDismiss}
          >
            <X size={22} />
          </button>
        </div>
        <div className="image-viewer-stage">
          <ImageAsset key={image.src} image={image} eager />
        </div>
        <div className="image-viewer-footer">
          {images.length > 1 && (
            <div
              className="image-viewer-navigation"
              role="group"
              aria-label="预览图片切换"
            >
              <button
                type="button"
                className="gallery-button"
                aria-label="上一张图片"
                disabled={index === 0}
                onClick={() => onChange(index - 1)}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                className="gallery-button"
                aria-label="下一张图片"
                disabled={index === images.length - 1}
                onClick={() => onChange(index + 1)}
              >
                <ChevronRight size={22} />
              </button>
            </div>
          )}
          <div className="image-viewer-caption">
            {image.caption || image.alt}
          </div>
        </div>
      </div>
    </dialog>
  );
}

export function ImageGallery({ images }: { images: GalleryImage[] }) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const targetIndex = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [active, setActive] = useState(0);
  const [viewer, setViewer] = useState(false);
  useEffect(() => {
    const track = viewport.current;
    if (!track) return;
    let width = track.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === track.clientWidth) return;
      width = track.clientWidth;
      track.scrollTo({
        left: targetIndex.current * width,
        behavior: 'instant',
      });
    });
    observer.observe(track);
    return () => {
      observer.disconnect();
      clearTimeout(timer.current);
    };
  }, []);
  const goTo = (index: number) => {
    const next = Math.min(images.length - 1, Math.max(0, index));
    targetIndex.current = next;
    setActive(next);
    const track = viewport.current;
    track?.scrollTo({
      left: next * track.clientWidth,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.target instanceof HTMLAnchorElement
    )
      return;
    const index = {
      ArrowLeft: targetIndex.current - 1,
      ArrowRight: targetIndex.current + 1,
      Home: 0,
      End: images.length - 1,
    }[event.key];
    if (index === undefined) return;
    event.preventDefault();
    goTo(index);
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Handle navigation keys bubbling from the gallery controls.
    <section
      className="image-gallery"
      aria-label="文章配图"
      aria-roledescription="轮播图"
      onKeyDown={onKeyDown}
    >
      <div className="gallery-toolbar">
        <span className="gallery-heading">
          配图{' '}
          <span className="gallery-count" aria-live="polite" aria-atomic="true">
            {active + 1} / {images.length}
          </span>
        </span>
        {images.length > 1 && (
          <div
            className="gallery-navigation"
            role="group"
            aria-label="图片切换"
          >
            <button
              type="button"
              className="gallery-button"
              aria-label="上一张图片"
              aria-controls={id}
              disabled={active === 0}
              onClick={() => goTo(targetIndex.current - 1)}
            >
              <ChevronLeft size={21} />
            </button>
            <button
              type="button"
              className="gallery-button"
              aria-label="下一张图片"
              aria-controls={id}
              disabled={active === images.length - 1}
              onClick={() => goTo(targetIndex.current + 1)}
            >
              <ChevronRight size={21} />
            </button>
          </div>
        )}
      </div>
      <figure className="gallery-figure">
        <div
          id={id}
          ref={viewport}
          className="gallery-viewport"
          role="group"
          aria-label="配图浏览，左右方向键切换图片"
          onScroll={() => {
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              const track = viewport.current;
              if (!track?.clientWidth) return;
              const index = Math.min(
                images.length - 1,
                Math.max(0, Math.round(track.scrollLeft / track.clientWidth)),
              );
              targetIndex.current = index;
              setActive(index);
            }, 120);
          }}
        >
          {images.map((image, index) => (
            <div
              className="gallery-slide"
              key={`${image.src}-${index}`}
              role="group"
              aria-label={`第 ${index + 1} 张，共 ${images.length} 张`}
              aria-hidden={index !== active}
            >
              <button
                type="button"
                className="gallery-open"
                tabIndex={index === active ? 0 : -1}
                aria-label={`放大第 ${index + 1} 张图片`}
                onClick={() => setViewer(true)}
              >
                <ImageAsset image={image} />
                <span className="gallery-expand-hint">
                  <Expand size={16} /> 放大查看
                </span>
              </button>
            </div>
          ))}
        </div>
        <ImageCaption key={active} image={images[active]} />
      </figure>
      {images.length > 1 && (
        <div className="gallery-pagination" role="group" aria-label="选择图片">
          {images.map((image, index) => (
            <button
              type="button"
              key={`${image.src}-${index}`}
              className="gallery-page"
              aria-label={`第 ${index + 1} 张图片`}
              aria-pressed={active === index}
              aria-controls={id}
              onClick={() => goTo(index)}
            >
              <span />
            </button>
          ))}
        </div>
      )}
      <div className="gallery-print-images" aria-hidden="true">
        {images.map((image, index) => (
          <figure key={`${image.src}-${index}`}>
            <img
              src={image.src}
              alt={image.alt}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            {image.captionHtml ? (
              <figcaption
                dangerouslySetInnerHTML={{ __html: image.captionHtml }}
              />
            ) : (
              <figcaption>{image.caption || image.alt}</figcaption>
            )}
          </figure>
        ))}
      </div>
      {viewer && (
        <ImageViewer
          images={images}
          index={active}
          onChange={goTo}
          onDismiss={() => {
            setViewer(false);
            requestAnimationFrame(() =>
              viewport.current
                ?.querySelector<HTMLButtonElement>('button[tabindex="0"]')
                ?.focus({ preventScroll: true }),
            );
          }}
        />
      )}
    </section>
  );
}
