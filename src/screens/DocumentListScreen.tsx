import { useState, useEffect } from 'react';
import { Plus, Trash2, ArrowLeft, Eye } from 'lucide-react';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView, ModalType } from '../types/UI.types';
import DocumentCard from '../components/document/DocumentCard';
import Button from '../components/ui/Button';
import { formatFileSize } from '../utils/formatFileSize';
import { DocumentItem, DocumentType } from '../types/Document.types';

/**
 * Sortable wrapper for DocumentCard
 */
function SortableDocumentCard({ document }: { document: DocumentItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: document.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const removeDocument = useAppStore((state) => state.removeDocument);
  const setView = useAppStore((state) => state.setView);
  const setSelectedDocument = useAppStore((state) => state.setSelectedDocument);
  const setPreviewBackView = useAppStore((state) => state.setPreviewBackView);

  const handleDelete = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const confirmed = await window.electron.showConfirmDialog(
      `Delete "${document.filename}" from session?`,
      'Delete Document'
    );
    if (!confirmed) return;

    const result = await window.electron.deleteFile(document.id);
    if (result.success) {
      removeDocument(document.id);
      toast.success('Document deleted');
    } else {
      toast.error(result.error.message);
    }
  };

  const handlePreview = () => {
    setSelectedDocument(document.id);
    setPreviewBackView(AppView.DOCUMENT_LIST);
    setView(AppView.PREVIEW);
  };

  return (
    <div ref={setNodeRef} style={style}>
      <DocumentCard 
        document={document} 
        onDelete={handleDelete} 
        onPreview={handlePreview} 
        isDragging={isDragging} 
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}



function DocumentListScreen() {
  const documents = useAppStore((state) => state.documents);
  const reorderDocuments = useAppStore((state) => state.reorderDocuments);
  const clearDocuments = useAppStore((state) => state.clearDocuments);
  const setView = useAppStore((state) => state.setView);
  const openModal = useAppStore((state) => state.openModal);

  const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);

  // Preview panel states
  const [activeDocIndex, setActiveDocIndex] = useState(0);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isMobilePreviewOpen, setIsMobilePreviewOpen] = useState(false);

  const activeDoc = documents[activeDocIndex] || documents[0];

  // Auto-bound activeDocIndex if documents change
  useEffect(() => {
    if (activeDocIndex >= documents.length && documents.length > 0) {
      setActiveDocIndex(documents.length - 1);
    }
  }, [documents.length, activeDocIndex]);

  // Load all preview page images effect
  useEffect(() => {
    let active = true;
    const loadAllPages = async () => {
      if (!activeDoc) return;
      setIsLoadingPreview(true);
      try {
        const images: Record<number, string> = {};
        for (let p = 1; p <= activeDoc.pageCount; p++) {
          if (activeDoc.cleanTempPaths?.[p]) {
            images[p] = activeDoc.cleanTempPaths[p];
          } else if (activeDoc.type === DocumentType.PDF) {
            const res = await window.electron.renderPdfPage(activeDoc.id, p);
            if (res.success && res.data) {
              images[p] = res.data;
            }
          } else {
            images[p] = activeDoc.tempPath;
          }
        }
        if (active) {
          setPageImages(images);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setIsLoadingPreview(false);
      }
    };
    loadAllPages();
    return () => {
      active = false;
    };
  }, [activeDocIndex, activeDoc]);

  // Keyboard navigation for vertical scroll preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      const scrollContainer = document.getElementById('list-preview-scroll-container');
      if (!scrollContainer) return;

      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        scrollContainer.scrollBy({ top: 320, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        scrollContainer.scrollBy({ top: -320, behavior: 'smooth' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDocIndex]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = documents.findIndex((doc) => doc.id === active.id);
      const newIndex = documents.findIndex((doc) => doc.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        reorderDocuments(oldIndex, newIndex);
        toast.success('Documents reordered');
      }
    }
  };

  const handleAddMore = () => {
    openModal(ModalType.ADD_MORE);
  };

  const handleClearAll = async () => {
    const confirmed = await window.electron.showConfirmDialog(
      'Remove all documents from this session? This cannot be undone.',
      'Clear All Documents'
    );
    if (!confirmed) return;

    for (const doc of documents) {
      await window.electron.deleteFile(doc.id).catch(() => {});
    }

    clearDocuments();
    toast.success('All documents cleared');
    setView(AppView.HOME);
  };

  const handleContinue = () => {
    setView(AppView.OUTPUT_OPTIONS);
  };

  const handleBack = () => {
    setView(AppView.HOME);
  };

  const PreviewPanel = () => {
    if (!activeDoc) {
      return (
        <div className="flex-grow flex items-center justify-center text-xs text-text-muted italic select-none">
          No document loaded
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col overflow-hidden h-full">
        {/* Document Selector Header if multiple files */}
        {documents.length > 1 && (
          <div className="p-3 bg-bg-surface border-b border-border flex items-center gap-2 flex-shrink-0 select-none">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Preview:</span>
            <select
              value={activeDocIndex}
              onChange={(e) => {
                setActiveDocIndex(parseInt(e.target.value));
              }}
              className="flex-1 px-2.5 py-1 text-xs bg-bg-sunken border border-border rounded focus:outline-none font-medium cursor-pointer text-text-primary"
            >
              {documents.map((d, index) => (
                <option key={d.id} value={index}>
                  {d.filename}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Vertical scrollable gallery preview */}
        <div
          id="list-preview-scroll-container"
          className="flex-1 relative overflow-y-auto overflow-x-hidden flex flex-col items-center gap-6 p-6 no-scrollbar snap-y snap-mandatory scroll-smooth min-h-0 h-full"
        >
          {isLoadingPreview ? (
            <div className="absolute inset-0 bg-black/5 flex flex-col items-center justify-center gap-2 z-10">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-text-secondary font-medium">Loading Page Previews...</span>
            </div>
          ) : null}

          {Array.from({ length: activeDoc.pageCount }, (_, idx) => {
            const pNum = idx + 1;
            const path = pageImages[pNum];
            return (
              <div
                key={pNum}
                className="flex-shrink-0 w-[240px] lg:w-[280px] xl:w-[320px] snap-center flex flex-col items-center gap-3 select-none"
              >
                <div className="relative aspect-[3/4] w-full shadow-lg rounded-lg border border-border/60 bg-white overflow-hidden flex items-center justify-center p-2 hover:border-accent/40 transition-colors">
                  {path ? (
                    <img
                      src={`docuflow:///${path.replace(/\\/g, '/')}?t=${Date.now()}`}
                      alt={`Page ${pNum}`}
                      className="max-w-full max-h-full object-contain rounded"
                    />
                  ) : (
                    <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <span className="text-xs font-semibold text-text-secondary font-mono bg-bg-surface px-2.5 py-1 rounded-full border border-border shadow-sm">
                  Page {pNum} of {activeDoc.pageCount}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (documents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-text-primary mb-2">No documents yet</h2>
          <p className="text-text-secondary mb-6">Upload some files to get started</p>
          <Button variant="primary" onClick={() => setView(AppView.HOME)}>
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border bg-bg-surface flex-shrink-0">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft size={16} />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">
                Your Documents ({documents.length})
              </h1>
              <p className="text-sm text-text-secondary font-mono">
                Total size: {formatFileSize(totalSize)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleAddMore}>
              <Plus size={16} />
              Add More
            </Button>
            <Button variant="ghost" onClick={handleClearAll}>
              <Trash2 size={16} />
              Clear All
            </Button>
          </div>
        </div>
      </div>

      {/* Main Split Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Left Side: Document Grid */}
        <div className="flex-1 overflow-auto p-6 border-r border-border flex flex-col">
          {/* Small Screen View Preview Button */}
          <div className="md:hidden mb-4">
            <Button
              variant="secondary"
              className="w-full justify-center text-xs py-2 bg-accent-light/10 border-accent/20 text-accent hover:bg-accent-light/20 flex items-center gap-2"
              onClick={() => setIsMobilePreviewOpen(true)}
            >
              <Eye size={14} />
              Preview Document ({documents.length} File{documents.length > 1 ? 's' : ''})
            </Button>
          </div>

          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={documents.map((d) => d.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {documents.map((document) => (
                  <SortableDocumentCard key={document.id} document={document} />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {/* Helper Text */}
          <div className="mt-8 text-center flex-shrink-0">
            <p className="text-sm text-text-muted">
              💡 Tip: Drag and drop to reorder documents
            </p>
          </div>
        </div>

        {/* Right Side: Parallel Live Preview on md+ screens */}
        <div className="hidden md:flex w-[380px] lg:w-[480px] xl:w-[580px] bg-bg-sunken flex-col border-l border-border/40 flex-shrink-0">
          <PreviewPanel />
        </div>
      </div>

      {/* Mobile Modal for Preview on small screens */}
      {isMobilePreviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 md:hidden animate-fade-in">
          <div className="bg-bg-surface w-full max-w-lg h-[80vh] rounded-xl flex flex-col overflow-hidden shadow-2xl border border-border">
            <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0 select-none">
              <h3 className="font-semibold text-text-primary text-sm">Document Preview</h3>
              <button
                onClick={() => setIsMobilePreviewOpen(false)}
                className="text-text-muted hover:text-text-primary p-1 text-sm font-semibold"
              >
                ✕ Close
              </button>
            </div>
            <div className="flex-1 overflow-hidden bg-bg-sunken flex flex-col min-h-0">
              <PreviewPanel />
            </div>
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="border-t border-border bg-bg-surface p-6 flex-shrink-0">
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={handleClearAll}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleContinue}>
            Continue to Output Options
          </Button>
        </div>
      </div>
    </div>
  );
}

export default DocumentListScreen;
