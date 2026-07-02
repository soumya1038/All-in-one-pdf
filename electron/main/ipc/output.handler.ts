import { ipcMain } from 'electron';
import { IpcChannel } from '../../../src/types/IPC.types';
import { OutputService } from '../services/output.service';

const outputService = new OutputService();

/**
 * Register output-related IPC handlers
 */
export function registerOutputHandlers(): void {
  /**
   * Process output with all options
   */
  ipcMain.handle(IpcChannel.OUTPUT_PROCESS, async (_, { documentIds, options }) => {
    return await outputService.process(documentIds, options);
  });

  /**
   * Estimate compressed image size
   */
  ipcMain.handle(IpcChannel.IMAGE_ESTIMATE_SIZE, async (_, { documentId, targetSize, format }) => {
    return await outputService.estimateCompressedSize(documentId, targetSize, format);
  });

  /**
   * Save output to specified path
   */
  ipcMain.handle(IpcChannel.OUTPUT_SAVE, async (_, outputPath: string) => {
    return await outputService.save(outputPath);
  });
}
