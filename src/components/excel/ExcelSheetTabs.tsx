import { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';

interface SheetTab {
  id?: string;
  name: string;
  index: number;
  isActive: boolean;
}

interface ExcelSheetTabsProps {
  sheets: SheetTab[];
  onSwitchSheet: (index: number, id?: string) => void;
  onAddSheet: () => void;
  onRenameSheet: (index: number, newName: string) => void;
  onDeleteSheet: (index: number) => void;
  onDuplicateSheet: (index: number) => void;
}

function ExcelSheetTabs({
  sheets,
  onSwitchSheet,
  onAddSheet,
  onRenameSheet,
  onDeleteSheet,
  onDuplicateSheet,
}: ExcelSheetTabsProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sheetIndex: number } | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Close context menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    if (contextMenu) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [contextMenu]);

  // Focus edit input
  useEffect(() => {
    if (editingIndex !== null && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingIndex]);

  const handleContextMenu = (e: React.MouseEvent, sheetIndex: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, sheetIndex });
  };

  const handleRenameStart = (index: number) => {
    const sheet = sheets.find((s) => s.index === index);
    if (sheet) {
      setEditName(sheet.name);
      setEditingIndex(index);
      setContextMenu(null);
    }
  };

  const handleRenameSubmit = () => {
    if (editingIndex !== null && editName.trim()) {
      onRenameSheet(editingIndex, editName.trim());
    }
    setEditingIndex(null);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit();
    if (e.key === 'Escape') setEditingIndex(null);
  };

  const contextMenuItems = [
    { label: 'Rename', action: () => contextMenu && handleRenameStart(contextMenu.sheetIndex) },
    { label: 'Duplicate', action: () => { if (contextMenu) { onDuplicateSheet(contextMenu.sheetIndex); setContextMenu(null); } } },
    { label: 'Delete', action: () => { if (contextMenu) { onDeleteSheet(contextMenu.sheetIndex); setContextMenu(null); } }, danger: true },
  ];

  return (
    <div className="h-8 bg-bg-base border-t border-border flex items-center shrink-0 select-none">
      {/* Sheet tabs */}
      <div className="flex items-center h-full overflow-x-auto no-scrollbar">
        {sheets.map((sheet) => (
          <div
            key={sheet.id || sheet.index}
            onClick={() => onSwitchSheet(sheet.index, sheet.id)}
            onContextMenu={(e) => handleContextMenu(e, sheet.index)}
            onDoubleClick={() => handleRenameStart(sheet.index)}
            className={`flex items-center h-full px-4 text-xs font-medium cursor-pointer transition-fast border-r border-border whitespace-nowrap ${
              sheet.isActive
                ? 'bg-bg-surface text-text-primary border-b-2 border-b-accent'
                : 'bg-bg-base text-text-secondary hover:bg-bg-sunken hover:text-text-primary'
            }`}
          >
            {editingIndex === sheet.index ? (
              <input
                ref={editInputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={handleRenameKeyDown}
                className="text-xs bg-transparent border-b border-accent outline-none w-20 text-text-primary"
                spellCheck={false}
                style={{ userSelect: 'text' }}
              />
            ) : (
              sheet.name
            )}
          </div>
        ))}

        {/* Add sheet button */}
        <button
          onClick={onAddSheet}
          className="flex items-center justify-center h-full px-3 text-text-muted hover:text-accent hover:bg-bg-sunken transition-fast"
          title="Add sheet"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed bg-bg-surface border border-border rounded-lg shadow-lg z-50 py-1 min-w-[140px] animate-scale-in"
          style={{ left: contextMenu.x, top: contextMenu.y - 120 }}
        >
          {contextMenuItems.map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              disabled={item.danger && sheets.length <= 1}
              className={`w-full text-left px-3 py-1.5 text-xs transition-fast ${
                item.danger
                  ? 'text-error hover:bg-error-light disabled:opacity-40 disabled:cursor-not-allowed'
                  : 'text-text-primary hover:bg-bg-sunken'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExcelSheetTabs;
