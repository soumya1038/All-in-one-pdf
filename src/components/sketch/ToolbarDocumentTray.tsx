import React, { useEffect, useState } from 'react';
import { Check, FileImage, FileText, X } from 'lucide-react';
import { DocumentItem, DocumentType } from '../../types/Document.types';

interface ToolbarDocumentTrayProps {
  documents: DocumentItem[];
  activeDocIds: Set<string>;
  onToggleDocument: (doc: DocumentItem, insert: boolean) => void;
  onRemoveDocument: (docId: string) => void;
}

// Global thumbnail cache across renders to prevent IPC refetching and re-renders
const thumbnailCache = new Map<string, string>();

// Hook to load thumbnail preview for a document (image or PDF page 1)
function useDocumentThumbnail(doc: DocumentItem): string | null {
  const [thumbUrl, setThumbUrl] = useState<string | null>(() => thumbnailCache.get(doc.id) || null);

  useEffect(() => {
    if (thumbnailCache.has(doc.id)) {
      setThumbUrl(thumbnailCache.get(doc.id)!);
      return;
    }
    let cancelled = false;

    async function loadThumbnail() {
      try {
        let resultUrl: string | null = null;
        if (doc.type === DocumentType.IMAGE) {
          if (window.electron?.readImageAsDataUrl) {
            const res = await window.electron.readImageAsDataUrl(doc.tempPath);
            if (res.success && res.data) {
              resultUrl = res.data;
            }
          }
          if (!resultUrl && doc.thumbnailPath && window.electron?.readImageAsDataUrl) {
            const thumbRes = await window.electron.readImageAsDataUrl(doc.thumbnailPath);
            if (thumbRes.success && thumbRes.data) {
              resultUrl = thumbRes.data;
            }
          }
          if (!resultUrl) {
            resultUrl = `docuflow:///${doc.tempPath.replace(/\\/g, '/')}`;
          }
        } else if (doc.type === DocumentType.PDF) {
          if (doc.thumbnailPath && window.electron?.readImageAsDataUrl) {
            const thumbRes = await window.electron.readImageAsDataUrl(doc.thumbnailPath);
            if (thumbRes.success && thumbRes.data) {
              resultUrl = thumbRes.data;
            }
          }
          if (!resultUrl && window.electron?.renderPdfPage) {
            const renderRes = await window.electron.renderPdfPage(doc.id, 1);
            if (renderRes.success && renderRes.data) {
              if (window.electron?.readImageAsDataUrl) {
                const readRes = await window.electron.readImageAsDataUrl(renderRes.data);
                if (readRes.success && readRes.data) {
                  resultUrl = readRes.data;
                }
              }
              if (!resultUrl) {
                resultUrl = `docuflow:///${renderRes.data.replace(/\\/g, '/')}`;
              }
            }
          }
        }
        if (resultUrl && !cancelled) {
          thumbnailCache.set(doc.id, resultUrl);
          setThumbUrl(resultUrl);
        }
      } catch (err) {
        console.warn('Could not load thumbnail for', doc.filename, err);
      }
    }

    loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [doc.id, doc.tempPath, doc.thumbnailPath, doc.type]);

  return thumbUrl;
}

// Individual document thumbnail preview item in toolbar
const ToolbarDocItem: React.FC<{
  doc: DocumentItem;
  isActive: boolean;
  onToggle: (doc: DocumentItem, insert: boolean) => void;
  onRemove: (docId: string) => void;
}> = React.memo(({ doc, isActive, onToggle, onRemove }) => {
  const thumbUrl = useDocumentThumbnail(doc);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onToggle(doc, !isActive);
      }}
      className={`sketch-tray-item ${isActive ? 'is-active' : ''}`}
      title={`${doc.filename} — Click to ${isActive ? 'remove from' : 'place on'} canvas`}
    >
      <div className="sketch-tray-thumb-wrap">
        {thumbUrl ? (
          <img src={thumbUrl} alt={doc.filename} className="sketch-tray-thumb" />
        ) : doc.type === DocumentType.PDF ? (
          <FileText size={16} className="text-red-500" />
        ) : (
          <FileImage size={16} className="text-blue-500" />
        )}
      </div>

      {/* Clean Tick Mark Badge on corner when active on canvas */}
      {isActive && (
        <div className="sketch-tray-tick-badge" title="Active on canvas">
          <Check size={9} strokeWidth={3.5} />
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(doc.id);
        }}
        className="sketch-tray-remove-btn"
        title="Remove document from session"
      >
        <X size={10} />
      </button>
    </div>
  );
});

export const ToolbarDocumentTray: React.FC<ToolbarDocumentTrayProps> = React.memo(({
  documents,
  activeDocIds,
  onToggleDocument,
  onRemoveDocument,
}) => {
  // Filter supported document types (images and PDFs)
  const supportedDocs = documents.filter(
    (d) => d.type === DocumentType.IMAGE || d.type === DocumentType.PDF
  );

  if (supportedDocs.length === 0) {
    return null;
  }

  return (
    <div className="sketch-toolbar-docs-tray" data-testid="sketch-toolbar-docs-tray">
      {/* Uploaded and pre-uploaded document preview items — grows to the right */}
      {supportedDocs.map((doc) => (
        <ToolbarDocItem
          key={doc.id}
          doc={doc}
          isActive={activeDocIds.has(doc.id)}
          onToggle={onToggleDocument}
          onRemove={onRemoveDocument}
        />
      ))}
    </div>
  );
});
