import { FileText, Trash2, GripVertical, File } from 'lucide-react';
import { DocumentItem } from '../../types/Document.types';
import { formatFileSize } from '../../utils/formatFileSize';

export interface DocumentCardProps {
  document: DocumentItem;
  onPreview?: () => void;
  onDelete?: () => void;
  isDragging?: boolean;
  dragHandleProps?: any;
}

/**
 * Document card component for displaying document in grid/list
 * Fixed size: 120px × 160px (portrait A4 ratio)
 */
function DocumentCard({ 
  document, 
  onPreview, 
  onDelete, 
  isDragging = false,
  dragHandleProps
}: DocumentCardProps) {
  const getTypeIcon = () => {
    switch (document.type) {
      case 'PDF':
        return <FileText size={24} className="text-error" />;
      case 'IMAGE':
        return <File size={24} className="text-success" />;
      case 'WORD':
        return <FileText size={24} className="text-accent" />;
      case 'EXCEL':
        return <File size={24} className="text-success" />;
      case 'POWERPOINT':
        return <File size={24} className="text-warning" />;
      case 'TEXT':
        return <FileText size={24} className="text-text-muted" />;
      default:
        return <File size={24} className="text-text-muted" />;
    }
  };

  return (
    <div
      className={`
        group relative bg-bg-surface rounded-lg border border-border overflow-hidden cursor-pointer
        transition-all duration-normal hover:shadow-md hover:border-accent
        ${isDragging ? 'opacity-50 scale-105 shadow-drag' : ''}
      `}
      onClick={onPreview}
    >
      {/* Drag Handle (visible on hover) */}
      <div 
        className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-fast z-10"
        {...dragHandleProps}
      >
        <div className="p-1 bg-bg-surface/80 rounded cursor-grab active:cursor-grabbing">
          <GripVertical size={16} className="text-text-secondary" />
        </div>
      </div>

      {/* Delete button (visible on hover) */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-fast z-10">
        <button
          className="p-1 bg-bg-surface/80 rounded hover:bg-error-light hover:text-error transition-fast"
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
          aria-label="Delete document"
          title="Delete"
        >
          <Trash2 size={16} className="text-text-secondary" />
        </button>
      </div>

      {/* Thumbnail Area */}
      <div className="aspect-[3/4] flex items-center justify-center bg-bg-sunken relative">
        {document.thumbnailPath ? (
          <img
            src={`docuflow:///${document.thumbnailPath.replace(/\\/g, '/')}`}
            alt={document.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-2">
            {getTypeIcon()}
            <span className="text-xs text-text-muted font-mono">
              {document.type}
            </span>
          </div>
        )}

        {/* Page Count Badge */}
        {document.pageCount > 1 && (
          <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 text-white text-xs font-mono rounded">
            {document.pageCount} pages
          </div>
        )}
      </div>

      {/* Document Info */}
      <div className="p-3">
        <p className="text-sm font-medium text-text-primary truncate mb-1" title={document.filename}>
          {document.filename}
        </p>
        <p className="text-xs text-text-muted font-mono">
          {formatFileSize(document.size)}
        </p>
      </div>
    </div>
  );
}

export default DocumentCard;
