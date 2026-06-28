import { Loader2 } from 'lucide-react';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Spinner component for loading states
 */
function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  const sizeMap = {
    sm: 16,
    md: 24,
    lg: 32,
  };

  return (
    <Loader2
      size={sizeMap[size]}
      className={`animate-spin text-accent ${className}`}
      aria-label="Loading"
    />
  );
}

/**
 * Full-screen loading overlay
 */
export function LoadingOverlay({ message }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm">
      <Spinner size="lg" />
      {message && <p className="mt-4 text-lg text-white">{message}</p>}
    </div>
  );
}

export default Spinner;
