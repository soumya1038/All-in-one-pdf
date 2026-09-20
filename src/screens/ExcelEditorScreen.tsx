import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { setAutoFreeze } from 'immer';
import { Workbook, WorkbookInstance } from '@fortune-sheet/react';
import type { Sheet as FortuneSheet } from '@fortune-sheet/core';
import '@fortune-sheet/react/dist/index.css';

// Disable Immer autoFreeze so FortuneSheet can freely mutate sheet/selection/cell attributes without throwing TypeError: Cannot assign to read only property
setAutoFreeze(false);
import { toast } from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { WorkbookData, ExcelExportFormat, ChartConfig, SheetData } from '../types/Excel.types';
import ExcelHeaderBar from '../components/excel/ExcelHeaderBar';
import ExcelToolbar from '../components/excel/ExcelToolbar';
import ExcelFormulaBar from '../components/excel/ExcelFormulaBar';
import ExcelSheetTabs from '../components/excel/ExcelSheetTabs';
import ExcelStatusBar from '../components/excel/ExcelStatusBar';
import ExcelChartDialog from '../components/excel/ExcelChartDialog';
import { LoadingOverlay } from '../components/ui/Spinner';

/**
 * Convert 0-based column index to Excel column letters (0 -> A, 25 -> Z, 26 -> AA)
 */
function getColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * ExcelEditorScreen — Main orchestrator for the Excel editor feature.
 *
 * IMPORTANT ARCHITECTURE NOTE:
 * FortuneSheet manages its own internal state. We must NOT feed updated data
 * back into its `data` prop on every change, or it will cause an infinite
 * re-render loop (onChange → setState → new data prop → onChange → ...).
 *
 * Instead, we:
 * 1. Pass `data` only ONCE via useMemo (initial/seed data).
 * 2. Track live sheet data in a ref (workbookDataRef) via onChange.
 * 3. Read from the ref when saving, exporting, or auto-saving.
 * 4. Only mark dirty via a ref to avoid re-creating the onChange callback.
 */
