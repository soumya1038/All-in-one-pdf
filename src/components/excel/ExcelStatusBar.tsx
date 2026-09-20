interface ExcelStatusBarProps {
  selectionSummary?: {
    sum?: number;
    average?: number;
    count?: number;
    min?: number;
    max?: number;
  };
  cellPosition?: string;     // e.g., "R1C1" or "A1"
  sheetInfo?: string;        // e.g., "Sheet 1 of 3"
}

function ExcelStatusBar({ selectionSummary, cellPosition, sheetInfo }: ExcelStatusBarProps) {
  const hasStats = selectionSummary && (
    selectionSummary.sum !== undefined ||
    selectionSummary.average !== undefined ||
    selectionSummary.count !== undefined
  );

  return (
    <div className="h-6 bg-bg-base border-t border-border flex items-center justify-between px-3 text-xs text-text-muted select-none shrink-0">
      {/* Left: Sheet info */}
      <div className="flex items-center gap-3">
        {sheetInfo && <span>{sheetInfo}</span>}
      </div>

      {/* Right: Selection statistics + cell position */}
      <div className="flex items-center gap-4">
        {hasStats && (
          <div className="flex items-center gap-3">
            {selectionSummary.sum !== undefined && (
              <span>
                <span className="text-text-secondary font-medium">Sum:</span>{' '}
                {selectionSummary.sum.toLocaleString()}
              </span>
            )}
            {selectionSummary.average !== undefined && (
              <span>
                <span className="text-text-secondary font-medium">Avg:</span>{' '}
                {selectionSummary.average.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            )}
            {selectionSummary.count !== undefined && (
              <span>
                <span className="text-text-secondary font-medium">Count:</span>{' '}
                {selectionSummary.count}
              </span>
            )}
            {selectionSummary.min !== undefined && (
              <span>
                <span className="text-text-secondary font-medium">Min:</span>{' '}
                {selectionSummary.min.toLocaleString()}
              </span>
            )}
            {selectionSummary.max !== undefined && (
              <span>
                <span className="text-text-secondary font-medium">Max:</span>{' '}
                {selectionSummary.max.toLocaleString()}
              </span>
            )}
          </div>
        )}

        {cellPosition && (
          <span className="font-mono text-text-secondary">{cellPosition}</span>
        )}
      </div>
    </div>
  );
}

export default ExcelStatusBar;
