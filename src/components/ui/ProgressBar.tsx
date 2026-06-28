export interface ProgressBarProps {
  progress: number; // 0-100
  label?: string;
  showPercentage?: boolean;
  className?: string;
}

/**
 * Progress bar component for showing operation progress
 */
function ProgressBar({
  progress,
  label,
  showPercentage = true,
  className = '',
}: ProgressBarProps) {
  const clampedProgress = Math.min(Math.max(progress, 0), 100);

  return (
    <div className={className}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-2">
          {label && <span className="text-sm text-text-secondary">{label}</span>}
          {showPercentage && (
            <span className="text-sm font-mono text-text-primary">{clampedProgress}%</span>
          )}
        </div>
      )}
      <div className="w-full h-2 bg-bg-sunken rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-normal ease-default"
          style={{ width: `${clampedProgress}%` }}
          role="progressbar"
          aria-valuenow={clampedProgress}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
