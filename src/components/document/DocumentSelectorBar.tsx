import React, { useRef } from 'react';
import { FileText, FileImage, Sheet, Plus, Check, Layers } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { DocumentItem, DocumentType } from '../../types/Document.types';
import { AppView, WorkflowType } from '../../types/UI.types';
import { registerUploadedFile } from '../../utils/fileUploadHelper';
import { toast } from 'react-hot-toast';

interface DocumentSelectorBarProps {
  activeDocumentId?: string;
  onSelectDocument: (doc: DocumentItem) => void;
  acceptedTypes?: DocumentType[];
  title?: string;
  className?: string;
}

export default function DocumentSelectorBar({
  activeDocumentId,
  onSelectDocument,
  acceptedTypes,
  title,
  className = '',
}: DocumentSelectorBarProps) {
  const documents = useAppStore((state) => state.documents);
  const setView = useAppStore((state) => state.setView);
  const setSelectedDocument = useAppStore((state) => state.setSelectedDocument);
  const setActiveWorkflow = useAppStore((state) => state.setActiveWorkflow);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (documents.length === 0) return null;

  const handleDocumentClick = (doc: DocumentItem) => {
    // If acceptedTypes is defined and this doc doesn't match
    if (acceptedTypes && acceptedTypes.length > 0 && !acceptedTypes.includes(doc.type)) {
      if (doc.type === DocumentType.PDF) {
        toast((t) => (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">"{doc.filename}" is a PDF document.</span>
            <div className="flex gap-2">
              <button
                className="px-2.5 py-1 text-xs bg-accent text-white rounded font-medium hover:bg-accent-hover"
                onClick={() => {
                  toast.dismiss(t.id);
                  setSelectedDocument(doc.id);
                  setView(AppView.OCR);
                }}
              >
                Open in OCR
              </button>
              <button
                className="px-2.5 py-1 text-xs bg-bg-sunken text-text-primary rounded hover:bg-border"
                onClick={() => {
                  toast.dismiss(t.id);
                  setSelectedDocument(doc.id);
                  setActiveWorkflow(WorkflowType.CONVERT);
                  setView(AppView.OUTPUT_OPTIONS);
                }}
              >
                Convert/Compress
              </button>
            </div>
          </div>
        ), { duration: 5000 });
        return;
      } else {
        toast.error(`This tool works with image files. Selected file is ${doc.type}.`);
        return;
      }
    }

    setSelectedDocument(doc.id);
    onSelectDocument(doc);
  };

  const handleAddFile = async () => {
    try {
      if (window.electron?.showOpenDialog) {
        const filters = acceptedTypes?.includes(DocumentType.IMAGE) && !acceptedTypes?.includes(DocumentType.PDF)
          ? [{ name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'] }]
          : [{ name: 'Supported Files', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'xlsx', 'xls', 'csv'] }];

        const res = await window.electron.showOpenDialog({
          title: 'Add Document to Session',
          properties: ['openFile'],
          filters,
        });

        if (res.success && res.data && res.data.length > 0) {
          const registered = await registerUploadedFile(res.data[0]);
          if (registered) {
            toast.success(`Added "${registered.filename}"`);
            onSelectDocument(registered);
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
        toast.success(`Added "${registered.filename}"`);
        onSelectDocument(registered);
      }
      e.target.value = '';
    }
  };

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

  return (
    <div
      className={`bg-bg-surface border-b border-border px-3 py-2 flex items-center justify-between gap-3 text-xs select-none ${className}`}
    >
      {/* Hidden file input for web fallback */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className="hidden"
        accept={acceptedTypes?.includes(DocumentType.IMAGE) && !acceptedTypes?.includes(DocumentType.PDF) ? 'image/*' : undefined}
      />

      {/* Left: Section Label & All Documents Link */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setView(AppView.DOCUMENT_LIST)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-bg-sunken hover:bg-border text-text-secondary hover:text-text-primary transition-fast font-medium"
          title="Return to document list with all uploaded files intact"
        >
          <Layers size={13} className="text-accent" />
          <span>All Files ({documents.length})</span>
        </button>

        {title && (
          <span className="text-text-muted hidden md:inline-block">
            • {title}
          </span>
        )}
      </div>

      {/* Middle: Horizontal Document Thumbnails / Switcher Strip */}
      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {documents.map((doc) => {
          const isActive = doc.id === activeDocumentId;
          const isCompatible = !acceptedTypes || acceptedTypes.length === 0 || acceptedTypes.includes(doc.type);

          return (
            <button
              key={doc.id}
              onClick={() => handleDocumentClick(doc)}
              className={`
                group flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-left shrink-0 transition-fast
                ${isActive
                  ? 'border-accent bg-accent/10 text-accent font-semibold shadow-xs ring-1 ring-accent/30'
                  : isCompatible
                    ? 'border-border bg-bg-base/70 hover:border-accent/50 hover:bg-bg-sunken text-text-secondary hover:text-text-primary'
                    : 'border-border/60 bg-bg-base/40 text-text-muted opacity-60 hover:opacity-100 hover:border-border'
                }
              `}
              title={`${doc.filename} (${doc.type}) - Click to switch`}
            >
              {getDocIcon(doc.type)}

              <span className="truncate max-w-[130px] inline-block font-mono text-[11px]">
                {doc.filename}
              </span>

              {isActive && (
                <Check size={12} className="text-accent shrink-0 ml-0.5" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right: Quick Add File button */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleAddFile}
          className="flex items-center gap-1 px-2.5 py-1 rounded border border-dashed border-border hover:border-accent text-text-secondary hover:text-accent hover:bg-accent/5 transition-fast text-[11px] font-medium"
          title="Add another document to the session"
        >
          <Plus size={13} />
          <span>Add File</span>
        </button>
      </div>
    </div>
  );
}
