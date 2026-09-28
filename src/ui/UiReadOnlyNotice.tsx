import type { HTMLAttributes, ReactNode } from 'react';
import { UiFeedback } from './UiFeedback';
import { UiIcon } from './UiIcon';

type UiReadOnlyNoticeProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

/** Compact, consistently announced status for business views that cannot be edited. */
export function UiReadOnlyNotice({ className = '', children = 'Lecture seule', ...props }: UiReadOnlyNoticeProps) {
  return <UiFeedback {...props} className={`ui-read-only-notice ${className}`.trim()}>
    <UiIcon name="eye" />
    <span>{children}</span>
  </UiFeedback>;
}
