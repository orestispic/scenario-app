import { forwardRef, type TextareaHTMLAttributes } from 'react';

/** Approved multiline extension of the supplied .field; native semantics retained. */
export const UiTextarea=forwardRef<HTMLTextAreaElement,TextareaHTMLAttributes<HTMLTextAreaElement>>(function UiTextarea({className='',rows=4,...props},ref) {
  return <textarea {...props} rows={rows} className={`ui-textarea ${className}`} ref={ref}/>;
});
