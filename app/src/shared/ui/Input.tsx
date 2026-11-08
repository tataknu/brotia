import clsx from 'clsx';
import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export const inputClass =
  'w-full rounded-card border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/70 hover:border-[#CCD6CF] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:bg-surface disabled:text-muted';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputClass, invalid && 'border-danger focus:border-danger focus:ring-danger/20', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(inputClass, 'min-h-[80px]', className)} {...rest} />;
});
