import { registerFileHandlers } from './file.handler';
import { registerScannerHandlers } from './scanner.handler';
import { registerPdfHandlers } from './pdf.handler';
import { registerOutputHandlers } from './output.handler';
import { registerSystemHandlers } from './system.handler';
import { registerDocumentHandlers } from './document.handler';

/**
 * Register all IPC handlers
 * Called once during app initialization
 */
export function registerIpcHandlers(): void {
  registerFileHandlers();
  registerScannerHandlers();
  registerPdfHandlers();
  registerOutputHandlers();
  registerSystemHandlers();
  registerDocumentHandlers();
  
  console.log('All IPC handlers registered');
}
