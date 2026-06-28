import { ButtonHTMLAttributes, forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  fullWidth?: boolean;
}

/**
 * Button component with variants following design system
 * - Primary: blue fill (one per screen max)
 * - Secondary: outlined
 * - Ghost: text only
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-fast rounded-md focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed';

    const variantStyles = {
      primary:
        'bg-accent text-text-on-accent hover:bg-accent-hover active:bg-accent-hover shadow-sm',
      secondary:
        'bg-bg-surface text-text-primary border border-border hover:bg-bg-sunken active:bg-bg-sunken',
      ghost: 'text-text-secondary hover:bg-bg-sunken active:bg-bg-sunken',
    };

    const sizeStyles = {
      sm: 'text-sm px-3 py-1.5 gap-1.5',
      md: 'text-base px-4 py-2 gap-2',
      lg: 'text-lg px-6 py-3 gap-2',
    };

    const widthStyles = fullWidth ? 'w-full' : '';

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${widthStyles} ${className}`}
        {...props}
      >
        {isLoading && <Loader2 size={16} className="animate-spin" />}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
