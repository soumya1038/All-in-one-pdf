import React, { useRef } from 'react';
import { 
  FileText, 
  FileImage, 
  Sheet, 
  Check, 
  Plus, 
  Trash2, 
  ArrowLeft, 
  Download, 
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { DocumentItem, DocumentType } from '../../types/Document.types';
import { useAppStore } from '../../store/appStore';
import { AppView } from '../../types/UI.types';
import { registerUploadedFile } from '../../utils/fileUploadHelper';
import { toast } from 'react-hot-toast';

interface DocumentShelfProps {
  activeDocIds: Set<string>;
  onToggleDocument: (doc: DocumentItem, insert: boolean) => void;
  onRemoveDocumentFromSession: (docId: string) => void;
  onClearCanvas: () => void;
  onExportPng: () => void;
}

export const DocumentShelf: React.FC<DocumentShelfProps> = ({
  activeDocIds,
  onToggleDocument,
  onRemoveDocumentFromSession,
  onClearCanvas,
  onExportPng,
}) => {
  const documents = useAppStore((state) => state.documents);
  const setView = useAppStore((state) => state.setView);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getDocIcon = (type: DocumentType) => {
    switch (type) {
      case DocumentType.PDF:
        return <FileText size={14} className="text-red-500 shrink-0" />;
      case DocumentType.IMAGE:
        return <FileImage size={14} className="text-emerald-500 shrink-0" />;
      case DocumentType.EXCEL:
        return <Sheet size={14} className="text-green-600 shrink-0" />;
      default:
        return <FileText size={14} className="text-blue-500 shrink-0" />;
    }
  };

  const handleAddFile = async () => {
    try {
      if (window.electron?.showOpenDialog) {
        const res = await window.electron.showOpenDialog({
          title: 'Add Document or Image to Sketch Canvas',
          properties: ['openFile'],
          filters: [
            { name: 'Supported Files', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'] },
          ],
        });

        if (res.success && res.data && res.data.length > 0) {
          const registered = await registerUploadedFile(res.data[0]);
          if (registered) {
            toast.success(`Loaded "${registered.filename}"`);
            onToggleDocument(registered, true);
          }
        }
      } else {
        fileInputRef.current?.click();
      }
    } catch {
      fileInputRef.current?.click();
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const registered = await registerUploadedFile(file);
      if (registered) {
        toast.success(`Loaded "${registered.filename}"`);
        onToggleDocument(registered, true);
      }
      e.target.value = '';
    }
  };

  return (
    <div className="sketch-document-shelf select-none border-b border-border bg-bg-surface px-4 py-2 flex items-center justify-between gap-3 text-xs">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className="hidden"
        accept="image/*,.pdf"
      />

      {/* Left: Navigation and Mode Title */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          onClick={() => {
            const hasDocs = documents.length > 0;
            setView(hasDocs ? AppView.DOCUMENT_LIST : AppView.HOME);
          }}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-bg-sunken hover:bg-border text-text-secondary hover:text-text-primary transition-fast font-medium"
          title="Return to documents list"
        >
          <ArrowLeft size={14} />
          <span>Exit Editor</span>
        </button>

        <div className="h-4 w-px bg-border/80 mx-0.5" />

        <div className="flex items-center gap-1.5 font-semibold text-text-primary text-xs">
          <Sparkles size={14} className="text-accent" />
          <span>Sketch Canvas</span>
        </div>
      </div>

      {/* Center: Uploaded Document Tool Options (Fitting into the top tool bar) */}
      <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 px-2">
        {documents.length === 0 ? (
          <div className="flex items-center gap-2 text-text-muted text-xs italic py-1">
            <span>No documents in session. Click "+ Add Document" to insert images or PDFs onto canvas.</span>
          </div>
        ) : (
          documents.map((doc) => {
            const isTicked = activeDocIds.has(doc.id);

            return (
              <div
                key={doc.id}
                onClick={() => onToggleDocument(doc, !isTicked)}
                className={`
                  sketch-doc-card group shrink-0 relative flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer transition-all duration-150
                  ${isTicked ? 'is-ticked' : 'border-border bg-bg-base/60 hover:bg-bg-sunken hover:border-accent/40 text-text-secondary'}
                `}
                title={isTicked ? `"${doc.filename}" is active on canvas. Click to deselect and remove.` : `Click to place "${doc.filename}" on sketch canvas.`}
              >
                {/* Tick Mark / Selection Badge */}
                {isTicked ? (
                  <span className="sketch-tick-badge shrink-0" title="Selected on Canvas">
                    <Check size={13} strokeWidth={3} />
                  </span>
                ) : (
                  <span className="sketch-unticked-badge shrink-0" title="Click to Select and Place on Canvas">
                    <Plus size={11} strokeWidth={2.5} />
                  </span>
                )}

                {/* Document Type Icon */}
                {getDocIcon(doc.type)}

                {/* Document Thumbnail Preview (if available) */}
                {doc.thumbnailPath && (
                  <img
                    src={`docuflow:///${doc.thumbnailPath.replace(/\\/g, '/')}`}
                    alt=""
                    className="w-5 h-5 rounded object-cover border border-border/50 shrink-0"
                  />
                )}

                {/* Document Filename */}
                <span className={`text-[11px] font-mono truncate max-w-[140px] ${isTicked ? 'font-bold text-emerald-700 dark:text-emerald-300' : 'text-text-primary'}`}>
                  {doc.filename}
                </span>

                {/* Remove from session option */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveDocumentFromSession(doc.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 rounded transition-fast ml-0.5 text-text-muted"
                  title="Remove document from sketch session"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleAddFile}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-dashed border-border hover:border-accent hover:bg-accent/5 text-text-secondary hover:text-accent transition-fast text-xs font-medium"
          title="Add another document or image to the session"
        >
          <Plus size={14} />
          <span>Add Document</span>
        </button>

        <div className="h-4 w-px bg-border/80 mx-0.5" />

        <button
          onClick={onClearCanvas}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-bg-sunken hover:bg-border text-text-secondary hover:text-text-primary transition-fast text-xs font-medium"
          title="Clear canvas"
        >
          <RotateCcw size={13} />
          <span>Clear</span>
        </button>

        <button
          onClick={onExportPng}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white transition-fast text-xs font-semibold shadow-xs"
          title="Export current sketch and annotations as PNG image"
        >
          <Download size={13} />
          <span>Export Image</span>
        </button>
      </div>
    </div>
  );
};
