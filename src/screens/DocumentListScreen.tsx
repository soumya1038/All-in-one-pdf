import { Plus, Trash2, ArrowLeft } from 'lucide-react';
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView, ModalType } from '../types/UI.types';
import DocumentCard from '../components/document/DocumentCard';
import Button from '../components/ui/Button';
import { formatFileSize } from '../utils/formatFileSize';
import { DocumentItem } from '../types/Document.types';

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
      <div className="border-b border-border bg-bg-surface">
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

      {/* Document Grid */}
      <div className="flex-1 overflow-auto p-6">
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
        <div className="mt-8 text-center">
          <p className="text-sm text-text-muted">
            💡 Tip: Drag and drop to reorder documents
          </p>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="border-t border-border bg-bg-surface p-6">
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
