import { readFile, writeFile } from 'fs/promises';
import { basename, extname, join } from 'path';
import { dialog, BrowserWindow } from 'electron';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import {
  WorkbookData,
  SheetData,
  CellData,
  CellValue,
  SheetConfig,
  MergeCellConfig,
  ExcelExportFormat,
} from '../../../src/types/Excel.types';
import { getTempDir } from '../utils/tempDir';

/**
 * Default dimensions for new blank workbooks
 */
const DEFAULT_ROW_COUNT = 1000;
const DEFAULT_COL_COUNT = 26;

/**
 * Service for all Excel/spreadsheet file I/O operations.
 * Uses ExcelJS for .xlsx read/write and SheetJS (xlsx) for .xls/.ods parsing.
 */
export class ExcelService {
  /**
   * Open and parse a spreadsheet file into WorkbookData format.
   * Supports .xlsx, .xls, .csv, .ods
   */
  async openWorkbook(filePath: string): Promise<Result<WorkbookData>> {
    try {
      const ext = extname(filePath).toLowerCase();
      const filename = basename(filePath);

      let workbookData: WorkbookData;

      if (ext === '.xlsx') {
        workbookData = await this.parseXlsx(filePath);
      } else if (ext === '.csv') {
        workbookData = await this.parseCsv(filePath);
      } else if (ext === '.xls' || ext === '.ods') {
        workbookData = await this.parseLegacyFormat(filePath, ext);
      } else {
        return {
          success: false,
          error: {
            code: ErrorCode.FILE_UNSUPPORTED,
            message: `Unsupported spreadsheet format: ${ext}`,
            recoverable: false,
          },
        };
      }

      // Attach metadata
      workbookData.metadata = {
        filename,
        format: ext.replace('.', '') as WorkbookData['metadata'] extends { format: infer F } ? F : never,
        filePath,
        lastModified: Date.now(),
      };

      return { success: true, data: workbookData };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to open spreadsheet',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Parse .xlsx file using ExcelJS
   */
  private async parseXlsx(filePath: string): Promise<WorkbookData> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets: SheetData[] = [];
    let sheetIndex = 0;

    workbook.eachSheet((worksheet, _sheetId) => {
      const celldata: CellData[] = [];
      const config: SheetConfig = {
        columnlen: {},
        rowlen: {},
        merge: {},
        borderInfo: [],
      };

      // Extract column widths
      worksheet.columns.forEach((col, colIndex) => {
        if (col.width && config.columnlen) {
          // ExcelJS width is in characters, convert to pixels (~7.5px per char)
          config.columnlen[colIndex] = Math.round((col.width || 8.43) * 7.5);
        }
      });

      // Iterate over rows
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const r = rowNumber - 1; // Convert to 0-based

        // Extract row height
        if (row.height && config.rowlen) {
          config.rowlen[r] = row.height;
        }

        // Iterate over cells
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const c = colNumber - 1; // Convert to 0-based
          const cellValue = this.excelJsCellToFortuneSheet(cell);

          if (cellValue) {
            celldata.push({ r, c, v: cellValue });
          }
        });
      });

      // Extract merged cells
      const merges = worksheet.model.merges || [];
      for (const mergeRange of merges) {
        const decoded = this.decodeMergeRange(mergeRange);
        if (decoded && config.merge) {
          const key = `${decoded.r}_${decoded.c}`;
          config.merge[key] = decoded;
        }
      }

      // Determine row/col counts
      const rowCount = Math.max(worksheet.rowCount, DEFAULT_ROW_COUNT);
      const colCount = Math.max(worksheet.columnCount, DEFAULT_COL_COUNT);

      sheets.push({
        id: String(sheetIndex),
        name: worksheet.name,
        index: sheetIndex,
        order: sheetIndex,
        celldata,
        config,
        row: rowCount,
        column: colCount,
        status: sheetIndex === 0 ? 1 : 0,
      });

