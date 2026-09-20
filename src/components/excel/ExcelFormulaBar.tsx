import { useState, useRef } from 'react';
import { FunctionSquare } from 'lucide-react';

interface ExcelFormulaBarProps {
  cellRef: string;           // e.g., "A1"
  cellContent: string;       // Formula or display value
  onContentChange: (value: string) => void;
  onContentSubmit: () => void;
  onContentCancel: () => void;
}

function ExcelFormulaBar({
  cellRef,
  cellContent,
  onContentChange,
  onContentSubmit,
  onContentCancel,
}: ExcelFormulaBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onContentSubmit();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onContentCancel();
      inputRef.current?.blur();
    }
  };

  return (
    <div className="h-9 bg-bg-base border-b border-border flex items-center px-2 gap-2 shrink-0">
      {/* Cell Reference Indicator */}
      <div className="flex items-center justify-center min-w-[60px] h-6 px-2 bg-bg-surface border border-border rounded text-xs font-mono text-text-primary select-none">
        {cellRef || 'A1'}
      </div>

      {/* fx label */}
      <div className="flex items-center text-text-muted">
        <FunctionSquare size={14} />
      </div>

      {/* Formula/Value input */}
      <input
        ref={inputRef}
        type="text"
        value={cellContent}
        onChange={(e) => onContentChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={`flex-1 h-6 px-2 text-sm font-mono bg-bg-surface border rounded outline-none transition-fast ${
          isFocused
            ? 'border-accent shadow-sm'
            : 'border-border'
        } text-text-primary placeholder-text-muted`}
        placeholder="Enter value or formula..."
        spellCheck={false}
        style={{ userSelect: 'text' }}
      />
    </div>
  );
}

export default ExcelFormulaBar;
