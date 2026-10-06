import { ScanLine, Minimize, Merge, ArrowRightLeft, Scissors, Lock, Loader2, FileImage, Layout, Camera, Pencil, FileText, Sheet, Paintbrush } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../../store/appStore';
import { ModalType, AppView, WorkflowType } from '../../types/UI.types';
import { OutputFormat } from '../../types/Output.types';
import { ScannerStatus } from '../../types/Scanner.types';
import { DocumentType } from '../../types/Document.types';
import { version as appVersion } from '../../../package.json';

interface ActionButton {
  icon: React.ReactNode;
  label: string;
  action: () => void;
  isActive?: boolean;
}

function Sidebar() {
  const openModal = useAppStore((state) => state.openModal);
  const documents = useAppStore((state) => state.documents);
  const setView = useAppStore((state) => state.setView);
  const updateOutputOptions = useAppStore((state) => state.updateOutputOptions);
  const setActiveWorkflow = useAppStore((state) => state.setActiveWorkflow);
  
  const sidebarCollapsed = useAppStore((state) => state.ui.sidebarCollapsed);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);

  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);
  const activeModal = useAppStore((state) => state.ui.modal.type);
  const currentView = useAppStore((state) => state.ui.currentView);
  const isLoading = useAppStore((state) => state.ui.isLoading);
  const scannerStatus = useAppStore((state) => state.scannerStatus.status);

  const isProcessing = 
    currentView === AppView.PROCESSING || 
    isLoading || 
    scannerStatus === ScannerStatus.SCANNING || 
    scannerStatus === ScannerStatus.CHECKING;

  const isDisabled = isProcessing;

  const selectedDocumentId = useAppStore((state) => state.ui.selectedDocumentId);
  const setSelectedDocument = useAppStore((state) => state.setSelectedDocument);
  const showConfirm = useAppStore((state) => state.showConfirm);

  const hasActiveProgress = 
    (currentView === AppView.PDF_COMPOSE && documents.length > 0);

  const handleActionClick = async (targetView: AppView, targetWorkflow: WorkflowType, label: string, executeAction: () => void) => {
    if (currentView === targetView && (targetWorkflow === WorkflowType.NONE || activeWorkflow === targetWorkflow)) {
      return;
    }

    if (hasActiveProgress) {
      const confirmed = await showConfirm(
        `Are you sure you want to switch to "${label}"? Any unsaved edits or active process data will be lost.`,
        'Switch Process'
      );
      if (!confirmed) return;
    }

    if (targetWorkflow === WorkflowType.NONE) {
      setActiveWorkflow(WorkflowType.NONE);
    }
    
    executeAction();
  };

  /**
   * When the user clicks a quick action in the sidebar:
   *  - If no documents are uploaded yet → set the workflow and go to Home.
   *  - If documents are already loaded → auto-select a compatible document and go to Output Options or Document List.
   */
  const handleWorkflowClick = (workflow: WorkflowType) => {
    if (documents.length === 0) {
      setActiveWorkflow(workflow);
      setView(AppView.HOME);
      return;
    }

    // Documents already loaded — select compatible document and proceed
    switch (workflow) {
      case WorkflowType.COMPRESS_IMAGE: {
        const activeImg = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId && d.type === DocumentType.IMAGE))
          || documents.find(d => d.type === DocumentType.IMAGE);

        if (!activeImg) {
          toast('Please select or upload an image to compress');
          setActiveWorkflow(workflow);
          setView(AppView.HOME);
          return;
        }

        setSelectedDocument(activeImg.id);
        setActiveWorkflow(workflow);
        const imgBase = activeImg.filename.substring(0, activeImg.filename.lastIndexOf('.')) || activeImg.filename;
        const imgExt = activeImg.filename.toLowerCase();
        let defaultFormat = OutputFormat.JPEG;
        if (imgExt.endsWith('.png')) defaultFormat = OutputFormat.PNG;
        else if (imgExt.endsWith('.tiff') || imgExt.endsWith('.tif')) defaultFormat = OutputFormat.TIFF;

        updateOutputOptions({ documentId: activeImg.id, format: defaultFormat, compress: true, filename: `${imgBase}_compressed` });
        setView(AppView.OUTPUT_OPTIONS);
        break;
      }

      case WorkflowType.COMPRESS: {
        const activePdf = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId && d.type === DocumentType.PDF))
          || documents.find(d => d.type === DocumentType.PDF);

        if (!activePdf) {
          toast('Please select or upload a PDF to compress');
          setActiveWorkflow(workflow);
          setView(AppView.HOME);
          return;
        }

        setSelectedDocument(activePdf.id);
        setActiveWorkflow(WorkflowType.COMPRESS);
        const compBase = activePdf.filename.substring(0, activePdf.filename.lastIndexOf('.')) || activePdf.filename;
        updateOutputOptions({ documentId: activePdf.id, format: OutputFormat.PDF, compress: true, filename: `${compBase}_compressed` });
        setView(AppView.OUTPUT_OPTIONS);
        break;
      }

      case WorkflowType.MERGE: {
        const pdfs = documents.filter(d => d.type === DocumentType.PDF);
        setActiveWorkflow(WorkflowType.MERGE);
        updateOutputOptions({ mergeAsSingle: true, format: OutputFormat.PDF });
        if (pdfs.length < 2) {
          toast('Merge requires at least 2 PDF documents. Add more PDFs to merge.');
        }
        setView(AppView.DOCUMENT_LIST);
        break;
      }

      case WorkflowType.CONVERT: {
        const activeDoc = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId)) || documents[0];
        setSelectedDocument(activeDoc.id);
        setActiveWorkflow(WorkflowType.CONVERT);
        const base = activeDoc.filename.substring(0, activeDoc.filename.lastIndexOf('.')) || activeDoc.filename;
        updateOutputOptions({ documentId: activeDoc.id, filename: `${base}_converted` });
        setView(AppView.OUTPUT_OPTIONS);
        break;
      }

      case WorkflowType.SPLIT: {
        const activePdf = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId && d.type === DocumentType.PDF))
          || documents.find(d => d.type === DocumentType.PDF);

        if (!activePdf) {
          toast('Please select or upload a PDF to split');
          setActiveWorkflow(workflow);
          setView(AppView.HOME);
          return;
        }

        setSelectedDocument(activePdf.id);
        setActiveWorkflow(WorkflowType.SPLIT);
        const splitBase = activePdf.filename.substring(0, activePdf.filename.lastIndexOf('.')) || activePdf.filename;
        updateOutputOptions({ documentId: activePdf.id, format: OutputFormat.PDF, filename: `${splitBase}_split` });
        setView(AppView.OUTPUT_OPTIONS);
        break;
      }

      case WorkflowType.PROTECT: {
        const activePdf = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId && d.type === DocumentType.PDF))
          || documents.find(d => d.type === DocumentType.PDF);

        if (!activePdf) {
          toast('Please select or upload a PDF to protect');
          setActiveWorkflow(workflow);
          setView(AppView.HOME);
          return;
        }

        setSelectedDocument(activePdf.id);
        setActiveWorkflow(WorkflowType.PROTECT);
        const protBase = activePdf.filename.substring(0, activePdf.filename.lastIndexOf('.')) || activePdf.filename;
        updateOutputOptions({ documentId: activePdf.id, format: OutputFormat.PDF, protection: { enabled: true }, filename: `${protBase}_protected` });
        setView(AppView.OUTPUT_OPTIONS);
        break;
      }
    }
  };

  const actions: ActionButton[] = [
    {
      icon: <ScanLine size={20} />,
      label: 'Scan Document',
      action: () => openModal(ModalType.SCANNER),
      isActive: scannerStatus === ScannerStatus.SCANNING || scannerStatus === ScannerStatus.CHECKING || activeModal === ModalType.SCANNER,
    },
    {
      icon: <Minimize size={20} />,
      label: 'Compress PDF',
      action: () => handleActionClick(AppView.OUTPUT_OPTIONS, WorkflowType.COMPRESS, 'Compress PDF', () => handleWorkflowClick(WorkflowType.COMPRESS)),
      isActive: activeWorkflow === WorkflowType.COMPRESS,
    },
    {
      icon: <FileImage size={20} />,
      label: 'Compress Image',
      action: () => handleActionClick(AppView.OUTPUT_OPTIONS, WorkflowType.COMPRESS_IMAGE, 'Compress Image', () => handleWorkflowClick(WorkflowType.COMPRESS_IMAGE)),
      isActive: activeWorkflow === WorkflowType.COMPRESS_IMAGE,
    },
    {
      icon: <Merge size={20} />,
      label: 'Merge PDFs',
      action: () => handleActionClick(AppView.DOCUMENT_LIST, WorkflowType.MERGE, 'Merge PDFs', () => handleWorkflowClick(WorkflowType.MERGE)),
      isActive: activeWorkflow === WorkflowType.MERGE,
    },
    {
      icon: <ArrowRightLeft size={20} />,
      label: 'Convert Format',
      action: () => handleActionClick(AppView.OUTPUT_OPTIONS, WorkflowType.CONVERT, 'Convert Format', () => handleWorkflowClick(WorkflowType.CONVERT)),
      isActive: activeWorkflow === WorkflowType.CONVERT,
    },
    {
      icon: <Scissors size={20} />,
      label: 'Split PDF',
      action: () => handleActionClick(AppView.OUTPUT_OPTIONS, WorkflowType.SPLIT, 'Split PDF', () => handleWorkflowClick(WorkflowType.SPLIT)),
      isActive: activeWorkflow === WorkflowType.SPLIT,
    },
    {
      icon: <Lock size={20} />,
      label: 'Protect PDF',
      action: () => handleActionClick(AppView.OUTPUT_OPTIONS, WorkflowType.PROTECT, 'Protect PDF', () => handleWorkflowClick(WorkflowType.PROTECT)),
      isActive: activeWorkflow === WorkflowType.PROTECT,
    },
    {
      icon: <Layout size={20} />,
      label: 'PDF Compose',
      action: () => handleActionClick(AppView.PDF_COMPOSE, WorkflowType.NONE, 'PDF Compose', () => setView(AppView.PDF_COMPOSE)),
      isActive: currentView === AppView.PDF_COMPOSE,
    },
    {
      icon: <Camera size={20} />,
      label: 'Passport Photo',
      action: () => handleActionClick(AppView.IMAGE_EDIT, WorkflowType.NONE, 'Passport Photo', () => {
        const activeImg = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId && d.type === DocumentType.IMAGE)) || documents.find(d => d.type === DocumentType.IMAGE);
        if (activeImg) setSelectedDocument(activeImg.id);
        setView(AppView.IMAGE_EDIT);
      }),
      isActive: currentView === AppView.IMAGE_EDIT,
    },
    {
      icon: <Pencil size={20} />,
      label: 'Image Editor',
      action: () => handleActionClick(AppView.CANVAS_EDITOR, WorkflowType.NONE, 'Image Editor', () => {
        const activeImg = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId && d.type === DocumentType.IMAGE)) || documents.find(d => d.type === DocumentType.IMAGE);
        if (activeImg) setSelectedDocument(activeImg.id);
        setView(AppView.CANVAS_EDITOR);
      }),
      isActive: currentView === AppView.CANVAS_EDITOR,
    },
    {
      icon: <FileText size={20} />,
      label: 'Offline OCR',
      action: () => handleActionClick(AppView.OCR, WorkflowType.NONE, 'Offline OCR', () => {
        const activeDoc = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId)) || documents[0];
        if (activeDoc) setSelectedDocument(activeDoc.id);
        setView(AppView.OCR);
      }),
      isActive: currentView === AppView.OCR,
    },
    {
      icon: <Sheet size={20} />,
      label: 'Excel Editor',
      action: () => handleActionClick(AppView.EXCEL_EDITOR, WorkflowType.NONE, 'Excel Editor', () => setView(AppView.EXCEL_EDITOR)),
      isActive: currentView === AppView.EXCEL_EDITOR || activeWorkflow === WorkflowType.EXCEL_EDIT,
    },
    {
      icon: <Paintbrush size={20} />,
      label: 'Sketch Canvas',
      action: () => handleActionClick(AppView.SKETCH_EDITOR, WorkflowType.NONE, 'Sketch Canvas', () => setView(AppView.SKETCH_EDITOR)),
      isActive: currentView === AppView.SKETCH_EDITOR,
    },
  ];

  return (
    <div className={`bg-bg-surface border-r border-border flex flex-col h-full transition-all duration-normal select-none ${sidebarCollapsed ? 'w-20' : 'w-55'}`}>
      <div className="p-4 flex flex-col h-full">
        {/* Sidebar Header with Toggle Icon */}
        {!sidebarCollapsed ? (
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Quick Actions
            </h2>
            <button
              onClick={toggleSidebar}
              className="p-1.5 hover:bg-bg-sunken rounded text-text-secondary hover:text-accent transition-fast flex items-center justify-center"
              title="Collapse Sidebar"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="flex justify-center mb-6">
            <button
              onClick={toggleSidebar}
              className="p-1.5 hover:bg-bg-sunken rounded text-text-secondary hover:text-accent transition-fast flex items-center justify-center"
              title="Expand Sidebar"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          </div>
        )}

        {/* Sidebar Actions Content */}
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-text-secondary animate-pulse">
            <Loader2 className="animate-spin text-accent mb-3" size={24} />
            {!sidebarCollapsed && (
              <>
                <p className="text-sm font-semibold text-text-primary">Processing...</p>
                <p className="text-xs max-w-[150px] mt-1 text-text-muted">
                  Quick actions are disabled.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {actions.map((action, index) => {
              const active = !!action.isActive;
              return (
                <button
                  key={index}
                  onClick={action.action}
                  disabled={isDisabled}
                  title={sidebarCollapsed ? action.label : undefined}
                  className={`flex items-center rounded-lg transition-fast group w-full relative
                    ${sidebarCollapsed ? 'justify-center p-3' : 'gap-3 px-3 py-2.5 text-left'}
                    ${isDisabled 
                      ? 'opacity-40 cursor-not-allowed' 
                      : active
                        ? 'bg-accent/15 border border-accent/40 shadow-xs'
                        : 'hover:bg-bg-sunken active:bg-bg-sunken border border-transparent'
                    }
                  `}
                >
                  {/* Left accent indicator bar for active item */}
                  {active && !sidebarCollapsed && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-accent rounded-r" />
                  )}
                  <div className={`transition-fast ${isDisabled ? 'text-text-muted' : active ? 'text-accent font-semibold' : 'text-text-secondary group-hover:text-accent'}`}>
                    {action.icon}
                  </div>
                  {!sidebarCollapsed ? (
                    <>
                      <p className={`text-sm transition-fast truncate ${isDisabled ? 'text-text-muted' : active ? 'text-accent font-bold' : 'font-medium text-text-primary group-hover:text-accent'}`}>
                        {action.label}
                      </p>
                      {active && (
                        <span className="ml-auto shrink-0 flex items-center gap-1 text-[10px] font-semibold text-accent bg-accent/20 px-1.5 py-0.5 rounded-full border border-accent/30 animate-pulse">
                          Active
                        </span>
                      )}
                    </>
                  ) : (
                    active && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent ring-2 ring-white dark:ring-gray-900 animate-pulse" />
                    )
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Section: App Version in Quick Action Panel */}
      <div
        className={`border-t border-border/70 bg-bg-surface shrink-0 select-none ${
          sidebarCollapsed
            ? 'p-2 flex flex-col items-center justify-center'
            : 'px-4 py-2.5 flex items-center justify-between'
        }`}
      >
        {sidebarCollapsed ? (
          <span
            className="text-[10px] font-mono font-semibold text-text-muted hover:text-text-primary bg-bg-sunken px-1.5 py-0.5 rounded border border-border/50 transition-fast cursor-default"
            title={`DocuFlow v${appVersion}`}
          >
            v{appVersion}
          </span>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-xs" title="Offline ready" />
              <span className="text-xs text-text-muted font-medium">DocuFlow</span>
            </div>
            <span className="text-[11px] font-mono font-semibold text-text-muted hover:text-text-primary bg-bg-sunken px-2 py-0.5 rounded border border-border/50 transition-fast cursor-default">
              v{appVersion}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
