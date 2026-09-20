import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  ChevronUp,
  ChevronDown,
  CaseSensitive,
  Layers,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { WorkbookInstance } from '@fortune-sheet/react';
import { SheetData } from '../../types/Excel.types';

interface SearchMatch {
  sheetId: string;
  sheetIndex: number;
  sheetName: string;
  r: number;
  c: number;
  value: string;
}

export interface ExcelFindReplaceDialogProps {
  isOpen: boolean;
  initialTab?: 'find' | 'replace';
  onClose: () => void;
  workbookRef: React.RefObject<WorkbookInstance | null>;
  workbookDataRef: React.MutableRefObject<SheetData[]>;
  activeSheetIndex: number;
  onSwitchSheet: (index: number, id?: string) => void;
  onDataChanged: () => void;
}

/**
 * Extract non-empty cells from a sheet (supporting both FortuneSheet's 2D data matrix and celldata)
 */
function extractCellsFromSheet(sheet: any): Array<{ r: number; c: number; text: string }> {
  const cells: Array<{ r: number; c: number; text: string }> = [];
  if (!sheet) return cells;

  // 1. Check sheet.data (FortuneSheet 2D matrix after initialization)
  if (Array.isArray(sheet.data) && sheet.data.length > 0) {
    for (let r = 0; r < sheet.data.length; r++) {
      const row = sheet.data[r];
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (cell === null || cell === undefined) continue;

        let text = '';
        if (typeof cell === 'string' || typeof cell === 'number') {
          text = String(cell);
        } else if (typeof cell === 'object') {
          if (cell.m !== undefined && cell.m !== null) {
            text = String(cell.m);
          } else if (cell.v !== undefined && cell.v !== null) {
            text = String(cell.v);
          } else if (cell.f) {
            text = String(cell.f);
          }
        }

        if (text) {
          cells.push({ r, c, text });
        }
      }
    }

    if (cells.length > 0) {
      return cells;
    }
  }

  // 2. Fallback to sheet.celldata (sparse array before initialization or when data is empty)
  if (Array.isArray(sheet.celldata)) {
    for (const item of sheet.celldata) {
      if (!item || item.v === null || item.v === undefined) continue;
      const cell = item.v;
      let text = '';
      if (typeof cell === 'string' || typeof cell === 'number') {
        text = String(cell);
      } else if (typeof cell === 'object') {
        if (cell.m !== undefined && cell.m !== null) {
          text = String(cell.m);
        } else if (cell.v !== undefined && cell.v !== null) {
          text = String(cell.v);
        } else if (cell.f) {
          text = String(cell.f);
        }
      }

      if (text) {
        cells.push({ r: item.r, c: item.c, text });
      }
    }
  }

  return cells;
}

