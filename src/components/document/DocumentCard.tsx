import React, { HTMLAttributes } from 'react';
import { 
  FileText, Trash2, GripVertical, File, Pencil, Camera, 
  Minimize, ArrowRightLeft, Scissors, Lock, ScanText, Sheet, Eye, Paintbrush 
} from 'lucide-react';
import { DocumentItem, DocumentType } from '../../types/Document.types';
import { formatFileSize } from '../../utils/formatFileSize';
import { useAppStore } from '../../store/appStore';
import { AppView, WorkflowType } from '../../types/UI.types';
import { OutputFormat } from '../../types/Output.types';
import { toast } from 'react-hot-toast';

export interface DocumentCardProps {
  document: DocumentItem;
  onPreview?: () => void;
  onDelete?: () => void;
  isDragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
}

/**
 * Document card component for displaying and individually managing documents in grid/list
 */
function DocumentCard({ 
  document, 
  onPreview, 
  onDelete, 
  isDragging = false,
  dragHandleProps
}: DocumentCardProps) {
  const setView = useAppStore((state) => state.setView);
  const setSelectedDocument = useAppStore((state) => state.setSelectedDocument);
  const setActiveWorkflow = useAppStore((state) => state.setActiveWorkflow);
  const updateOutputOptions = useAppStore((state) => state.updateOutputOptions);
  const setExcelEditorState = useAppStore((state) => state.setExcelEditorState);

  const getTypeIcon = () => {
    switch (document.type) {
      case DocumentType.PDF:
        return <FileText size={24} className="text-red-500" />;
      case DocumentType.IMAGE:
        return <File size={24} className="text-emerald-500" />;
      case DocumentType.WORD:
        return <FileText size={24} className="text-accent" />;
      case DocumentType.EXCEL:
        return <Sheet size={24} className="text-green-600" />;
      case DocumentType.POWERPOINT:
        return <File size={24} className="text-amber-500" />;
      case DocumentType.TEXT:
        return <FileText size={24} className="text-text-muted" />;
      default:
        return <File size={24} className="text-text-muted" />;
    }
  };

  const handleAction = async (e: React.MouseEvent, actionType: string) => {
    e.stopPropagation();
    setSelectedDocument(document.id);

    const baseName = document.filename.substring(0, document.filename.lastIndexOf('.')) || document.filename;

    switch (actionType) {
      case 'SKETCH':
        setActiveWorkflow(WorkflowType.NONE);
        setView(AppView.SKETCH_EDITOR);
        break;

      case 'CANVAS_EDITOR':
        setActiveWorkflow(WorkflowType.NONE);
        setView(AppView.CANVAS_EDITOR);
        break;

      case 'PASSPORT_PHOTO':
        setActiveWorkflow(WorkflowType.NONE);
        setView(AppView.IMAGE_EDIT);
        break;

      case 'OCR':
        setActiveWorkflow(WorkflowType.NONE);
        setView(AppView.OCR);
        break;

      case 'COMPRESS_IMAGE': {
        const ext = document.filename.toLowerCase();
        let format = OutputFormat.JPEG;
        if (ext.endsWith('.png')) format = OutputFormat.PNG;
        else if (ext.endsWith('.tiff') || ext.endsWith('.tif')) format = OutputFormat.TIFF;

        setActiveWorkflow(WorkflowType.COMPRESS_IMAGE);
        updateOutputOptions({
          format,
          compress: true,
          filename: `${baseName}_compressed`,
          documentId: document.id,
        });
        setView(AppView.OUTPUT_OPTIONS);
        break;
      }

      case 'COMPRESS_PDF':
        setActiveWorkflow(WorkflowType.COMPRESS);
        updateOutputOptions({
          format: OutputFormat.PDF,
          compress: true,
          filename: `${baseName}_compressed`,
          documentId: document.id,
        });
        setView(AppView.OUTPUT_OPTIONS);
        break;

      case 'CONVERT':
        setActiveWorkflow(WorkflowType.CONVERT);
        updateOutputOptions({
          filename: `${baseName}_converted`,
          documentId: document.id,
        });
        setView(AppView.OUTPUT_OPTIONS);
        break;

      case 'SPLIT':
        setActiveWorkflow(WorkflowType.SPLIT);
        updateOutputOptions({
          format: OutputFormat.PDF,
          filename: `${baseName}_split`,
          documentId: document.id,
        });
        setView(AppView.OUTPUT_OPTIONS);
        break;

      case 'PROTECT':
        setActiveWorkflow(WorkflowType.PROTECT);
        updateOutputOptions({
          format: OutputFormat.PDF,
          protection: { enabled: true },
          filename: `${baseName}_protected`,
          documentId: document.id,
        });
        setView(AppView.OUTPUT_OPTIONS);
        break;

      case 'EXCEL': {
        try {
          const res = await window.electron.openExcel(document.tempPath);
          if (res.success) {
            setExcelEditorState({
              isOpen: true,
              filePath: document.originalPath,
              workbookData: res.data,
              isDirty: false,
              isLoading: false,
            });
            setView(AppView.EXCEL_EDITOR);
          } else {
            toast.error('Failed to open spreadsheet');
          }
        } catch {
          toast.error('Failed to open spreadsheet');
        }
        break;
      }

      default:
        break;
    }
  };

  return (
    <div
      className={`
        group relative bg-bg-surface rounded-xl border border-border overflow-hidden
        transition-all duration-normal hover:shadow-lg hover:border-accent flex flex-col justify-between
        ${isDragging ? 'opacity-50 scale-105 shadow-drag' : ''}
      `}
    >
      {/* Top Header Floating Controls */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
        {/* Drag Handle (visible on hover) */}
        <div 
          className="opacity-0 group-hover:opacity-100 transition-fast"
          {...dragHandleProps}
        >
          <div className="p-1 bg-black/60 hover:bg-black/80 rounded-md text-white cursor-grab active:cursor-grabbing backdrop-blur-xs">
            <GripVertical size={14} />
          </div>
        </div>
      </div>

      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-fast">
        {/* Preview Quick Button */}
        {onPreview && (
          <button
            className="p-1.5 bg-black/60 hover:bg-black/80 rounded-md text-white transition-fast backdrop-blur-xs"
            onClick={(e) => {
              e.stopPropagation();
              onPreview();
            }}
            aria-label="Preview document"
            title="Preview"
          >
            <Eye size={13} />
          </button>
        )}

        {/* Delete button */}
        {onDelete && (
          <button
            className="p-1.5 bg-red-600/80 hover:bg-red-600 rounded-md text-white transition-fast backdrop-blur-xs"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Delete document"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Thumbnail Area */}
      <div 
        className="aspect-[4/3] flex items-center justify-center bg-bg-sunken relative cursor-pointer overflow-hidden"
        onClick={onPreview}
        title="Click to preview"
      >
        {document.thumbnailPath ? (
          <img
            src={`docuflow:///${document.thumbnailPath.replace(/\\/g, '/')}`}
            alt={document.filename}
            className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            {getTypeIcon()}
            <span className="text-[10px] text-text-muted font-mono font-medium">
              {document.type}
            </span>
          </div>
        )}

        {/* Page Count Badge */}
        {document.pageCount > 1 && (
          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 bg-black/75 text-white text-[10px] font-mono rounded backdrop-blur-xs">
            {document.pageCount} pages
          </div>
        )}
      </div>

      {/* Document Info */}
      <div className="p-3 border-b border-border/60">
        <p className="text-xs font-semibold text-text-primary truncate" title={document.filename}>
          {document.filename}
        </p>
        <div className="flex items-center justify-between text-[11px] text-text-muted font-mono mt-0.5">
          <span>{document.type}</span>
          <span>{formatFileSize(document.size)}</span>
        </div>
      </div>

      {/* Action Buttons: Edit & Work on this file individually */}
      <div className="p-2 bg-bg-base/50 flex flex-wrap gap-1">
        {document.type === DocumentType.IMAGE && (
          <>
            <button
              onClick={(e) => handleAction(e, 'CANVAS_EDITOR')}
              className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Open in Canva-style Image Editor"
            >
              <Pencil size={11} className="text-accent group-hover:text-white" />
              <span>Editor</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'PASSPORT_PHOTO')}
              className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Create passport photos from this image"
            >
              <Camera size={11} className="text-accent group-hover:text-white" />
              <span>Passport</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'COMPRESS_IMAGE')}
              className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Compress this image"
            >
              <Minimize size={11} className="text-accent group-hover:text-white" />
              <span>Compress</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'OCR')}
              className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Run Offline OCR on this image"
            >
              <ScanText size={11} className="text-accent group-hover:text-white" />
              <span>OCR</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'SKETCH')}
              className="flex-1 min-w-[70px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Draw and annotate on Sketch Canvas"
            >
              <Paintbrush size={11} className="text-accent group-hover:text-white" />
              <span>Sketch</span>
            </button>
          </>
        )}

        {document.type === DocumentType.PDF && (
          <>
            <button
              onClick={(e) => handleAction(e, 'COMPRESS_PDF')}
              className="flex-1 min-w-[65px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Compress this PDF document"
            >
              <Minimize size={11} className="text-accent group-hover:text-white" />
              <span>Compress</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'SPLIT')}
              className="flex-1 min-w-[65px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Split this PDF document"
            >
              <Scissors size={11} className="text-accent group-hover:text-white" />
              <span>Split</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'PROTECT')}
              className="flex-1 min-w-[65px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Password protect this PDF"
            >
              <Lock size={11} className="text-accent group-hover:text-white" />
              <span>Protect</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'OCR')}
              className="flex-1 min-w-[65px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Run Offline OCR on this PDF"
            >
              <ScanText size={11} className="text-accent group-hover:text-white" />
              <span>OCR</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'SKETCH')}
              className="flex-1 min-w-[65px] flex items-center justify-center gap-1 py-1 px-1.5 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
              title="Annotate this PDF on Sketch Canvas"
            >
              <Paintbrush size={11} className="text-accent group-hover:text-white" />
              <span>Sketch</span>
            </button>
          </>
        )}

        {document.type === DocumentType.EXCEL && (
          <button
            onClick={(e) => handleAction(e, 'EXCEL')}
            className="w-full flex items-center justify-center gap-1 py-1 px-2 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
            title="Open in Excel Editor"
          >
            <Sheet size={12} className="text-green-600 group-hover:text-white" />
            <span>Open in Spreadsheet Editor</span>
          </button>
        )}

        {document.type !== DocumentType.IMAGE && document.type !== DocumentType.PDF && document.type !== DocumentType.EXCEL && (
          <button
            onClick={(e) => handleAction(e, 'CONVERT')}
            className="w-full flex items-center justify-center gap-1 py-1 px-2 text-[11px] font-medium rounded bg-bg-surface hover:bg-accent hover:text-white border border-border hover:border-accent transition-fast text-text-primary"
            title="Convert this document"
          >
            <ArrowRightLeft size={12} />
            <span>Convert Format</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default DocumentCard;