      sheetIndex++;
    });

    // Ensure at least one sheet
    if (sheets.length === 0) {
      sheets.push(this.createBlankSheet('Sheet1', 0));
    }

    return {
      sheets,
      activeSheetIndex: 0,
    };
  }

  /**
   * Parse CSV file
   */
  private async parseCsv(filePath: string): Promise<WorkbookData> {
    const workbook = new ExcelJS.Workbook();
    const content = await readFile(filePath, 'utf-8');

    // Use ExcelJS CSV parser
    const worksheet = await workbook.csv.read(
      // Create a readable stream from the content
      require('stream').Readable.from([content])
    );

    const celldata: CellData[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const r = rowNumber - 1;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const c = colNumber - 1;
        const value = cell.value;

        const cellValue: CellValue = {
          v: value !== null && value !== undefined ? String(value) : '',
          m: value !== null && value !== undefined ? String(value) : '',
          ct: { fa: 'General', t: 'g' },
        };

        // Try to detect numbers
        if (typeof value === 'number' || (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '')) {
          cellValue.v = Number(value);
          cellValue.m = String(value);
          cellValue.ct = { fa: 'General', t: 'n' };
        }

        celldata.push({ r, c, v: cellValue });
      });
    });

    const rowCount = Math.max(worksheet.rowCount, DEFAULT_ROW_COUNT);
    const colCount = Math.max(worksheet.columnCount, DEFAULT_COL_COUNT);

    const sheet: SheetData = {
      id: '0',
      name: basename(filePath, extname(filePath)),
      index: 0,
      order: 0,
      celldata,
      config: { columnlen: {}, rowlen: {}, merge: {} },
      row: rowCount,
      column: colCount,
      status: 1,
    };

    return {
      sheets: [sheet],
      activeSheetIndex: 0,
    };
  }

  /**
   * Parse .xls and .ods files using SheetJS (xlsx package)
   */
  private async parseLegacyFormat(filePath: string, _ext: string): Promise<WorkbookData> {
    const buffer = await readFile(filePath);
    const sheetJsWorkbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true, cellFormula: true });

    const sheets: SheetData[] = [];

    sheetJsWorkbook.SheetNames.forEach((sheetName, index) => {
      const worksheet = sheetJsWorkbook.Sheets[sheetName];
      const celldata: CellData[] = [];
      const config: SheetConfig = { columnlen: {}, rowlen: {}, merge: {} };

      // Parse cell data
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellAddress = XLSX.utils.encode_cell({ r, c });
          const cell = worksheet[cellAddress];

          if (cell) {
            const cellValue: CellValue = {
              v: cell.v !== undefined ? cell.v : null,
              m: cell.w || (cell.v !== undefined ? String(cell.v) : ''),
              ct: { fa: 'General', t: this.sheetJsTypeToFortuneSheet(cell.t) },
            };

            // Formula
            if (cell.f) {
              cellValue.f = `=${cell.f}`;
            }

            // Style (basic)
            if (cell.s) {
              if (cell.s.font) {
                if (cell.s.font.bold) cellValue.bl = 1;
                if (cell.s.font.italic) cellValue.it = 1;
                if (cell.s.font.underline) cellValue.un = 1;
                if (cell.s.font.sz) cellValue.fs = cell.s.font.sz;
                if (cell.s.font.color?.rgb) cellValue.fc = `#${cell.s.font.color.rgb}`;
              }
              if (cell.s.fill?.fgColor?.rgb) {
                cellValue.bg = `#${cell.s.fill.fgColor.rgb}`;
              }
            }

            celldata.push({ r, c, v: cellValue });
          }
        }
      }

      // Parse merged cells
      if (worksheet['!merges']) {
        for (const merge of worksheet['!merges']) {
          const mergeConfig: MergeCellConfig = {
            r: merge.s.r,
            c: merge.s.c,
            rs: merge.e.r - merge.s.r + 1,
            cs: merge.e.c - merge.s.c + 1,
          };
          if (config.merge) {
            config.merge[`${mergeConfig.r}_${mergeConfig.c}`] = mergeConfig;
          }
        }
      }

      // Parse column widths
      if (worksheet['!cols']) {
        worksheet['!cols'].forEach((col: XLSX.ColInfo, colIdx: number) => {
          if (col && col.wpx && config.columnlen) {
            config.columnlen[colIdx] = col.wpx;
          }
        });
      }

      // Parse row heights
      if (worksheet['!rows']) {
        worksheet['!rows'].forEach((row: XLSX.RowInfo, rowIdx: number) => {
          if (row && row.hpx && config.rowlen) {
            config.rowlen[rowIdx] = row.hpx;
          }
        });
      }

      const rowCount = Math.max(range.e.r + 1, DEFAULT_ROW_COUNT);
      const colCount = Math.max(range.e.c + 1, DEFAULT_COL_COUNT);

      sheets.push({
        id: String(index),
        name: sheetName,
        index,
        order: index,
        celldata,
        config,
        row: rowCount,
        column: colCount,
        status: index === 0 ? 1 : 0,
      });
    });

    if (sheets.length === 0) {
      sheets.push(this.createBlankSheet('Sheet1', 0));
    }

    return {
      sheets,
      activeSheetIndex: 0,
    };
  }

  /**
   * Save workbook data to file.
   * If targetPath is not provided, shows a Save As dialog.
   */
  async saveWorkbook(
    workbookData: WorkbookData,
    targetPath?: string,
    format: ExcelExportFormat = 'xlsx'
  ): Promise<Result<string>> {
    try {
      // If no target path, show Save As dialog
      if (!targetPath) {
        const defaultFilename = workbookData.metadata?.filename || 'Workbook';
        const baseName = defaultFilename.replace(/\.[^/.]+$/, '');

        const filters = format === 'csv'
          ? [{ name: 'CSV Files', extensions: ['csv'] }]
          : [{ name: 'Excel Workbook', extensions: ['xlsx'] }];

        const mainWindow = BrowserWindow.getFocusedWindow();
        const result = await dialog.showSaveDialog(mainWindow!, {
          defaultPath: `${baseName}.${format}`,
          filters,
        });

        if (result.canceled || !result.filePath) {
          return {
            success: false,
            error: {
              code: ErrorCode.SAVE_FAILED,
              message: 'Save cancelled by user',
              recoverable: true,
            },
          };
        }

        targetPath = result.filePath;
      }

      if (format === 'csv') {
        await this.saveToCsv(workbookData, targetPath);
      } else {
        await this.saveToXlsx(workbookData, targetPath);
      }

      return { success: true, data: targetPath };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.SAVE_FAILED,
          message: 'Failed to save spreadsheet',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Save workbook to .xlsx format using ExcelJS
   */
  private async saveToXlsx(workbookData: WorkbookData, targetPath: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();

    for (const sheet of workbookData.sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);

      // Apply cell data
      for (const cell of sheet.celldata) {
        if (!cell.v) continue;

        const excelRow = cell.r + 1; // ExcelJS is 1-based
        const excelCol = cell.c + 1;

        const excelCell = worksheet.getCell(excelRow, excelCol);

        // Set value or formula
        if (cell.v.f) {
          // Strip leading '=' for ExcelJS formula format
          const formula = cell.v.f.startsWith('=') ? cell.v.f.slice(1) : cell.v.f;
          excelCell.value = { formula, result: cell.v.v as number | string | undefined };
        } else if (cell.v.v !== null && cell.v.v !== undefined) {
          excelCell.value = cell.v.v;
        }

        // Apply styling
        const font: Partial<ExcelJS.Font> = {};
        if (cell.v.bl === 1) font.bold = true;
        if (cell.v.it === 1) font.italic = true;
        if (cell.v.un === 1) font.underline = true;
        if (cell.v.cl === 1) font.strike = true;
        if (cell.v.fs) font.size = cell.v.fs;
        if (cell.v.fc) font.color = { argb: this.cssColorToArgb(cell.v.fc) };
        if (cell.v.ff) font.name = typeof cell.v.ff === 'string' ? cell.v.ff : undefined;

        if (Object.keys(font).length > 0) {
          excelCell.font = font;
        }

        // Background color
        if (cell.v.bg) {
          excelCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: this.cssColorToArgb(cell.v.bg) },
          };
        }

        // Alignment
        const alignment: Partial<ExcelJS.Alignment> = {};
        if (cell.v.ht !== undefined) {
          alignment.horizontal = cell.v.ht === 1 ? 'left' : cell.v.ht === 2 ? 'right' : 'center';
        }
        if (cell.v.vt !== undefined) {
          alignment.vertical = cell.v.vt === 1 ? 'top' : cell.v.vt === 2 ? 'bottom' : 'middle';
        }
        if (cell.v.tb === 1) {
          alignment.wrapText = true;
        }

        if (Object.keys(alignment).length > 0) {
          excelCell.alignment = alignment;
        }
      }

      // Apply column widths
      if (sheet.config?.columnlen) {
        for (const [colIdx, width] of Object.entries(sheet.config.columnlen)) {
          const col = worksheet.getColumn(Number(colIdx) + 1);
          // Convert pixels back to characters (~7.5px per char)
          col.width = Math.round(width / 7.5);
        }
      }

      // Apply row heights
      if (sheet.config?.rowlen) {
        for (const [rowIdx, height] of Object.entries(sheet.config.rowlen)) {
          const row = worksheet.getRow(Number(rowIdx) + 1);
          row.height = height;
        }
      }

      // Apply merged cells
      if (sheet.config?.merge) {
        for (const merge of Object.values(sheet.config.merge)) {
          const startRow = merge.r + 1;
          const startCol = merge.c + 1;
          const endRow = merge.r + merge.rs;
          const endCol = merge.c + merge.cs;
          worksheet.mergeCells(startRow, startCol, endRow, endCol);
        }
      }
    }

    await workbook.xlsx.writeFile(targetPath);
  }

  /**
   * Save workbook to CSV format (first sheet only)
   */
  private async saveToCsv(workbookData: WorkbookData, targetPath: string): Promise<void> {
    const sheet = workbookData.sheets[0];
    if (!sheet) throw new Error('No sheets in workbook');

    // Build a 2D array from celldata
    let maxRow = 0;
    let maxCol = 0;

    for (const cell of sheet.celldata) {
      if (cell.r > maxRow) maxRow = cell.r;
      if (cell.c > maxCol) maxCol = cell.c;
    }

    const rows: string[][] = [];
    for (let r = 0; r <= maxRow; r++) {
      rows.push(new Array(maxCol + 1).fill(''));
    }

    for (const cell of sheet.celldata) {
      if (cell.v) {
        const displayValue = String(cell.v.m ?? cell.v.v ?? '');
        rows[cell.r][cell.c] = displayValue;
      }
    }

    // Convert to CSV string
    const csvContent = rows.map(row =>
      row.map(val => {
        // Escape values containing commas, quotes, or newlines
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(',')
    ).join('\n');

    await writeFile(targetPath, csvContent, 'utf-8');
  }

  /**
   * Export workbook to PDF via Electron's printToPDF
   */
  async exportToPdf(workbookData: WorkbookData): Promise<Result<string>> {
    try {
      const mainWindow = BrowserWindow.getFocusedWindow();
      if (!mainWindow) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'No active window found for PDF export',
            recoverable: true,
          },
        };
      }

      const defaultFilename = workbookData.metadata?.filename || 'Workbook';
      const baseName = defaultFilename.replace(/\.[^/.]+$/, '');

      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `${baseName}.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          error: {
            code: ErrorCode.SAVE_FAILED,
            message: 'Export cancelled by user',
            recoverable: true,
          },
        };
      }

      // Use Electron's built-in printToPDF
      const pdfData = await mainWindow.webContents.printToPDF({
        landscape: true,
        printBackground: true,
        pageSize: 'A4',
        margins: {
          marginType: 'default',
        },
      });

      await writeFile(result.filePath, pdfData);

      return { success: true, data: result.filePath };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.SAVE_FAILED,
          message: 'Failed to export to PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Print workbook via Electron's print API
   */
  async printWorkbook(): Promise<Result<void>> {
    try {
      const mainWindow = BrowserWindow.getFocusedWindow();
      if (!mainWindow) {
        return {
          success: false,
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'No active window found for printing',
            recoverable: true,
          },
        };
      }

      mainWindow.webContents.print({ silent: false }, (success, errorType) => {
        if (!success) {
          console.error('Print failed:', errorType);
        }
      });

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to print spreadsheet',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  /**
   * Create a blank workbook with a single empty sheet
   */
  createBlankWorkbook(): Result<WorkbookData> {
    const workbookData: WorkbookData = {
      sheets: [this.createBlankSheet('Sheet1', 0)],
      activeSheetIndex: 0,
      metadata: {
        filename: 'Untitled Workbook',
        format: 'xlsx',
        lastModified: Date.now(),
      },
    };

    return { success: true, data: workbookData };
  }

  /**
   * Auto-save workbook data to a temp file for crash recovery
   */
  async autoSave(workbookData: WorkbookData, sessionId: string): Promise<Result<void>> {
    try {
      const tempDir = getTempDir();
      if (!tempDir) {
        return {
          success: false,
          error: {
            code: ErrorCode.TEMP_DIR_CREATE_FAILED,
            message: 'Temp directory not available',
            recoverable: true,
          },
        };
      }

      const autoSavePath = join(tempDir, `excel_autosave_${sessionId}.json`);
      await writeFile(autoSavePath, JSON.stringify(workbookData), 'utf-8');

      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        error: {
          code: ErrorCode.SAVE_FAILED,
          message: 'Auto-save failed',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
    }
  }

  // ──────────────────────────────────────────────────────
  // Helper Methods
  // ──────────────────────────────────────────────────────

  /**
   * Create a blank sheet with default dimensions
   */
  private createBlankSheet(name: string, index: number): SheetData {
    return {
      id: String(index),
      name,
      index,
      order: index,
      celldata: [],
      config: {
        columnlen: {},
        rowlen: {},
        merge: {},
      },
      row: DEFAULT_ROW_COUNT,
      column: DEFAULT_COL_COUNT,
      status: index === 0 ? 1 : 0,
    };
  }

  /**
   * Convert an ExcelJS cell to FortuneSheet CellValue format
   */
  private excelJsCellToFortuneSheet(cell: ExcelJS.Cell): CellValue | null {
    if (cell.value === null || cell.value === undefined) return null;

    const cellValue: CellValue = {};

    // Extract value
    const rawValue = cell.value;

    if (typeof rawValue === 'object' && rawValue !== null) {
      // Handle formula cells
      if ('formula' in rawValue) {
        const formulaCell = rawValue as ExcelJS.CellFormulaValue;
        cellValue.f = `=${formulaCell.formula}`;
        cellValue.v = formulaCell.result !== undefined ? formulaCell.result as string | number : undefined;
        cellValue.m = cellValue.v !== null && cellValue.v !== undefined ? String(cellValue.v) : '';
      }
      // Handle rich text
      else if ('richText' in rawValue) {
        const richText = rawValue as ExcelJS.CellRichTextValue;
        cellValue.v = richText.richText.map(rt => rt.text).join('');
        cellValue.m = cellValue.v;
      }
      // Handle date
      else if (rawValue instanceof Date) {
        cellValue.v = rawValue.getTime();
        cellValue.m = rawValue.toLocaleDateString();
        cellValue.ct = { fa: 'yyyy-MM-dd', t: 'd' };
      }
      // Handle hyperlinks
      else if ('hyperlink' in rawValue) {
        const hyperlinkCell = rawValue as ExcelJS.CellHyperlinkValue;
        cellValue.v = hyperlinkCell.text || hyperlinkCell.hyperlink;
        cellValue.m = String(cellValue.v);
      }
      // Handle shared formula
      else if ('sharedFormula' in rawValue) {
        const sharedCell = rawValue as ExcelJS.CellSharedFormulaValue;
        cellValue.f = `=${sharedCell.sharedFormula}`;
        cellValue.v = sharedCell.result !== undefined ? sharedCell.result as string | number : undefined;
        cellValue.m = cellValue.v !== null && cellValue.v !== undefined ? String(cellValue.v) : '';
      }
      else {
        cellValue.v = String(rawValue);
        cellValue.m = String(rawValue);
      }
    } else {
      cellValue.v = rawValue as string | number | boolean;
      cellValue.m = String(rawValue);
    }

    // Determine cell type
    if (!cellValue.ct) {
      if (typeof cellValue.v === 'number') {
        cellValue.ct = { fa: 'General', t: 'n' };
      } else if (typeof cellValue.v === 'boolean') {
        cellValue.ct = { fa: 'General', t: 'b' };
      } else {
        cellValue.ct = { fa: 'General', t: 'g' };
      }
    }

    // Extract font styling
    if (cell.font) {
      if (cell.font.bold) cellValue.bl = 1;
      if (cell.font.italic) cellValue.it = 1;
      if (cell.font.underline) cellValue.un = 1;
      if (cell.font.strike) cellValue.cl = 1;
      if (cell.font.size) cellValue.fs = cell.font.size;
      if (cell.font.color?.argb) cellValue.fc = `#${cell.font.color.argb.slice(2)}`;
      if (cell.font.name) cellValue.ff = cell.font.name;
    }

    // Extract fill (background color)
    if (cell.fill && cell.fill.type === 'pattern') {
      const patternFill = cell.fill as ExcelJS.FillPattern;
      if (patternFill.fgColor?.argb) {
        cellValue.bg = `#${patternFill.fgColor.argb.slice(2)}`;
      }
    }

    // Extract alignment
    if (cell.alignment) {
      if (cell.alignment.horizontal) {
        cellValue.ht = cell.alignment.horizontal === 'left' ? 1
          : cell.alignment.horizontal === 'right' ? 2
          : 0; // center
      }
      if (cell.alignment.vertical) {
        cellValue.vt = cell.alignment.vertical === 'top' ? 1
          : cell.alignment.vertical === 'bottom' ? 2
          : 0; // middle
      }
      if (cell.alignment.wrapText) {
        cellValue.tb = 1;
      }
    }

    return cellValue;
  }

  /**
   * Decode an ExcelJS merge range string (e.g., "A1:C3") into MergeCellConfig
   */
  private decodeMergeRange(rangeStr: string): MergeCellConfig | null {
    try {
      // rangeStr is like "A1:C3"
      const parts = rangeStr.split(':');
      if (parts.length !== 2) return null;

      const start = this.cellAddressToRC(parts[0]);
      const end = this.cellAddressToRC(parts[1]);

      if (!start || !end) return null;

      return {
        r: start.r,
        c: start.c,
        rs: end.r - start.r + 1,
        cs: end.c - start.c + 1,
      };
    } catch {
      return null;
    }
  }

  /**
   * Convert cell address like "A1" to { r, c } (0-based)
   */
  private cellAddressToRC(address: string): { r: number; c: number } | null {
    const match = address.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;

    const colStr = match[1];
    const rowStr = match[2];

    let c = 0;
    for (let i = 0; i < colStr.length; i++) {
      c = c * 26 + (colStr.charCodeAt(i) - 64);
    }
    c -= 1; // 0-based

    const r = parseInt(rowStr, 10) - 1; // 0-based

    return { r, c };
  }

  /**
   * Map SheetJS cell type to FortuneSheet type string
   */
  private sheetJsTypeToFortuneSheet(type: string): string {
    switch (type) {
      case 'n': return 'n'; // number
      case 's': return 'g'; // string → general
      case 'b': return 'b'; // boolean
      case 'd': return 'd'; // date
      case 'e': return 'g'; // error → general
      default: return 'g';
    }
  }

  /**
   * Convert CSS color (e.g., "#FF0000" or "rgb(...)") to ARGB format for ExcelJS
   */
  private cssColorToArgb(color: string): string {
    if (!color) return 'FF000000';

    // Handle hex colors
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        // Expand shorthand (#RGB → AARRGGBB)
        return `FF${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
      }
      if (hex.length === 6) {
        return `FF${hex}`;
      }
      if (hex.length === 8) {
        return hex;
      }
    }

    // Default black
    return 'FF000000';
  }
}
