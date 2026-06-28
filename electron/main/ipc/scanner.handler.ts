import { ipcMain } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { ScannerService } from '../services/scanner.service';

const scannerService = new ScannerService();

/**
 * Register scanner-related IPC handlers
 */
export function registerScannerHandlers(): void {
  /**
   * List available scanners
   */
  ipcMain.handle(IpcChannel.SCANNER_LIST, async () => {
    return await scannerService.listDevices();
  });

  /**
   * Check if scanner is available
   */
  ipcMain.handle(IpcChannel.SCANNER_CHECK, async (_, deviceId: string) => {
    return await scannerService.checkDevice(deviceId);
  });

  /**
   * Perform scan
   */
  ipcMain.handle(IpcChannel.SCANNER_SCAN, async (_, { deviceId, settings }) => {
    return await scannerService.scan(deviceId, settings);
  });
}
