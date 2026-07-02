import { useEffect } from 'react';
import { Clock, FolderOpen, X } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { WorkflowType } from '../types/UI.types';
import { useFileUpload } from '../hooks/useFileUpload';
import { LoadingOverlay } from '../components/ui/Spinner';
import DragDropZone from '../components/ui/DragDropZone';
import Button from '../components/ui/Button';

function HomeScreen() {
  const { uploadFiles, isUploading } = useFileUpload();
  const recentFiles = useAppStore((state) => state.recentFiles);
  const setRecentFiles = useAppStore((state) => state.setRecentFiles);
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);
  const setActiveWorkflow = useAppStore((state) => state.setActiveWorkflow);

  // Load recent files on mount
  useEffect(() => {
    const loadRecentFiles = async () => {
      const result = await window.electron.getRecentFiles();
      if (result.success) {
        setRecentFiles(result.data);
      }
    };
    loadRecentFiles();
  }, [setRecentFiles]);

  const handleBrowseClick = async () => {
    try {
      let properties: ('openFile' | 'multiSelections')[] = ['openFile', 'multiSelections'];
      let extensions = ['pdf', 'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt'];
      let name = 'Documents';

      if (activeWorkflow === WorkflowType.COMPRESS || activeWorkflow === WorkflowType.SPLIT || activeWorkflow === WorkflowType.PROTECT) {
        properties = ['openFile'];
        extensions = ['pdf'];
        name = 'PDF Documents';
      } else if (activeWorkflow === WorkflowType.MERGE) {
        properties = ['openFile', 'multiSelections'];
        extensions = ['pdf'];
        name = 'PDF Documents';
      } else if (activeWorkflow === WorkflowType.CONVERT) {
        properties = ['openFile'];
        extensions = ['pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp'];
        name = 'Supported Files';
      }

      const result = await window.electron.showOpenDialog({
        properties,
        filters: [
          { name, extensions }
        ]
      });

      if (result.success && result.data && result.data.length > 0) {
        // Create mock File objects with just the path for uploadFiles
        const filesToUpload = result.data.map(path => {
          const file = new File([], path.split(/[\\/]/).pop() || '');
          Object.defineProperty(file, 'path', { value: path });
          return file;
        });
        
        uploadFiles(filesToUpload);
      }
    } catch (error) {
      console.error('Failed to open native dialog', error);
    }
  };

  const handleRecentFileClick = async (filePath: string) => {
    // Try to open the file
    const result = await window.electron.openFile(filePath);
    if (!result.success) {
      // If file doesn't exist, remove from recent files persistently
      await window.electron.removeRecentFile(filePath).catch(() => {});
      const updatedRecent = recentFiles.filter((f) => f.path !== filePath);
      setRecentFiles(updatedRecent);
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getHeroContent = () => {
    switch (activeWorkflow) {
      case WorkflowType.COMPRESS:
        return {
          title: 'Compress PDF',
          subtitle: 'Upload or drop exactly one PDF file to reduce its size'
        };
      case WorkflowType.MERGE:
        return {
          title: 'Merge PDFs',
          subtitle: 'Upload or drop multiple PDF files to merge into a single PDF document'
        };
      case WorkflowType.CONVERT:
        return {
          title: 'Convert PDF',
          subtitle: 'Upload or drop a PDF or image file to convert it to another format'
        };
      case WorkflowType.SPLIT:
        return {
          title: 'Split PDF',
          subtitle: 'Upload or drop exactly one PDF file to split it into multiple parts'
        };
      case WorkflowType.PROTECT:
        return {
          title: 'Protect PDF',
          subtitle: 'Upload or drop exactly one PDF file to secure it with password protection'
        };
      default:
        return {
          title: 'Welcome to DocuFlow',
          subtitle: 'Upload your documents to get started with merging, compressing, converting, and more'
        };
    }
  };

  const { title: heroTitle, subtitle: heroSubtitle } = getHeroContent();

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {isUploading && <LoadingOverlay message="Uploading files..." />}
 
       <div className="flex-1 flex items-center justify-center p-12">
         <div className="w-full max-w-2xl">
           {/* Hero Section */}
           <div className="text-center mb-8">
             <h1 className="text-2xl font-bold text-text-primary mb-2">
               {heroTitle}
             </h1>
             <p className="text-text-secondary">
               {heroSubtitle}
             </p>
           </div>
 
           {/* Upload Zone */}
           <DragDropZone onFilesDropped={uploadFiles} disabled={isUploading} />
 
           {/* Or Browse Button */}
           <div className="mt-6 flex justify-center gap-3">
             <Button
               variant="secondary"
               size="lg"
               onClick={handleBrowseClick}
               disabled={isUploading}
             >
               <FolderOpen size={20} />
               Browse Files
             </Button>
             {activeWorkflow !== WorkflowType.NONE && (
               <Button
                 variant="ghost"
                 size="lg"
                 onClick={() => setActiveWorkflow(WorkflowType.NONE)}
                 disabled={isUploading}
               >
                 <X size={16} className="mr-2" />
                 Cancel
               </Button>
             )}
           </div>

        </div>
      </div>

      {/* Recent Files Section */}
      {recentFiles.length > 0 && (
        <div className="border-t border-border bg-bg-surface">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={16} className="text-text-secondary" />
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
                Recent Files
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentFiles.map((file, index) => (
                <button
                  key={index}
                  onClick={() => handleRecentFileClick(file.path)}
                  className="flex items-start gap-3 p-3 text-left rounded-md border border-border hover:border-accent hover:bg-accent-light/50 transition-fast group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate group-hover:text-accent transition-fast">
                      {file.filename}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-text-secondary">
                        {file.operation}
                      </span>
                      <span className="text-xs text-text-muted">•</span>
                      <span className="text-xs text-text-muted">
                        {formatTimestamp(file.timestamp)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HomeScreen;
