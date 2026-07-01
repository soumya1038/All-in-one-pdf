import { CheckCircle2, FolderOpen, FileText, Home } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import Button from '../components/ui/Button';
import { formatFileSize } from '../utils/formatFileSize';

function SuccessScreen() {
  const outputOptions = useAppStore((state) => state.outputOptions);
  const documents = useAppStore((state) => state.documents);
  const clearDocuments = useAppStore((state) => state.clearDocuments);
  const setView = useAppStore((state) => state.setView);

  // Read actual output info from processingStatus (set by ProcessingScreen after IPC completes)
  const processingStatus = useAppStore((state) => state.processingStatus);
  const outputPath = processingStatus?.outputPath || '';
  const outputSize = processingStatus?.outputSize ?? 0;

  // Derive display filename from the real saved path
  const outputFilename = outputPath
    ? outputPath.split(/[\\/]/).pop() || outputPath
    : `${outputOptions.filename}.${outputOptions.format.toLowerCase()}`;

  const handleOpenFile = async () => {
    if (!outputPath) {
      toast.error('Output file path not available');
      return;
    }
    const result = await window.electron.openFile(outputPath);
    if (!result.success) {
      toast.error('Failed to open file: ' + result.error.message);
    }
  };

  const handleOpenFolder = async () => {
    if (!outputPath) {
      toast.error('Output file path not available');
      return;
    }
    // Pass the full file path — system.handler will use showItemInFolder(filePath)
    const result = await window.electron.openFolder(outputPath);
    if (!result.success) {
      toast.error('Failed to open folder: ' + result.error.message);
    }
  };

  const handleStartNew = async () => {
    for (const doc of documents) {
      await window.electron.deleteFile(doc.id).catch(() => {});
    }
    clearDocuments();
    setView(AppView.HOME);
  };

  return (
    <div className="h-full flex items-center justify-center p-12">
      <div className="w-full max-w-2xl">
        <div className="bg-bg-surface rounded-xl border border-border p-12 text-center space-y-8 animate-fade-in">
          {/* Success Icon */}
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-success-light flex items-center justify-center">
              <CheckCircle2 size={48} className="text-success" />
            </div>
          </div>

          {/* Message */}
          <div>
            <h1 className="text-2xl font-semibold text-text-primary mb-2">
              Documents Processed Successfully!
            </h1>
            <p className="text-text-secondary">
              Your documents have been processed and saved
            </p>
          </div>

          {/* File Info */}
          <div className="bg-bg-sunken rounded-md p-6 space-y-3 text-left">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-text-secondary shrink-0">Output File</span>
              <span className="text-sm font-medium text-text-primary font-mono truncate" title={outputFilename}>
                {outputFilename}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">File Size</span>
              <span className="text-sm font-medium text-text-primary font-mono">
                {outputSize > 0 ? formatFileSize(outputSize) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Format</span>
              <span className="text-sm font-medium text-text-primary">
                {outputOptions.format}
              </span>
            </div>
            {outputPath && (
              <div className="flex items-start justify-between gap-4 pt-2 border-t border-border">
                <span className="text-sm text-text-secondary shrink-0">Location</span>
                <span
                  className="text-sm font-medium text-text-primary font-mono truncate text-right"
                  title={outputPath}
                >
                  {outputPath}
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <Button
              variant="primary"
              size="lg"
              onClick={handleOpenFile}
              fullWidth
              disabled={!outputPath}
            >
              <FileText size={20} />
              Open File
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={handleOpenFolder}
              fullWidth
              disabled={!outputPath}
            >
              <FolderOpen size={20} />
              Show in Explorer
            </Button>
          </div>

          {/* Start New */}
          <div className="pt-4 border-t border-border">
            <Button variant="ghost" onClick={handleStartNew}>
              <Home size={16} />
              Start New Session
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SuccessScreen;
