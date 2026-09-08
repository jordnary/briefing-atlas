'use client';

import {
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';
import './float-in.css';

type FloatInProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'article' | 'section' | 'li';
  /** Animation timing is measured in milliseconds; distance is in pixels. */
  delay?: number;
  duration?: number;
  distance?: number;
};

/** Reveals content once per mount without adding a layout wrapper. */
export function FloatIn({
  as: Component = 'div',
  delay = 0,
  duration = 600,
  distance = 20,
  className,
  style,
  children,
  ...props
}: FloatInProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (
      !element ||
      motion.matches ||
      !('IntersectionObserver' in window) ||
      element.matches(':target, :has(:focus-visible)')
    )
      return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        element.dataset.floatIn = 'visible';
        observer.disconnect();
      }
    });
    // Only hide after enhancement is available; server-rendered content stays readable.
    element.dataset.floatIn = 'pending';
    observer.observe(element);

    const showImmediately = () => {
      observer.disconnect();
      delete element.dataset.floatIn;
    };
    const onMotionChange = () => {
      if (motion.matches) showImmediately();
    };
    // Pointer focus must not move the target between pointerdown and click.
    const onFocus = (event: FocusEvent) => {
      if (
        event.target instanceof Element &&
        event.target.matches(':focus-visible')
      )
        showImmediately();
    };
    element.addEventListener('focusin', onFocus);
    motion.addEventListener('change', onMotionChange);
    return () => {
      showImmediately();
      element.removeEventListener('focusin', onFocus);
      motion.removeEventListener('change', onMotionChange);
    };
  }, []);

  return (
    <Component
      {...props}
      ref={(element: HTMLElement | null) => {
        ref.current = element;
      }}
      className={cn('float-in', className)}
      style={
        {
          '--float-in-delay': `${Math.max(0, delay)}ms`,
          '--float-in-duration': `${Math.max(0, duration)}ms`,
          '--float-in-distance': `${distance}px`,
          ...style,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
}
