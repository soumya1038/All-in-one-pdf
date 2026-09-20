import { ipcMain } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { Result, ErrorCode } from '../../../src/types/Error.types';
import { WorkbookData } from '../../../src/types/Excel.types';
import { ExcelService } from '../services/excel.service';

const excelService = new ExcelService();

/**
 * Register Excel-related IPC handlers
 */
export function registerExcelHandlers(): void {
  /**
   * Handle opening a spreadsheet file
   */
  ipcMain.handle(IpcChannel.EXCEL_OPEN, async (_, filePath: string) => {
    try {
      return await excelService.openWorkbook(filePath);
    } catch (error) {
      const result: Result<WorkbookData> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to open spreadsheet',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });

  /**
   * Handle saving a spreadsheet
   */
  ipcMain.handle(
    IpcChannel.EXCEL_SAVE,
    async (_, { workbookData, targetPath, format }: { workbookData: WorkbookData; targetPath?: string; format?: string }) => {
      try {
        return await excelService.saveWorkbook(workbookData, targetPath, (format as 'xlsx' | 'csv' | 'pdf') || 'xlsx');
      } catch (error) {
        const result: Result<string> = {
          success: false,
          error: {
            code: ErrorCode.SAVE_FAILED,
            message: 'Failed to save spreadsheet',
            detail: error instanceof Error ? error.message : 'Unknown error',
            recoverable: true,
          },
        };
        return result;
      }
    }
  );

  /**
   * Handle exporting spreadsheet to PDF
   */
  ipcMain.handle(IpcChannel.EXCEL_EXPORT_PDF, async (_, workbookData: WorkbookData) => {
    try {
      return await excelService.exportToPdf(workbookData);
    } catch (error) {
      const result: Result<string> = {
        success: false,
        error: {
          code: ErrorCode.SAVE_FAILED,
          message: 'Failed to export to PDF',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });

  /**
   * Handle printing a spreadsheet
   */
  ipcMain.handle(IpcChannel.EXCEL_PRINT, async () => {
    try {
      return await excelService.printWorkbook();
    } catch (error) {
      const result: Result<void> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to print spreadsheet',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });

  /**
   * Handle creating a new blank workbook
   */
  ipcMain.handle(IpcChannel.EXCEL_NEW, async () => {
    try {
      return excelService.createBlankWorkbook();
    } catch (error) {
      const result: Result<WorkbookData> = {
        success: false,
        error: {
          code: ErrorCode.UNKNOWN_ERROR,
          message: 'Failed to create new workbook',
          detail: error instanceof Error ? error.message : 'Unknown error',
          recoverable: true,
        },
      };
      return result;
    }
  });

  /**
   * Handle auto-saving workbook to temp directory
   */
  ipcMain.handle(
    IpcChannel.EXCEL_AUTO_SAVE,
    async (_, { workbookData, sessionId }: { workbookData: WorkbookData; sessionId: string }) => {
      try {
        return await excelService.autoSave(workbookData, sessionId);
      } catch (error) {
        const result: Result<void> = {
          success: false,
          error: {
            code: ErrorCode.SAVE_FAILED,
            message: 'Auto-save failed',
            detail: error instanceof Error ? error.message : 'Unknown error',
            recoverable: true,
          },
        };
        return result;
      }
    }
  );
}
