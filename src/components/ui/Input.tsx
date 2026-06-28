import { InputHTMLAttributes, forwardRef } from 'react';
import { AlertCircle } from 'lucide-react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
}

/**
 * Input component with label, error, and helper text
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      fullWidth = false,
      disabled,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

    const baseStyles =
      'px-3 py-2 text-base bg-bg-sunken border rounded-sm transition-fast focus:outline-none focus:ring-2 focus:ring-border-focus disabled:opacity-40 disabled:cursor-not-allowed';

    const stateStyles = error
      ? 'border-error focus:border-error'
      : 'border-border focus:border-border-focus';

    const widthStyles = fullWidth ? 'w-full' : '';

    return (
      <div className={fullWidth ? 'w-full' : ''}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-text-primary mb-1"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          className={`${baseStyles} ${stateStyles} ${widthStyles} ${className}`}
          {...props}
        />
        {error && (
          <div className="flex items-center gap-1 mt-1 text-sm text-error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}
        {helperText && !error && (
          <p className="mt-1 text-sm text-text-secondary">{helperText}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;
