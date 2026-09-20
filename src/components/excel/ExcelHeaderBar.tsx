import { useState, useRef, useEffect } from 'react';
import {
  Save,
  Download,
  X,
  ChevronDown,
  FileSpreadsheet,
  Printer,
  FileText,
  FileDown,
  Check,
  AlertCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ExcelExportFormat } from '../../types/Excel.types';

interface ExcelHeaderBarProps {
  onSave: () => void;
  onExport: (format: ExcelExportFormat) => void;
  onPrint: () => void;
  onClose: () => void;
  isSaving?: boolean;
}

function ExcelHeaderBar({ onSave, onExport, onPrint, onClose, isSaving }: ExcelHeaderBarProps) {
  const excelEditor = useAppStore((state) => state.excelEditor);
  const setExcelEditorState = useAppStore((state) => state.setExcelEditorState);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const filename = excelEditor.workbookData?.metadata?.filename || 'Untitled Workbook';
  const displayName = filename.replace(/\.[^/.]+$/, '');

  // Close export menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showExportMenu]);

  // Focus name input when editing
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleNameClick = () => {
    setEditName(displayName);
    setIsEditingName(true);
  };

  const handleNameSubmit = () => {
    const newName = editName.trim();
    if (newName && excelEditor.workbookData) {
      const ext = excelEditor.workbookData.metadata?.format || 'xlsx';
      setExcelEditorState({
        workbookData: {
          ...excelEditor.workbookData,
          metadata: {
            ...excelEditor.workbookData.metadata!,
            filename: `${newName}.${ext}`,
          },
        },
      });
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleNameSubmit();
    if (e.key === 'Escape') setIsEditingName(false);
  };

  const exportOptions = [
    { label: 'Save as Excel (.xlsx)', format: 'xlsx' as ExcelExportFormat, icon: <FileSpreadsheet size={15} /> },
    { label: 'Export as CSV (.csv)', format: 'csv' as ExcelExportFormat, icon: <FileDown size={15} /> },
    { label: 'Export as PDF (.pdf)', format: 'pdf' as ExcelExportFormat, icon: <FileText size={15} /> },
    { label: 'Print', format: 'print' as string, icon: <Printer size={15} /> },
  ];

  return (
    <div className="h-12 bg-bg-surface border-b border-border flex items-center justify-between px-4 select-none shrink-0">
      {/* Left: Back + Filename */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-bg-sunken text-text-secondary hover:text-text-primary transition-fast"
          title="Back to Home"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <FileSpreadsheet size={18} className="text-accent shrink-0" />

          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={handleNameKeyDown}
              className="text-sm font-medium text-text-primary bg-transparent border-b-2 border-accent outline-none px-1 py-0.5 min-w-[120px] max-w-[300px]"
              spellCheck={false}
            />
          ) : (
            <button
              onClick={handleNameClick}
              className="text-sm font-medium text-text-primary hover:text-accent transition-fast truncate max-w-[300px]"
              title="Click to rename"
            >
              {displayName}
            </button>
          )}
        </div>
      </div>

      {/* Center: Save status */}
      <div className="flex items-center gap-1.5">
        {isSaving ? (
          <div className="flex items-center gap-1.5 text-xs text-text-muted animate-pulse">
            <div className="w-1.5 h-1.5 rounded-full bg-warning animate-spin" />
            Saving...
          </div>
        ) : excelEditor.isDirty ? (
          <div className="flex items-center gap-1.5 text-xs text-warning">
            <AlertCircle size={12} />
            Unsaved changes
          </div>
        ) : excelEditor.lastSavedAt ? (
          <div className="flex items-center gap-1.5 text-xs text-success">
            <Check size={12} />
            Saved
          </div>
        ) : null}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        {/* Save Button */}
        <button
          onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-text-on-accent text-sm font-medium hover:bg-accent-hover transition-fast"
          title="Save (Ctrl+S)"
          disabled={isSaving}
        >
          <Save size={15} />
          Save
        </button>

        {/* Export Dropdown */}
        <div className="relative" ref={exportMenuRef}>
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-md text-text-secondary hover:bg-bg-sunken hover:text-text-primary transition-fast text-sm"
            title="Export options"
          >
            <Download size={15} />
            <ChevronDown size={12} />
          </button>

          {showExportMenu && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-bg-surface border border-border rounded-lg shadow-lg z-50 py-1 animate-scale-in">
              {exportOptions.map((option) => (
                <button
                  key={option.label}
                  onClick={() => {
                    setShowExportMenu(false);
                    if (option.format === 'print') {
                      onPrint();
                    } else {
                      onExport(option.format as ExcelExportFormat);
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-bg-sunken transition-fast text-left"
                >
                  <span className="text-text-secondary">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ExcelHeaderBar;
