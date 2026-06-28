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

  // Get output path from recent files (last added)
  const recentFiles = useAppStore((state) => state.recentFiles);
  const lastFile = recentFiles[0];
  
  const outputPath = lastFile?.path || '';
  // Extract filename from path (works on Windows paths)
  const outputFilename = outputPath ? outputPath.split('\\').pop() || outputPath.split('/').pop() || outputPath : `${outputOptions.filename}.${outputOptions.format.toLowerCase()}`;
  const outputSize = documents.reduce((sum, doc) => sum + doc.size, 0); // Approximate

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
    
    // Extract folder path (works on Windows paths)
    const lastSlash = Math.max(outputPath.lastIndexOf('\\'), outputPath.lastIndexOf('/'));
    const folderPath = lastSlash > 0 ? outputPath.substring(0, lastSlash) : outputPath;
    
    const result = await window.electron.openFolder(folderPath);
    if (!result.success) {
      toast.error('Failed to open folder: ' + result.error.message);
    }
  };

  const handleStartNew = async () => {
    // Clear all documents
    for (const doc of documents) {
      await window.electron.deleteFile(doc.id);
    }
    clearDocuments();
    setView(AppView.HOME);
  };

  return (
    <div className="h-full flex items-center justify-center p-12">
      <div className="w-full max-w-2xl">
        <div className="bg-bg-surface rounded-xl border border-border p-12 text-center space-y-8">
          {/* Success Icon */}
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center">
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
          <div className="bg-bg-sunken rounded-md p-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Output File</span>
              <span className="text-sm font-medium text-text-primary font-mono">
                {outputFilename}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">File Size</span>
              <span className="text-sm font-medium text-text-primary font-mono">
                {formatFileSize(outputSize)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Format</span>
              <span className="text-sm font-medium text-text-primary">
                {outputOptions.format}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Location</span>
              <span className="text-sm font-medium text-text-primary font-mono truncate max-w-md" title={outputPath}>
                {outputPath}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <Button variant="primary" size="lg" onClick={handleOpenFile} fullWidth>
              <FileText size={20} />
              Open File
            </Button>
            <Button variant="secondary" size="lg" onClick={handleOpenFolder} fullWidth>
              <FolderOpen size={20} />
              Open Folder
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
