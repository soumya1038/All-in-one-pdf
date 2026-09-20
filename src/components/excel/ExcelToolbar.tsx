import { useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Merge,
  Paintbrush,
  Type,
  BarChart3,
  Snowflake,
  Search,
  WrapText,
  Plus,
  Minus,
  Grid3X3,
  PanelTopClose,
} from 'lucide-react';
import ExcelFindReplaceDialog, { ExcelFindReplaceDialogProps } from './ExcelFindReplaceDialog';

/**
 * Toolbar action callback types.
 * These are forwarded to FortuneSheet's API.
 */
interface ExcelToolbarProps {
  onAction: (action: string, value?: unknown) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  findReplaceProps?: ExcelFindReplaceDialogProps;
}

interface ToolbarButton {
  id: string;
  icon: React.ReactNode;
  label: string;
  action: string;
  value?: unknown;
}

interface ToolbarGroup {
  label: string;
  buttons: ToolbarButton[];
}

function ExcelToolbar({ onAction, isCollapsed, onToggleCollapse, findReplaceProps }: ExcelToolbarProps) {
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  const handleClick = (action: string, value?: unknown) => {
    // Toggle format state for display
    const toggleActions = ['bold', 'italic', 'underline', 'strikethrough', 'wrapText'];
    if (toggleActions.includes(action)) {
      setActiveFormats((prev) => {
        const next = new Set(prev);
        if (next.has(action)) {
          next.delete(action);
        } else {
          next.add(action);
        }
        return next;
      });
    }
    onAction(action, value);
  };

  const groups: ToolbarGroup[] = [
    {
      label: 'Format',
      buttons: [
        { id: 'bold', icon: <Bold size={16} />, label: 'Bold (Ctrl+B)', action: 'bold' },
        { id: 'italic', icon: <Italic size={16} />, label: 'Italic (Ctrl+I)', action: 'italic' },
        { id: 'underline', icon: <Underline size={16} />, label: 'Underline (Ctrl+U)', action: 'underline' },
        { id: 'strikethrough', icon: <Strikethrough size={16} />, label: 'Strikethrough', action: 'strikethrough' },
      ],
    },
    {
      label: 'Alignment',
      buttons: [
        { id: 'align-left', icon: <AlignLeft size={16} />, label: 'Align Left', action: 'horizontalAlign', value: 1 },
        { id: 'align-center', icon: <AlignCenter size={16} />, label: 'Align Center', action: 'horizontalAlign', value: 0 },
        { id: 'align-right', icon: <AlignRight size={16} />, label: 'Align Right', action: 'horizontalAlign', value: 2 },
        { id: 'wrap-text', icon: <WrapText size={16} />, label: 'Wrap Text', action: 'wrapText' },
      ],
    },
    {
      label: 'Cells',
      buttons: [
        { id: 'merge', icon: <Merge size={16} />, label: 'Merge Cells', action: 'mergeCells' },
        { id: 'bg-color', icon: <Paintbrush size={16} />, label: 'Fill Color', action: 'backgroundColor' },
        { id: 'font-color', icon: <Type size={16} />, label: 'Font Color', action: 'fontColor' },
        { id: 'borders', icon: <Grid3X3 size={16} />, label: 'Borders', action: 'borders' },
      ],
    },
    {
      label: 'Insert',
      buttons: [
        { id: 'insert-row', icon: <Plus size={16} />, label: 'Insert Row', action: 'insertRow' },
        { id: 'insert-col', icon: <Plus size={16} />, label: 'Insert Column', action: 'insertColumn' },
        { id: 'delete-row', icon: <Minus size={16} />, label: 'Delete Row', action: 'deleteRow' },
        { id: 'delete-col', icon: <Minus size={16} />, label: 'Delete Column', action: 'deleteColumn' },
      ],
    },
    {
      label: 'Data',
      buttons: [
        { id: 'chart', icon: <BarChart3 size={16} />, label: 'Insert Chart', action: 'insertChart' },
        { id: 'freeze', icon: <Snowflake size={16} />, label: 'Freeze Panes', action: 'freezePanes' },
        { id: 'find', icon: <Search size={16} />, label: 'Find & Replace (Ctrl+H)', action: 'findReplace' },
      ],
    },
  ];

  return (
    <div
      className={`bg-bg-surface border-b border-border transition-all duration-200 shrink-0 ${
        isCollapsed ? 'h-0 overflow-hidden opacity-0' : ''
      }`}
    >
      <div className="flex items-center px-3 py-1.5 gap-0.5 overflow-x-auto">
        {groups.map((group, groupIdx) => (
          <div key={group.label} className="flex items-center">
            {/* Group buttons */}
            <div className="flex items-center gap-0.5">
              {group.buttons.map((btn) => (
                <div key={btn.id} className="flex items-center">
                  <button
                    onClick={() => handleClick(btn.action, btn.value)}
                    title={btn.label}
                    className={`p-1.5 rounded transition-fast ${
                      (btn.id === 'find' && findReplaceProps?.isOpen) || activeFormats.has(btn.action)
                        ? 'bg-accent-light text-accent'
                        : 'text-text-secondary hover:bg-bg-sunken hover:text-text-primary'
                    }`}
                  >
                    {btn.icon}
                  </button>

                  {/* Inline Find & Replace Bar placed directly after the Find & Replace button */}
                  {btn.id === 'find' && findReplaceProps?.isOpen && (
                    <ExcelFindReplaceDialog {...findReplaceProps} />
                  )}
                </div>
              ))}
            </div>

            {/* Divider between groups */}
            {groupIdx < groups.length - 1 && (
              <div className="w-px h-5 bg-border mx-1.5" />
            )}
          </div>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Collapse toggle */}
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded text-text-muted hover:bg-bg-sunken hover:text-text-secondary transition-fast"
          title={isCollapsed ? 'Show toolbar' : 'Hide toolbar'}
        >
          <PanelTopClose size={16} />
        </button>
      </div>
    </div>
  );
}

export default ExcelToolbar;