function ExcelEditorScreen() {
  const excelEditor = useAppStore((state) => state.excelEditor);
  const setExcelEditorState = useAppStore((state) => state.setExcelEditorState);
  const setExcelDirty = useAppStore((state) => state.setExcelDirty);
  const resetExcelEditor = useAppStore((state) => state.resetExcelEditor);
  const setView = useAppStore((state) => state.setView);
  const showConfirm = useAppStore((state) => state.showConfirm);

  // Local UI state
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [chartDialogOpen, setChartDialogOpen] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceInitialTab, setFindReplaceInitialTab] = useState<'find' | 'replace'>('replace');

  // FortuneSheet ref for programmatic operations (sheet switching, cell formats, selection)
  const workbookRef = useRef<WorkbookInstance | null>(null);

  // FortuneSheet live data — kept in sync via onChange, NEVER fed back as a prop
  const workbookDataRef = useRef<SheetData[]>([]);

  // Dirty flag ref — avoids re-creating the onChange callback when dirty changes
  const isDirtyRef = useRef(false);

  // Keep isDirtyRef in sync with the store
  useEffect(() => {
    isDirtyRef.current = excelEditor.isDirty;
  }, [excelEditor.isDirty]);

  // Formula bar state
  const [activeCellRef, setActiveCellRef] = useState('A1');
  const [activeCellContent, setActiveCellContent] = useState('');

  // Status bar state
  const [selectionSummary, setSelectionSummary] = useState<{
    sum?: number; average?: number; count?: number; min?: number; max?: number;
  }>({});
  const [cellPosition, setCellPosition] = useState('A1');

  // Active sheet tracking
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);

  // Sheet tabs — derived from the ref, updated via local state to trigger tab re-render
  const [sheetTabs, setSheetTabs] = useState<{ id?: string; name: string; index: number; isActive: boolean }[]>([]);

  // Auto-save session ID
  const autoSaveSessionId = useRef(uuidv4());
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable reference to metadata for use in save/export
  const metadataRef = useRef(excelEditor.workbookData?.metadata);
  useEffect(() => {
    metadataRef.current = excelEditor.workbookData?.metadata;
  }, [excelEditor.workbookData?.metadata]);

  // Stable reference to filePath
  const filePathRef = useRef(excelEditor.filePath);
  useEffect(() => {
    filePathRef.current = excelEditor.filePath;
  }, [excelEditor.filePath]);

  /**
   * Initialize: if no workbook data, create a new blank one
   */
  useEffect(() => {
    if (!excelEditor.workbookData && !excelEditor.isLoading) {
      initNewWorkbook();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Initialize sheet tabs when workbook data first arrives or changes
   */
  useEffect(() => {
    if (excelEditor.workbookData) {
      const sheetsWithIds = excelEditor.workbookData.sheets.map((sheet, idx) => ({
        ...sheet,
        id: sheet.id || String(sheet.index ?? idx),
        index: sheet.index !== undefined ? sheet.index : idx,
      }));
      workbookDataRef.current = sheetsWithIds;
      setActiveSheetIndex(0);
      updateSheetTabs(sheetsWithIds, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelEditor.workbookData]);

  /**
   * Set up auto-save timer (every 30 seconds)
   */
  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      if (isDirtyRef.current && workbookDataRef.current.length > 0) {
        performAutoSave();
      }
    }, 30000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Register keyboard shortcuts: Ctrl+S (Save), Ctrl+F (Find), Ctrl+H (Replace)
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 's') {
          e.preventDefault();
          handleSave();
        } else if (key === 'f') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          setToolbarCollapsed(false);
          setFindReplaceInitialTab('find');
          setFindReplaceOpen(true);
        } else if (key === 'h') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          setToolbarCollapsed(false);
          setFindReplaceInitialTab('replace');
          setFindReplaceOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ──────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────

  /**
   * Build a full WorkbookData object from the current ref + metadata
   */
  const buildWorkbookData = useCallback((): WorkbookData => {
    return {
      sheets: workbookDataRef.current,
      activeSheetIndex,
      metadata: metadataRef.current,
    };
  }, [activeSheetIndex]);

  /**
   * Update the sheet tabs display (local state only, not FortuneSheet data)
   */
  const updateSheetTabs = (sheets: SheetData[], activeIdx: number) => {
    setSheetTabs(
      sheets.map((sheet, idx) => ({
        id: sheet.id || String(sheet.index ?? idx),
        name: sheet.name,
        index: sheet.index !== undefined ? sheet.index : idx,
        isActive: idx === activeIdx,
      }))
    );
  };

  // ──────────────────────────────────────────────────────
  // Workbook Lifecycle
  // ──────────────────────────────────────────────────────

  const initNewWorkbook = async () => {
    setIsInitializing(true);
    try {
      const result = await window.electron.newExcelWorkbook();
      if (result.success) {
        setExcelEditorState({
          isOpen: true,
          workbookData: result.data,
          isDirty: false,
          isLoading: false,
        });
      } else {
        toast.error('Failed to create new workbook');
      }
    } catch (error) {
      toast.error('Failed to initialize workbook');
    } finally {
      setIsInitializing(false);
    }
  };

  // ──────────────────────────────────────────────────────
  // FortuneSheet Callbacks
  // ──────────────────────────────────────────────────────

  /**
   * Called whenever FortuneSheet data changes (cell edit, formatting, etc.)
   * 
   * CRITICAL: This callback must NOT trigger a re-render that changes the
   * `data` prop passed to <Workbook>, or it will cause an infinite loop.
   * We only update the ref and mark dirty (via ref check to avoid re-renders).
   */
  const handleSheetChange = useCallback((data: any[]) => {
    workbookDataRef.current = data as SheetData[];

    // Mark as dirty only once (avoid redundant store updates)
    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setExcelDirty(true);
    }
  }, [setExcelDirty]);

  // ──────────────────────────────────────────────────────
  // Save / Export / Print
  // ──────────────────────────────────────────────────────

  const handleSave = async () => {
    if (workbookDataRef.current.length === 0) return;
    setIsSaving(true);

    try {
      const workbookData = buildWorkbookData();
      const result = await window.electron.saveExcel(
        workbookData,
        filePathRef.current,
        'xlsx'
      );

      if (result.success) {
        isDirtyRef.current = false;
        setExcelEditorState({
          isDirty: false,
          lastSavedAt: Date.now(),
          filePath: result.data,
        });
        toast.success('Workbook saved successfully');
      } else {
        // User may have cancelled the Save As dialog
        if (result.error?.message !== 'Save cancelled by user') {
          toast.error(result.error?.message || 'Failed to save');
        }
      }
    } catch (error) {
      toast.error('Failed to save workbook');
    } finally {
      setIsSaving(false);
    }
  };

  const handleExport = async (format: ExcelExportFormat) => {
    if (workbookDataRef.current.length === 0) return;

    try {
      const workbookData = buildWorkbookData();

      if (format === 'pdf') {
        const result = await window.electron.exportExcelToPdf(workbookData);
        if (result.success) {
          toast.success('Exported to PDF successfully');
        } else {
          if (result.error?.message !== 'Export cancelled by user') {
            toast.error(result.error?.message || 'Failed to export');
          }
        }
      } else {
        const result = await window.electron.saveExcel(workbookData, undefined, format);
        if (result.success) {
          toast.success(`Exported as ${format.toUpperCase()} successfully`);
        } else {
          if (result.error?.message !== 'Save cancelled by user') {
            toast.error(result.error?.message || 'Failed to export');
          }
        }
      }
    } catch (error) {
      toast.error('Export failed');
    }
  };

  const handlePrint = async () => {
    if (workbookDataRef.current.length === 0) return;
    try {
      const workbookData = buildWorkbookData();
      await window.electron.printExcel(workbookData);
    } catch (error) {
      toast.error('Print failed');
    }
  };

  const performAutoSave = async () => {
    if (workbookDataRef.current.length === 0) return;
    try {
      const workbookData = buildWorkbookData();
      await window.electron.autoSaveExcel(workbookData, autoSaveSessionId.current);
    } catch {
      // Auto-save is best-effort, don't show errors
    }
  };

  // ──────────────────────────────────────────────────────
  // Close / Navigate Away
  // ──────────────────────────────────────────────────────

  const handleClose = async () => {
    if (isDirtyRef.current) {
      const confirmed = await showConfirm(
        'You have unsaved changes. Are you sure you want to close the editor?',
        'Close Editor',
        'Close without saving',
        'Cancel'
      );
      if (!confirmed) return;
    }

    resetExcelEditor();
    setView(AppView.HOME);
  };

  // ──────────────────────────────────────────────────────
  // Toolbar Actions
  // ──────────────────────────────────────────────────────

  const handleToolbarAction = (action: string, value?: unknown) => {
    const wb = workbookRef.current;

    switch (action) {
      case 'insertChart':
        setChartDialogOpen(true);
        break;
      case 'findReplace':
        setFindReplaceInitialTab('replace');
        setFindReplaceOpen((prev) => !prev);
        break;
      case 'bold': {
        const selection = wb?.getSelection();
        if (selection && selection.length > 0) {
          const range = selection[0];
          const curVal = wb?.getCellValue(range.row[0], range.column[0], { type: 'bl' });
          wb?.setCellFormatByRange('bl', curVal === 1 ? 0 : 1, range);
        }
        break;
      }
      case 'italic': {
        const selection = wb?.getSelection();
        if (selection && selection.length > 0) {
          const range = selection[0];
          const curVal = wb?.getCellValue(range.row[0], range.column[0], { type: 'it' });
          wb?.setCellFormatByRange('it', curVal === 1 ? 0 : 1, range);
        }
        break;
      }
      case 'underline': {
        const selection = wb?.getSelection();
        if (selection && selection.length > 0) {
          const range = selection[0];
          const curVal = wb?.getCellValue(range.row[0], range.column[0], { type: 'un' });
          wb?.setCellFormatByRange('un', curVal === 1 ? 0 : 1, range);
        }
        break;
      }
      case 'strikethrough': {
        const selection = wb?.getSelection();
        if (selection && selection.length > 0) {
          const range = selection[0];
          const curVal = wb?.getCellValue(range.row[0], range.column[0], { type: 'cl' });
          wb?.setCellFormatByRange('cl', curVal === 1 ? 0 : 1, range);
        }
        break;
      }
      case 'horizontalAlign': {
        const selection = wb?.getSelection();
        if (selection && selection.length > 0) {
          wb?.setCellFormatByRange('ht', value as number, selection[0]);
        }
        break;
      }
      case 'wrapText': {
        const selection = wb?.getSelection();
        if (selection && selection.length > 0) {
          const range = selection[0];
          const curVal = wb?.getCellValue(range.row[0], range.column[0], { type: 'tb' });
          wb?.setCellFormatByRange('tb', curVal === 1 ? 0 : 1, range);
        }
        break;
      }
      case 'mergeCells': {
        const selection = wb?.getSelection();
        if (selection && selection.length > 0) {
          try {
            wb?.mergeCells(selection, 'merge-all');
          } catch {
            wb?.cancelMerge(selection);
          }
        }
        break;
      }
      case 'freezePanes': {
        const selection = wb?.getSelection();
        const r = selection?.[0]?.row[0] ?? 0;
        const c = selection?.[0]?.column[0] ?? 0;
        wb?.freeze('both', { row: r, column: c });
        break;
      }
      case 'insertRow': {
        const selection = wb?.getSelection();
        const r = selection?.[0]?.row[0] ?? 0;
        wb?.insertRowOrColumn('row', r, 1);
        break;
      }
      case 'insertColumn': {
        const selection = wb?.getSelection();
        const c = selection?.[0]?.column[0] ?? 0;
        wb?.insertRowOrColumn('column', c, 1);
        break;
      }
      case 'deleteRow': {
        const selection = wb?.getSelection();
        const r1 = selection?.[0]?.row[0] ?? 0;
        const r2 = selection?.[0]?.row[1] ?? r1;
        wb?.deleteRowOrColumn('row', r1, r2);
        break;
      }
      case 'deleteColumn': {
        const selection = wb?.getSelection();
        const c1 = selection?.[0]?.column[0] ?? 0;
        const c2 = selection?.[0]?.column[1] ?? c1;
        wb?.deleteRowOrColumn('column', c1, c2);
        break;
      }
      default:
        break;
    }
  };

  // ──────────────────────────────────────────────────────
  // Formula Bar
  // ──────────────────────────────────────────────────────

  const handleFormulaChange = (value: string) => {
    setActiveCellContent(value);
  };

  const handleFormulaSubmit = () => {
    const wb = workbookRef.current;
    if (wb) {
      const selection = wb.getSelection();
      if (selection && selection[0]) {
        const r = (selection[0] as any).row_focus ?? selection[0].row[0];
        const c = (selection[0] as any).column_focus ?? selection[0].column[0];
        wb.setCellValue(r, c, activeCellContent);
      }
    }
  };

  const handleFormulaCancel = () => {
    // Reset to current cell value
    const wb = workbookRef.current;
    if (wb) {
      const selection = wb.getSelection();
      if (selection && selection[0]) {
        const r = (selection[0] as any).row_focus ?? selection[0].row[0];
        const c = (selection[0] as any).column_focus ?? selection[0].column[0];
        const val = wb.getCellValue(r, c, { type: 'v' });
        setActiveCellContent(val !== null && val !== undefined ? String(val) : '');
      }
    }
  };

  // ──────────────────────────────────────────────────────
  // Sheet Tab Actions
  // ──────────────────────────────────────────────────────

  const handleSwitchSheet = (index: number, id?: string) => {
    const sheets = workbookDataRef.current.length > 0
      ? workbookDataRef.current
      : excelEditor.workbookData?.sheets || [];
    const targetSheet = sheets.find((s) => (id && s.id === id) || s.index === index) || sheets[index] || sheets[0];
    if (!targetSheet) return;

    const targetIdx = targetSheet.index !== undefined ? targetSheet.index : index;
    const targetId = targetSheet.id || id || String(targetIdx);

    setActiveSheetIndex(targetIdx);
    updateSheetTabs(sheets, targetIdx);

    if (workbookRef.current) {
      try {
        workbookRef.current.activateSheet({ id: targetId, index: targetIdx });
      } catch (err) {
        console.error('Failed to activate sheet in FortuneSheet:', err);
      }
    }
  };

  const handleAddSheet = () => {
    const sheets = workbookDataRef.current.length > 0
      ? workbookDataRef.current
      : excelEditor.workbookData?.sheets || [];
    if (sheets.length === 0) return;

    const newIndex = sheets.length;
    const newId = String(newIndex);
    const newSheet: SheetData = {
      id: newId,
      name: `Sheet${newIndex + 1}`,
      index: newIndex,
      order: newIndex,
      celldata: [],
      config: { columnlen: {}, rowlen: {}, merge: {} },
      row: 1000,
      column: 26,
      status: 0,
    };

    const updatedSheets = [...sheets, newSheet];
    workbookDataRef.current = updatedSheets;

    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setExcelDirty(true);
    }

    if (workbookRef.current) {
      try {
        workbookRef.current.addSheet(newId);
      } catch (err) {
        console.error('Failed to add sheet in FortuneSheet:', err);
      }
    }

    setActiveSheetIndex(newIndex);
    updateSheetTabs(updatedSheets, newIndex);
  };

  const handleRenameSheet = (index: number, newName: string) => {
    const updatedSheets = workbookDataRef.current.map((sheet, idx) =>
      (sheet.index === index || idx === index) ? { ...sheet, name: newName } : sheet
    );
    workbookDataRef.current = updatedSheets;

    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setExcelDirty(true);
    }

    const targetSheet = workbookDataRef.current[index] || workbookDataRef.current.find((s) => s.index === index);
    const targetId = targetSheet?.id || String(index);

    if (workbookRef.current) {
      try {
        workbookRef.current.setSheetName(newName, { id: targetId, index });
      } catch (err) {
        console.error('Failed to rename sheet in FortuneSheet:', err);
      }
    }

    updateSheetTabs(updatedSheets, activeSheetIndex);
  };

  const handleDeleteSheet = (index: number) => {
    if (workbookDataRef.current.length <= 1) return;

    const targetSheet = workbookDataRef.current[index] || workbookDataRef.current.find((s) => s.index === index);
    const targetId = targetSheet?.id || String(index);

    const updatedSheets = workbookDataRef.current
      .filter((sheet, idx) => sheet.index !== index && idx !== index)
      .map((sheet, idx) => ({ ...sheet, index: idx, order: idx }));

    workbookDataRef.current = updatedSheets;

    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setExcelDirty(true);
    }

    if (workbookRef.current) {
      try {
        workbookRef.current.deleteSheet({ id: targetId, index });
      } catch (err) {
        console.error('Failed to delete sheet in FortuneSheet:', err);
      }
    }

    const newActiveIndex = activeSheetIndex >= updatedSheets.length
      ? updatedSheets.length - 1
      : activeSheetIndex;

    setActiveSheetIndex(newActiveIndex);
    updateSheetTabs(updatedSheets, newActiveIndex);
  };

  const handleDuplicateSheet = (index: number) => {
    const sheets = workbookDataRef.current;
    const sourceSheet = sheets.find((s) => s.index === index) || sheets[index];
    if (!sourceSheet) return;

    const newIndex = sheets.length;
    const newId = String(newIndex);
    const duplicated: SheetData = {
      ...sourceSheet,
      id: newId,
      name: `${sourceSheet.name} (Copy)`,
      index: newIndex,
      order: newIndex,
      celldata: [...sourceSheet.celldata],
      config: sourceSheet.config ? { ...sourceSheet.config } : undefined,
    };

    const updatedSheets = [...sheets, duplicated];
    workbookDataRef.current = updatedSheets;

    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setExcelDirty(true);
    }

    if (workbookRef.current) {
      try {
        workbookRef.current.addSheet(newId);
      } catch (err) {
        console.error('Failed to add duplicate sheet in FortuneSheet:', err);
      }
    }

    handleSwitchSheet(newIndex, newId);
  };

  // ──────────────────────────────────────────────────────
  // Chart Insertion
  // ──────────────────────────────────────────────────────

  const handleInsertChart = (chart: ChartConfig) => {
    if (!excelEditor.workbookData) return;
    const currentCharts = metadataRef.current?.charts || [];
    if (metadataRef.current) {
      metadataRef.current.charts = [...currentCharts, chart];
    }
    if (!isDirtyRef.current) {
      isDirtyRef.current = true;
      setExcelDirty(true);
    }
    toast.success(`Chart "${chart.title}" inserted`);
  };

  /**
   * Calculate selection statistics for Status Bar (Sum, Avg, Count, Min, Max)
   */
  const calculateSelectionStats = useCallback((sel: any) => {
    if (!sel || !sel.row || !sel.column) return;
    const r1 = Math.min(sel.row[0], sel.row[1]);
    const r2 = Math.max(sel.row[0], sel.row[1]);
    const c1 = Math.min(sel.column[0], sel.column[1]);
    const c2 = Math.max(sel.column[0], sel.column[1]);

    const totalCells = (r2 - r1 + 1) * (c2 - c1 + 1);
    if (totalCells <= 1) {
      setSelectionSummary((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const wb = workbookRef.current;
    if (!wb) return;

    let sum = 0;
    let numCount = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        const v = wb.getCellValue(r, c, { type: 'v' });
        if (typeof v === 'number' && !isNaN(v)) {
          sum += v;
          numCount++;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }

    if (numCount > 0) {
      setSelectionSummary({
        sum: Math.round(sum * 1000) / 1000,
        average: Math.round((sum / numCount) * 1000) / 1000,
        count: totalCells,
        min: min !== Infinity ? min : undefined,
        max: max !== -Infinity ? max : undefined,
      });
    } else {
      setSelectionSummary({ count: totalCells });
    }
  }, []);

  // Memoize FortuneSheet initial data — computed ONCE when workbook data arrives.
  // FortuneSheet manages its own internal state after mount. Recreating this array
  // on every render would cause FortuneSheet to re-initialize → onChange → loop.
  // Deep-clone using JSON to guarantee plain, mutable objects free of any freeze or proxy.
  const fortuneSheetData = useMemo(() => {
    if (!excelEditor.workbookData?.sheets) return [];
    const plainSheets = JSON.parse(JSON.stringify(excelEditor.workbookData.sheets));
    return plainSheets.map((sheet: any, idx: number) => ({
      ...sheet,
      id: sheet.id || String(sheet.index ?? idx),
      status: idx === 0 ? 1 : 0,  // First sheet active on initial load
    })) as unknown as FortuneSheet[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excelEditor.workbookData]);

  // Stable refs to keep workbookHooks callback reference 100% stable
  const activeSheetIndexRef = useRef(activeSheetIndex);
  useEffect(() => {
    activeSheetIndexRef.current = activeSheetIndex;
  }, [activeSheetIndex]);

  const calculateSelectionStatsRef = useRef(calculateSelectionStats);
  useEffect(() => {
    calculateSelectionStatsRef.current = calculateSelectionStats;
  }, [calculateSelectionStats]);

  // CRITICAL: workbookHooks MUST be a stable object reference.
  // Passing hooks inline causes FortuneSheet to re-run its core useEffect on EVERY render,
  // calling setContextWithProduce, firing afterSelectionChange, triggering setState in a loop
  // (Maximum update depth exceeded).
  const workbookHooks = useMemo(
    () => ({
      afterActivateSheet: (id: string) => {
        const sheets = workbookDataRef.current;
        const idx = sheets.findIndex((s) => String(s.id) === String(id) || String(s.index) === String(id));
        if (idx !== -1 && idx !== activeSheetIndexRef.current) {
          activeSheetIndexRef.current = idx;
          setActiveSheetIndex(idx);
          updateSheetTabs(sheets, idx);
        }
      },
      afterSelectionChange: (_sheetId: string, selection: any) => {
        if (selection) {
          const r = (selection as any).row_focus ?? selection.row?.[0] ?? 0;
          const c = (selection as any).column_focus ?? selection.column?.[0] ?? 0;
          const cellAddr = `${getColumnLetter(c)}${r + 1}`;
          setActiveCellRef((prev) => (prev === cellAddr ? prev : cellAddr));
          setCellPosition((prev) => (prev === cellAddr ? prev : cellAddr));

          const wb = workbookRef.current;
          if (wb) {
            try {
              const formula = wb.getCellValue(r, c, { type: 'f' });
              const value = wb.getCellValue(r, c, { type: 'v' });
              const content = formula
                ? String(formula)
                : value !== null && value !== undefined
                ? String(value)
                : '';
              setActiveCellContent((prev) => (prev === content ? prev : content));
            } catch {
              // Ignore temporary cell read errors during grid setup
            }
          }

          calculateSelectionStatsRef.current?.(selection);
        }
      },
    }),
    []
  );

  // ──────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────

  if (excelEditor.isLoading || isInitializing) {
    return <LoadingOverlay message="Loading spreadsheet..." />;
  }

  if (!excelEditor.workbookData || fortuneSheetData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted">
        <p>No workbook data available</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-fade-in excel-editor-container">
      {/* Header Bar */}
      <ExcelHeaderBar
        onSave={handleSave}
        onExport={handleExport}
        onPrint={handlePrint}
        onClose={handleClose}
        isSaving={isSaving}
      />

      {/* Toolbar */}
      <ExcelToolbar
        onAction={handleToolbarAction}
        isCollapsed={toolbarCollapsed}
        onToggleCollapse={() => setToolbarCollapsed(!toolbarCollapsed)}
        findReplaceProps={{
          isOpen: findReplaceOpen,
          initialTab: findReplaceInitialTab,
          onClose: () => setFindReplaceOpen(false),
          workbookRef,
          workbookDataRef,
          activeSheetIndex,
          onSwitchSheet: handleSwitchSheet,
          onDataChanged: () => {
            if (!isDirtyRef.current) {
              isDirtyRef.current = true;
              setExcelDirty(true);
            }
          },
        }}
      />

      {/* Toolbar expand handle when collapsed */}
      {toolbarCollapsed && (
        <button
          onClick={() => setToolbarCollapsed(false)}
          className="h-5 bg-bg-surface border-b border-border flex items-center justify-center text-text-muted hover:text-text-secondary hover:bg-bg-sunken transition-fast shrink-0"
          title="Show toolbar"
        >
          <svg width="20" height="4" viewBox="0 0 20 4">
            <circle cx="4" cy="2" r="1.5" fill="currentColor" />
            <circle cx="10" cy="2" r="1.5" fill="currentColor" />
            <circle cx="16" cy="2" r="1.5" fill="currentColor" />
          </svg>
        </button>
      )}

      {/* Formula Bar */}
      <ExcelFormulaBar
        cellRef={activeCellRef}
        cellContent={activeCellContent}
        onContentChange={handleFormulaChange}
        onContentSubmit={handleFormulaSubmit}
        onContentCancel={handleFormulaCancel}
      />

      {/* FortuneSheet Grid — fills remaining space */}
      <div className="flex-1 min-h-0 fortune-sheet-wrapper relative">
        <Workbook
          ref={workbookRef}
          data={fortuneSheetData}
          onChange={handleSheetChange}
          hooks={workbookHooks}
          showToolbar={false}
          showFormulaBar={false}
          showSheetTabs={false}
          lang="en"
        />
      </div>

      {/* Sheet Tabs + Status Bar */}
      <ExcelSheetTabs
        sheets={sheetTabs}
        onSwitchSheet={handleSwitchSheet}
        onAddSheet={handleAddSheet}
        onRenameSheet={handleRenameSheet}
        onDeleteSheet={handleDeleteSheet}
        onDuplicateSheet={handleDuplicateSheet}
      />

      <ExcelStatusBar
        selectionSummary={selectionSummary}
        cellPosition={cellPosition}
        sheetInfo={`Sheet ${activeSheetIndex + 1} of ${sheetTabs.length || 1}`}
      />

      {/* Chart Dialog */}
      <ExcelChartDialog
        isOpen={chartDialogOpen}
        onClose={() => setChartDialogOpen(false)}
        onInsertChart={handleInsertChart}
        sheetIndex={activeSheetIndex}
      />
    </div>
  );
}

export default ExcelEditorScreen;
