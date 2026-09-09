import type { CSSProperties, ReactNode } from 'react';

type ActionBase = {
  id: string;
  label: string;
  icon: ReactNode;
};

/** Add page actions or links without changing the companion's interaction code. */
export type CompanionAction = ActionBase &
  (
    | {
        onSelect: () => void;
        pressed?: boolean;
        href?: never;
        external?: never;
      }
    | {
        href: string;
        external?: boolean;
        onSelect?: () => void;
        pressed?: never;
      }
  );

export function CompanionTools({
  actions,
}: {
  actions: readonly CompanionAction[];
}) {
  return (
    <div aria-label="看板娘功能" className="live2d-tools" role="group">
      {actions.map((action, index) => {
        const props = {
          'aria-label': action.label,
          className: 'live2d-tool',
          style: { '--tool-index': index } as CSSProperties,
        };
        const content = (
          <>
            <span aria-hidden="true" className="live2d-tool-icon">
              {action.icon}
            </span>
            <span aria-hidden="true" className="live2d-tool-label">
              {action.label}
            </span>
          </>
        );
        return action.href !== undefined ? (
          <a
            {...props}
            href={action.href}
            key={action.id}
            onClick={action.onSelect}
            rel={action.external ? 'noopener noreferrer' : undefined}
            target={action.external ? '_blank' : undefined}
          >
            {content}
          </a>
        ) : (
          <button
            {...props}
            aria-pressed={action.pressed}
            key={action.id}
            onClick={action.onSelect}
            type="button"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
