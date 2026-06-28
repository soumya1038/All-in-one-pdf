import { ScanLine, Minimize, Merge, ArrowRightLeft, Scissors, Lock, Loader2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../../store/appStore';
import { ModalType, AppView, WorkflowType } from '../../types/UI.types';
import { OutputFormat } from '../../types/Output.types';
import { ScannerStatus } from '../../types/Scanner.types';

interface ShortcutButton {
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  action: () => void;
}

function Sidebar() {
  const openModal = useAppStore((state) => state.openModal);
  const documents = useAppStore((state) => state.documents);
  const setView = useAppStore((state) => state.setView);
  const updateOutputOptions = useAppStore((state) => state.updateOutputOptions);
  const setActiveWorkflow = useAppStore((state) => state.setActiveWorkflow);
  
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);
  const currentView = useAppStore((state) => state.ui.currentView);
  const isLoading = useAppStore((state) => state.ui.isLoading);
  const scannerStatus = useAppStore((state) => state.scannerStatus.status);

  const isProcessing = 
    currentView === AppView.PROCESSING || 
    isLoading || 
    scannerStatus === ScannerStatus.SCANNING || 
    scannerStatus === ScannerStatus.CHECKING ||
    (activeWorkflow !== WorkflowType.NONE && documents.length > 0);

  const handleQuickActionUpload = async (workflow: WorkflowType) => {
    try {
      let properties: ('openFile' | 'multiSelections')[] = ['openFile', 'multiSelections'];
      let extensions = ['pdf', 'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt'];
      let name = 'Documents';

      if (workflow === WorkflowType.COMPRESS || workflow === WorkflowType.SPLIT || workflow === WorkflowType.PROTECT) {
        properties = ['openFile'];
        extensions = ['pdf'];
        name = 'PDF Documents';
      } else if (workflow === WorkflowType.MERGE) {
        properties = ['openFile', 'multiSelections'];
        extensions = ['pdf'];
        name = 'PDF Documents';
      } else if (workflow === WorkflowType.CONVERT) {
        properties = ['openFile'];
        extensions = ['pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp'];
        name = 'Supported Files';
      }

      // Set workflow and redirect to Home screen first
      setActiveWorkflow(workflow);
      setView(AppView.HOME);

      const result = await window.electron.showOpenDialog({
        properties,
        filters: [
          { name, extensions }
        ]
      });

      if (result.success && result.data && result.data.length > 0) {
        useAppStore.getState().setLoading(true, 'Uploading files...');
        const uploadResult = await window.electron.uploadFiles(result.data);
        useAppStore.getState().setLoading(false);

        if (uploadResult.success && uploadResult.data.length > 0) {
          useAppStore.getState().addDocuments(uploadResult.data);
          
          if (workflow === WorkflowType.COMPRESS) {
            updateOutputOptions({ format: OutputFormat.PDF });
            setView(AppView.OUTPUT_OPTIONS);
          } else if (workflow === WorkflowType.PROTECT) {
            updateOutputOptions({ format: OutputFormat.PDF, protection: { enabled: true } });
            setView(AppView.OUTPUT_OPTIONS);
          } else if (workflow === WorkflowType.CONVERT) {
            setView(AppView.OUTPUT_OPTIONS);
          } else if (workflow === WorkflowType.SPLIT) {
            updateOutputOptions({ format: OutputFormat.PDF });
            setView(AppView.OUTPUT_OPTIONS);
          } else {
            setView(AppView.DOCUMENT_LIST);
          }
          toast.success(`${uploadResult.data.length} file(s) uploaded successfully`);
        } else if (uploadResult.success) {
          toast.error('No valid files were uploaded');
        } else {
          toast.error(uploadResult.error.message);
        }
      }
    } catch (error) {
      console.error('Failed to trigger quick action dialog', error);
    }
  };

  const shortcuts: ShortcutButton[] = [
    {
      icon: <ScanLine size={20} />,
      label: 'Scan Document',
      shortcut: 'Ctrl+Shift+S',
      action: () => openModal(ModalType.SCANNER),
    },
    {
      icon: <Minimize size={20} />,
      label: 'Compress PDF',
      shortcut: 'Ctrl+Shift+C',
      action: () => {
        if (documents.length === 0) {
          handleQuickActionUpload(WorkflowType.COMPRESS);
          return;
        }

        if (documents.length !== 1 || documents[0].type !== 'PDF') {
          toast.error('Compress action requires exactly one PDF document. Clear others first.');
          return;
        }

        setActiveWorkflow(WorkflowType.COMPRESS);
        updateOutputOptions({ format: OutputFormat.PDF });
        setView(AppView.OUTPUT_OPTIONS);
      },
    },
    {
      icon: <Merge size={20} />,
      label: 'Merge PDFs',
      shortcut: 'Ctrl+M',
      action: () => {
        if (documents.length === 0) {
          handleQuickActionUpload(WorkflowType.MERGE);
          return;
        }

        const allPdfs = documents.every(d => d.type === 'PDF');
        if (!allPdfs) {
          toast.error('Merge action requires all documents to be PDFs. Remove non-PDF files first.');
          return;
        }

        setActiveWorkflow(WorkflowType.MERGE);
        updateOutputOptions({ mergeAsSingle: true, format: OutputFormat.PDF });
        setView(AppView.DOCUMENT_LIST);
      },
    },
    {
      icon: <ArrowRightLeft size={20} />,
      label: 'Convert Format',
      shortcut: 'Ctrl+E',
      action: () => {
        if (documents.length === 0) {
          handleQuickActionUpload(WorkflowType.CONVERT);
          return;
        }

        if (documents.length !== 1) {
          toast.error('Convert action requires exactly one document.');
          return;
        }

        setActiveWorkflow(WorkflowType.CONVERT);
        setView(AppView.OUTPUT_OPTIONS);
      },
    },
    {
      icon: <Scissors size={20} />,
      label: 'Split PDF',
      shortcut: 'Ctrl+Shift+P',
      action: () => {
        if (documents.length === 0) {
          handleQuickActionUpload(WorkflowType.SPLIT);
          return;
        }

        if (documents.length !== 1 || documents[0].type !== 'PDF') {
          toast.error('Split action requires exactly one PDF document.');
          return;
        }

        setActiveWorkflow(WorkflowType.SPLIT);
        updateOutputOptions({ format: OutputFormat.PDF });
        setView(AppView.OUTPUT_OPTIONS);
      },
    },
    {
      icon: <Lock size={20} />,
      label: 'Protect PDF',
      shortcut: 'Ctrl+Shift+L',
      action: () => {
        if (documents.length === 0) {
          handleQuickActionUpload(WorkflowType.PROTECT);
          return;
        }

        if (documents.length !== 1 || documents[0].type !== 'PDF') {
          toast.error('Protect action requires exactly one PDF document.');
          return;
        }

        setActiveWorkflow(WorkflowType.PROTECT);
        updateOutputOptions({ 
          format: OutputFormat.PDF, 
          protection: { enabled: true } 
        });
        setView(AppView.OUTPUT_OPTIONS);
      },
    },
  ];

  return (
    <div className="w-55 bg-bg-surface border-r border-border flex flex-col h-full">
      <div className="p-6">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-4">
          Quick Actions
        </h2>
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-text-secondary animate-pulse">
            <Loader2 className="animate-spin text-accent mb-3" size={24} />
            <p className="text-sm font-semibold text-text-primary">Processing...</p>
            <p className="text-xs max-w-[150px] mt-1 text-text-muted">
              Quick actions are disabled.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {shortcuts.map((shortcut, index) => (
              <button
                key={index}
                onClick={shortcut.action}
                className="flex items-center gap-3 p-3 text-left rounded-md hover:bg-bg-sunken transition-fast group"
                title={shortcut.shortcut}
              >
                <div className="text-text-secondary group-hover:text-accent transition-fast">
                  {shortcut.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary group-hover:text-accent transition-fast">
                    {shortcut.label}
                  </p>
                  <p className="text-xs text-text-muted font-mono">{shortcut.shortcut}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
