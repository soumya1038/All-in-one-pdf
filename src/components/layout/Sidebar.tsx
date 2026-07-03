import { ScanLine, Minimize, Merge, ArrowRightLeft, Scissors, Lock, Loader2, FileImage } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../../store/appStore';
import { ModalType, AppView, WorkflowType } from '../../types/UI.types';
import { OutputFormat } from '../../types/Output.types';
import { ScannerStatus } from '../../types/Scanner.types';

interface ActionButton {
  icon: React.ReactNode;
  label: string;
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
    scannerStatus === ScannerStatus.CHECKING;

  const isDisabled = isProcessing || activeWorkflow !== WorkflowType.NONE;

  /**
   * When the user clicks a quick action in the sidebar:
   *  - If no documents are uploaded yet → set the workflow and go to Home so
   *    the user can drag-drop or browse at their own pace. No file dialog popup.
   *  - If documents are already loaded → go directly to the Output Options screen.
   */
  const handleWorkflowClick = (workflow: WorkflowType) => {
    if (documents.length === 0) {
      // Just set workflow and navigate to Home — user will upload there
      setActiveWorkflow(workflow);
      setView(AppView.HOME);
      return;
    }

    // Documents already loaded — validate and proceed
    switch (workflow) {
      case WorkflowType.COMPRESS_IMAGE: {
        if (documents.length !== 1 || documents[0].type === 'PDF') {
          toast.error('Compress Image requires exactly one image. Remove others/PDFs first.');
          return;
        }
        setActiveWorkflow(workflow);
        const imgBase = documents[0].filename.substring(0, documents[0].filename.lastIndexOf('.')) || documents[0].filename;
        const imgExt = documents[0].filename.toLowerCase();
        let defaultFormat = OutputFormat.JPEG;
        if (imgExt.endsWith('.png')) defaultFormat = OutputFormat.PNG;
        else if (imgExt.endsWith('.tiff') || imgExt.endsWith('.tif')) defaultFormat = OutputFormat.TIFF;

        updateOutputOptions({ format: defaultFormat, compress: true, filename: `${imgBase}_compressed` });
        setView(AppView.OUTPUT_OPTIONS);
        break;
      }

      case WorkflowType.COMPRESS: {
        if (documents.length !== 1 || documents[0].type !== 'PDF') {
          toast.error('Compress requires exactly one PDF document. Clear others first.');
          return;
        }
        setActiveWorkflow(WorkflowType.COMPRESS);
        const compBase = documents[0].filename.substring(0, documents[0].filename.lastIndexOf('.')) || documents[0].filename;
        updateOutputOptions({ format: OutputFormat.PDF, compress: true, filename: `${compBase}_compressed` });
        setView(AppView.OUTPUT_OPTIONS);
        break;
      }

      case WorkflowType.MERGE:
        if (!documents.every(d => d.type === 'PDF')) {
          toast.error('Merge requires all documents to be PDFs. Remove non-PDF files first.');
          return;
        }
        setActiveWorkflow(WorkflowType.MERGE);
        updateOutputOptions({ mergeAsSingle: true, format: OutputFormat.PDF });
        setView(AppView.DOCUMENT_LIST);
        break;

      case WorkflowType.CONVERT:
        if (documents.length !== 1) {
          toast.error('Convert requires exactly one document.');
          return;
        }
        setActiveWorkflow(WorkflowType.CONVERT);
        setView(AppView.OUTPUT_OPTIONS);
        break;

      case WorkflowType.SPLIT:
        if (documents.length !== 1 || documents[0].type !== 'PDF') {
          toast.error('Split requires exactly one PDF document.');
          return;
        }
        setActiveWorkflow(WorkflowType.SPLIT);
        updateOutputOptions({ format: OutputFormat.PDF });
        setView(AppView.OUTPUT_OPTIONS);
        break;

      case WorkflowType.PROTECT:
        if (documents.length !== 1 || documents[0].type !== 'PDF') {
          toast.error('Protect requires exactly one PDF document.');
          return;
        }
        setActiveWorkflow(WorkflowType.PROTECT);
        updateOutputOptions({ format: OutputFormat.PDF, protection: { enabled: true } });
        setView(AppView.OUTPUT_OPTIONS);
        break;
    }
  };

  const actions: ActionButton[] = [
    {
      icon: <ScanLine size={20} />,
      label: 'Scan Document',
      action: () => openModal(ModalType.SCANNER),
    },
    {
      icon: <Minimize size={20} />,
      label: 'Compress PDF',
      action: () => handleWorkflowClick(WorkflowType.COMPRESS),
    },
    {
      icon: <FileImage size={20} />,
      label: 'Compress Image',
      action: () => handleWorkflowClick(WorkflowType.COMPRESS_IMAGE),
    },
    {
      icon: <Merge size={20} />,
      label: 'Merge PDFs',
      action: () => handleWorkflowClick(WorkflowType.MERGE),
    },
    {
      icon: <ArrowRightLeft size={20} />,
      label: 'Convert Format',
      action: () => handleWorkflowClick(WorkflowType.CONVERT),
    },
    {
      icon: <Scissors size={20} />,
      label: 'Split PDF',
      action: () => handleWorkflowClick(WorkflowType.SPLIT),
    },
    {
      icon: <Lock size={20} />,
      label: 'Protect PDF',
      action: () => handleWorkflowClick(WorkflowType.PROTECT),
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
            {actions.map((action, index) => (
              <button
                key={index}
                onClick={action.action}
                disabled={isDisabled}
                className={`flex items-center gap-3 p-3 text-left rounded-md transition-fast group w-full
                  ${isDisabled 
                    ? 'opacity-40 cursor-not-allowed' 
                    : 'hover:bg-bg-sunken active:bg-bg-sunken'
                  }
                `}
              >
                <div className={`transition-fast ${isDisabled ? 'text-text-muted' : 'text-text-secondary group-hover:text-accent'}`}>
                  {action.icon}
                </div>
                <p className={`text-sm font-medium transition-fast ${isDisabled ? 'text-text-muted' : 'text-text-primary group-hover:text-accent'}`}>
                  {action.label}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