function ExcelFindReplaceDialog({
  isOpen,
  initialTab = 'find',
  onClose,
  workbookRef,
  workbookDataRef,
  activeSheetIndex,
  onSwitchSheet,
  onDataChanged,
}: ExcelFindReplaceDialogProps) {
  const [activeTab, setActiveTab] = useState<'find' | 'replace'>(initialTab);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [matchEntireCell, setMatchEntireCell] = useState(false);
  const [searchScope, setSearchScope] = useState<'sheet' | 'workbook'>('sheet');

  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(-1);
  const [hasSearched, setHasSearched] = useState(false);

  const findInputRef = useRef<HTMLInputElement>(null);

  // Sync initial tab and auto-focus when opened
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setHasSearched(false);
      setTimeout(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }, 50);
    }
  }, [isOpen, initialTab]);

  /**
   * Search algorithm: finds all cell coordinates containing findText
   */
  const executeSearch = useCallback(
    (query: string, scope: 'sheet' | 'workbook', caseSens: boolean, entireCell: boolean): SearchMatch[] => {
      if (!query.trim()) return [];

      // Get live sheets from FortuneSheet if available, otherwise fall back to ref
      const liveSheets = workbookRef.current?.getAllSheets?.();
      const sheets = (liveSheets && liveSheets.length > 0)
        ? liveSheets
        : workbookDataRef.current;

      if (!sheets || sheets.length === 0) return [];

      const currentSheet = workbookDataRef.current[activeSheetIndex];
      const currentSheetId = currentSheet?.id || String(activeSheetIndex);

      const results: SearchMatch[] = [];

      for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
        const sheet = sheets[sIdx];
        if (!sheet) continue;

        const sheetId = String(sheet.id || ((sheet as any).index !== undefined ? (sheet as any).index : sIdx));

        if (scope === 'sheet') {
          const isMatch = sIdx === activeSheetIndex || sheetId === currentSheetId;
          if (!isMatch) continue;
        }

        const cells = extractCellsFromSheet(sheet);

        for (const cell of cells) {
          let matched = false;
          if (entireCell) {
            matched = caseSens
              ? cell.text === query
              : cell.text.toLowerCase() === query.toLowerCase();
          } else {
            matched = caseSens
              ? cell.text.includes(query)
              : cell.text.toLowerCase().includes(query.toLowerCase());
          }

          if (matched) {
            results.push({
              sheetId,
              sheetIndex: sIdx,
              sheetName: sheet.name || `Sheet${sIdx + 1}`,
              r: cell.r,
              c: cell.c,
              value: cell.text,
            });
          }
        }
      }

      return results;
    },
    [activeSheetIndex, workbookRef, workbookDataRef]
  );

  /**
   * Navigate and highlight a match in FortuneSheet
   */
  const highlightMatch = useCallback(
    (match: SearchMatch) => {
      if (!match) return;

      // Switch sheet if match is in a different sheet
      if (match.sheetIndex !== activeSheetIndex) {
        onSwitchSheet(match.sheetIndex, match.sheetId);
      }

      // Allow FortuneSheet DOM to settle, then select & scroll
      setTimeout(() => {
        const wb = workbookRef.current;
        if (wb) {
          try {
            wb.scroll({ targetRow: match.r, targetColumn: match.c });
            wb.setSelection([
              {
                row: [match.r, match.r],
                column: [match.c, match.c],
              },
            ]);
          } catch (err) {
            console.error('Failed to select cell in FortuneSheet:', err);
          }
        }
      }, 75);
    },
    [activeSheetIndex, onSwitchSheet, workbookRef]
  );

  /**
   * Handle Find Next
   */
  const handleFindNext = () => {
    if (!findText.trim()) return;

    let currentMatches = matches;
    if (!hasSearched || matches.length === 0) {
      currentMatches = executeSearch(findText, searchScope, matchCase, matchEntireCell);
      setMatches(currentMatches);
      setHasSearched(true);

      if (currentMatches.length === 0) {
        toast('No matches found', { icon: '🔍' });
        setCurrentMatchIndex(-1);
        return;
      }
    }

    const nextIndex = (currentMatchIndex + 1) % currentMatches.length;
    setCurrentMatchIndex(nextIndex);
    highlightMatch(currentMatches[nextIndex]);
  };

  /**
   * Handle Find Previous
   */
  const handleFindPrev = () => {
    if (!findText.trim()) return;

    let currentMatches = matches;
    if (!hasSearched || matches.length === 0) {
      currentMatches = executeSearch(findText, searchScope, matchCase, matchEntireCell);
      setMatches(currentMatches);
      setHasSearched(true);

      if (currentMatches.length === 0) {
        toast('No matches found', { icon: '🔍' });
        setCurrentMatchIndex(-1);
        return;
      }
    }

    const prevIndex = currentMatchIndex <= 0
      ? currentMatches.length - 1
      : currentMatchIndex - 1;
    setCurrentMatchIndex(prevIndex);
    highlightMatch(currentMatches[prevIndex]);
  };

  /**
   * Trigger search when findText or options change
   */
  const handleFindTextChange = (val: string) => {
    setFindText(val);
    setHasSearched(false);
    if (!val.trim()) {
      setMatches([]);
      setCurrentMatchIndex(-1);
    }
  };

  /**
   * Replace current match
   */
  const handleReplace = () => {
    let currentMatches = matches;
    if (matches.length === 0 || currentMatchIndex === -1) {
      currentMatches = executeSearch(findText, searchScope, matchCase, matchEntireCell);
      setMatches(currentMatches);
      setHasSearched(true);
      if (currentMatches.length === 0) {
        toast('No matches to replace', { icon: '🔍' });
        return;
      }
    }

    const targetIdx = (currentMatchIndex >= 0 && currentMatchIndex < currentMatches.length)
      ? currentMatchIndex
      : 0;
    const match = currentMatches[targetIdx];
    if (!match) return;

    let newVal = replaceText;
    if (!matchEntireCell) {
      const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, matchCase ? '' : 'i');
      newVal = match.value.replace(regex, replaceText);
    }

    // 1. Update live in FortuneSheet
    const wb = workbookRef.current;
    if (wb) {
      try {
        wb.setCellValue(match.r, match.c, newVal, { id: match.sheetId, index: match.sheetIndex });
      } catch (err) {
        console.error('Failed to setCellValue in FortuneSheet:', err);
      }
    }

    // 2. Update in workbookDataRef
    const sheet = workbookDataRef.current.find((s) => s.id === match.sheetId) || workbookDataRef.current[match.sheetIndex];
    if (sheet) {
      if (!sheet.data) {
        sheet.data = [];
      }
      if (!sheet.data[match.r]) {
        sheet.data[match.r] = [];
      }
      const cellObj = sheet.data[match.r][match.c];
      if (typeof cellObj === 'object' && cellObj !== null) {
        cellObj.v = newVal;
        cellObj.m = newVal;
      } else {
        sheet.data[match.r][match.c] = { v: newVal, m: newVal };
      }

      if (Array.isArray(sheet.celldata)) {
        const c = sheet.celldata.find((cell) => cell.r === match.r && cell.c === match.c);
        if (c) {
          if (!c.v) c.v = {};
          c.v.v = newVal;
          c.v.m = newVal;
        } else {
          sheet.celldata.push({ r: match.r, c: match.c, v: { v: newVal, m: newVal } });
        }
      }
    }

    onDataChanged();

    // 3. Refresh search results and move to next match
    const updatedMatches = executeSearch(findText, searchScope, matchCase, matchEntireCell);
    setMatches(updatedMatches);

    if (updatedMatches.length > 0) {
      const nextIdx = targetIdx < updatedMatches.length ? targetIdx : 0;
      setCurrentMatchIndex(nextIdx);
      highlightMatch(updatedMatches[nextIdx]);
    } else {
      setCurrentMatchIndex(-1);
      toast.success('Replaced final occurrence');
    }
  };

  /**
   * Replace All matches
   */
  const handleReplaceAll = () => {
    if (!findText.trim()) return;

    const allMatches = executeSearch(findText, searchScope, matchCase, matchEntireCell);
    if (allMatches.length === 0) {
      toast('No matches to replace', { icon: '🔍' });
      return;
    }

    const wb = workbookRef.current;
    let count = 0;

    for (const match of allMatches) {
      let newVal = replaceText;
      if (!matchEntireCell) {
        const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, matchCase ? 'g' : 'gi');
        newVal = match.value.replace(regex, replaceText);
      }

      if (wb) {
        try {
          wb.setCellValue(match.r, match.c, newVal, { id: match.sheetId, index: match.sheetIndex });
        } catch {
          // Continue
        }
      }

      const sheet = workbookDataRef.current.find((s) => s.id === match.sheetId) || workbookDataRef.current[match.sheetIndex];
      if (sheet) {
        if (!sheet.data) {
          sheet.data = [];
        }
        if (!sheet.data[match.r]) {
          sheet.data[match.r] = [];
        }
        const cellObj = sheet.data[match.r][match.c];
        if (typeof cellObj === 'object' && cellObj !== null) {
          cellObj.v = newVal;
          cellObj.m = newVal;
        } else {
          sheet.data[match.r][match.c] = { v: newVal, m: newVal };
        }

        if (Array.isArray(sheet.celldata)) {
          const c = sheet.celldata.find((cell) => cell.r === match.r && cell.c === match.c);
          if (c) {
            if (!c.v) c.v = {};
            c.v.v = newVal;
            c.v.m = newVal;
          } else {
            sheet.celldata.push({ r: match.r, c: match.c, v: { v: newVal, m: newVal } });
          }
        }
      }

      count++;
    }

    onDataChanged();
    setMatches([]);
    setCurrentMatchIndex(-1);
    setHasSearched(true);
    toast.success(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`);
  };

  /**
   * Keyboard shortcuts in dialog
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handleFindPrev();
      } else {
        handleFindNext();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex items-center gap-1.5 bg-bg-sunken/80 border border-border rounded-md px-1.5 py-0.5 ml-1.5 animate-fade-in select-none text-xs shrink-0 shadow-xs"
    >
      {/* Mode Switch Pills */}
      <div className="flex items-center bg-bg-base rounded p-0.5 border border-border shrink-0">
        <button
          onClick={() => setActiveTab('find')}
          className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-fast ${
            activeTab === 'find'
              ? 'bg-bg-surface text-text-primary shadow-xs font-semibold'
              : 'text-text-muted hover:text-text-primary'
          }`}
          title="Find (Ctrl+F)"
        >
          Find
        </button>
        <button
          onClick={() => setActiveTab('replace')}
          className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-fast ${
            activeTab === 'replace'
              ? 'bg-bg-surface text-text-primary shadow-xs font-semibold'
              : 'text-text-muted hover:text-text-primary'
          }`}
          title="Replace (Ctrl+H)"
        >
          Replace
        </button>
      </div>

      {/* Find Input with options inside */}
      <div className="relative flex items-center shrink-0">
        <input
          ref={findInputRef}
          type="text"
          value={findText}
          onChange={(e) => handleFindTextChange(e.target.value)}
          placeholder="Find in sheet..."
          className="w-28 sm:w-36 h-6 pl-2 pr-14 text-xs bg-bg-base border border-border rounded outline-none focus:border-accent text-text-primary placeholder:text-text-muted transition-fast font-sans"
          spellCheck={false}
        />
        <div className="absolute right-0.5 flex items-center gap-0.5">
          <button
            onClick={() => {
              setMatchCase(!matchCase);
              setHasSearched(false);
            }}
            className={`px-1 py-0.5 rounded text-[9px] font-semibold transition-fast ${
              matchCase
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-sunken'
            }`}
            title="Match case"
          >
            <CaseSensitive size={11} />
          </button>
          <button
            onClick={() => {
              setMatchEntireCell(!matchEntireCell);
              setHasSearched(false);
            }}
            className={`px-0.5 py-0.5 rounded text-[9px] font-semibold transition-fast ${
              matchEntireCell
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-sunken'
            }`}
            title="Match exact cell"
          >
            [=]
          </button>
          <button
            onClick={() => {
              setSearchScope(searchScope === 'sheet' ? 'workbook' : 'sheet');
              setHasSearched(false);
            }}
            className={`p-0.5 rounded transition-fast ${
              searchScope === 'workbook'
                ? 'text-accent bg-accent-light'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-sunken'
            }`}
            title={`Scope: ${searchScope === 'sheet' ? 'Current Sheet' : 'All Sheets'}`}
          >
            <Layers size={10} />
          </button>
        </div>
      </div>

      {/* Match counter badge */}
      {hasSearched && (
        <span className="text-[10px] font-mono text-accent px-1.5 py-0.5 bg-accent-light rounded font-medium shrink-0">
          {matches.length > 0 ? `${currentMatchIndex + 1}/${matches.length}` : '0'}
        </span>
      )}

      {/* Prev / Next navigation */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={handleFindPrev}
          disabled={matches.length === 0}
          title="Previous match (Shift+Enter)"
          className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed rounded hover:bg-bg-surface transition-fast"
        >
          <ChevronUp size={13} />
        </button>
        <button
          onClick={handleFindNext}
          title="Next match (Enter)"
          className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-bg-surface transition-fast"
        >
          <ChevronDown size={13} />
        </button>
      </div>

      {/* Replace Mode Section */}
      {activeTab === 'replace' && (
        <div className="flex items-center gap-1 shrink-0 border-l border-border pl-1.5 animate-fade-in">
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace with..."
            className="w-24 sm:w-32 h-6 px-2 text-xs bg-bg-base border border-border rounded outline-none focus:border-accent text-text-primary placeholder:text-text-muted transition-fast font-sans"
            spellCheck={false}
          />
          <button
            onClick={handleReplace}
            className="h-6 px-1.5 text-[10px] font-medium rounded bg-bg-base border border-border text-text-primary hover:bg-bg-surface transition-fast shrink-0"
            title="Replace current match"
          >
            Replace
          </button>
          <button
            onClick={handleReplaceAll}
            className="h-6 px-1.5 text-[10px] font-medium rounded border border-border text-text-secondary hover:bg-bg-surface hover:text-text-primary transition-fast shrink-0"
            title="Replace all occurrences"
          >
            All
          </button>
        </div>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-bg-surface transition-fast shrink-0 ml-0.5"
        title="Close (Esc)"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export default ExcelFindReplaceDialog;
