/**
 * Supported spreadsheet file formats
 */
export type SpreadsheetFormat = 'xlsx' | 'xls' | 'csv' | 'ods';

/**
 * Excel export target formats
 */
export type ExcelExportFormat = 'xlsx' | 'csv' | 'pdf';

/**
 * Represents a single sheet's data as loaded from the backend
 * Compatible with FortuneSheet's sheet data format
 */
export interface SheetData {
  id?: string;
  name: string;
  index?: number;
  order?: number;
  celldata: CellData[];      // FortuneSheet cell data format
  config?: SheetConfig;       // Column widths, row heights, merges, borders
  frozen?: FreezeConfig;      // Freeze pane configuration
  row?: number;               // Total rows
  column?: number;            // Total columns
  status?: number;            // 0 = hidden, 1 = visible/active
  data?: (CellValue | null)[][]; // FortuneSheet 2D cell matrix
}

/**
 * Individual cell data in FortuneSheet format
 */
export interface CellData {
  r: number;   // Row index (0-based)
  c: number;   // Column index (0-based)
  v: CellValue | null;
}

/**
 * Cell value with formatting metadata
 * FortuneSheet-compatible cell value structure
 */
export interface CellValue {
  v?: string | number | boolean;          // Raw value
  m?: string | number;                    // Display value (formatted string)
  f?: string;                             // Formula string (e.g., "=SUM(A1:A10)")
  ct?: CellType;                          // Cell type (format)
  bg?: string;                            // Background color
  fc?: string;                            // Font color
  ff?: string | number;                   // Font family (index or name)
  fs?: number;                            // Font size
  bl?: 0 | 1;                             // Bold (0=off, 1=on)
  it?: 0 | 1;                             // Italic
  un?: 0 | 1;                             // Underline
  cl?: 0 | 1;                             // Strikethrough
  ht?: 0 | 1 | 2;                         // Horizontal align (0=center, 1=left, 2=right)
  vt?: 0 | 1 | 2;                         // Vertical align (0=middle, 1=top, 2=bottom)
  tb?: 0 | 1 | 2;                         // Text wrap (0=overflow, 1=wrap, 2=clip)
  tr?: 0 | 1 | 2 | 3 | 4 | 5;           // Text rotation
  mc?: MergeCellConfig;                    // Merge config (only on top-left cell)
}

/**
 * Cell type (number format)
 */
export interface CellType {
  fa: string;  // Format string (e.g., "General", "#,##0.00", "yyyy-MM-dd")
  t: string;   // Type: 'g' (general), 'n' (number), 's' (string), 'd' (date), 'b' (boolean)
}

/**
 * Merge cell configuration
 */
export interface MergeCellConfig {
  r: number;   // Top-left row
  c: number;   // Top-left column
  rs: number;  // Row span
  cs: number;  // Column span
}

/**
 * Sheet configuration (widths, heights, merges, borders)
 */
export interface SheetConfig {
  columnlen?: Record<number, number>;     // Column widths: { columnIndex: widthInPx }
  rowlen?: Record<number, number>;        // Row heights: { rowIndex: heightInPx }
  merge?: Record<string, MergeCellConfig>; // Merged cells: { "r_c": config }
  borderInfo?: BorderInfo[];              // Border styling
  authority?: Record<string, unknown>;    // Cell protection
}

/**
 * Border info for cells
 */
export interface BorderInfo {
  rangeType: 'range' | 'cell';
  borderType: 'border-all' | 'border-top' | 'border-bottom' | 'border-left' | 'border-right' |
              'border-outside' | 'border-inside' | 'border-horizontal' | 'border-vertical' | 'border-none';
  color: string;
  style: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
  range: Array<{ row: number[]; column: number[] }>;
}

/**
 * Freeze pane configuration
 */
export interface FreezeConfig {
  type: 'row' | 'column' | 'both' | 'rangeRow' | 'rangeColumn' | 'rangeBoth';
  range?: {
    row_focus: number;     // Row index to freeze at
    column_focus: number;  // Column index to freeze at
  };
}

/**
 * Chart configuration (serializable)
 */
export interface ChartConfig {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter' | 'radar';
  title: string;
  dataRange: string;          // e.g., "A1:D10"
  sheetIndex: number;         // Which sheet the data comes from
  position: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  options?: Record<string, unknown>;
}

/**
 * Full workbook data transferred between main ↔ renderer
 */
export interface WorkbookData {
  sheets: SheetData[];
  activeSheetIndex: number;
  charts?: ChartConfig[];
  metadata?: WorkbookMetadata;
}

/**
 * Workbook file metadata
 */
export interface WorkbookMetadata {
  filename: string;
  format: SpreadsheetFormat;
  filePath?: string;
  lastModified?: number;
  fileSize?: number;
  charts?: ChartConfig[];
}

/**
 * Excel file save request (renderer → main)
 */
export interface ExcelSaveRequest {
  workbookData: WorkbookData;
  targetPath?: string;         // If undefined, show Save As dialog
  format: ExcelExportFormat;
}

/**
 * Excel editor state managed in the Zustand store
 */
export interface ExcelEditorState {
  isOpen: boolean;
  filePath?: string;           // Source file path (undefined for new workbook)
  workbookData: WorkbookData | null;
  isDirty: boolean;            // Has unsaved changes
  lastSavedAt?: number;        // Timestamp of last save
  isLoading: boolean;
  error?: string;
  autoSaveSessionId?: string;  // Session ID for auto-save
}

/**
 * Default initial state for the Excel editor
 */
export const DEFAULT_EXCEL_EDITOR_STATE: ExcelEditorState = {
  isOpen: false,
  workbookData: null,
  isDirty: false,
  isLoading: false,
};
