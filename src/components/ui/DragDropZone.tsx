import { useCallback, useState } from 'react';
import { Upload, FileText, Image, FileSpreadsheet } from 'lucide-react';
import { ACCEPTED_EXTENSIONS } from '../../constants/ACCEPTED_TYPES';

export interface DragDropZoneProps {
  onFilesDropped: (files: File[]) => void;
  accept?: string[];
  multiple?: boolean;
  disabled?: boolean;
}

/**
 * Drag-and-drop zone for file uploads
 */
function DragDropZone({
  onFilesDropped,
  accept = ACCEPTED_EXTENSIONS,
  multiple = true,
  disabled = false,
}: DragDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        setIsDragging(true);
      }
    },
    [disabled]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.currentTarget === e.target) {
        setIsDragging(false);
      }
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFilesDropped(files);
      }
    },
    [disabled, onFilesDropped]
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        onFilesDropped(files);
        e.target.value = ''; // Reset input
      }
    },
    [onFilesDropped]
  );

  const handleClick = async () => {
    if (!disabled) {
      try {
        const result = await window.electron.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: 'Documents', extensions: accept.map(ext => ext.replace('.', '')) }
          ]
        });

        if (result.success && result.data && result.data.length > 0) {
          const filesToUpload = result.data.map(path => {
            const file = new File([], path.split(/[\\/]/).pop() || '');
            Object.defineProperty(file, 'path', { value: path });
            return file;
          });
          
          onFilesDropped(filesToUpload);
        }
      } catch (error) {
        console.error('Failed to open native dialog', error);
      }
    }
  };

  const getFileTypeIcon = () => {
    if (isDragging) {
      // Show appropriate icon based on dragged file type
      return <FileText size={48} className="text-accent" />;
    }
    return <Upload size={48} className="text-text-muted" />;
  };

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-normal
        ${isDragging ? 'border-accent bg-accent-light' : 'border-border bg-bg-surface hover:border-accent/50 hover:bg-bg-sunken'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      aria-label="Upload files"
    >
      <input
        id="file-input"
        type="file"
        className="hidden"
        accept={accept.join(',')}
        multiple={multiple}
        onChange={handleFileInputChange}
        disabled={disabled}
      />

      <div className="flex flex-col items-center gap-4">
        {getFileTypeIcon()}
        <div>
          <p className="text-lg font-medium text-text-primary mb-1">
            {isDragging ? 'Drop files here' : 'Drop files to upload'}
          </p>
          <p className="text-sm text-text-secondary">
            or <span className="text-accent font-medium">click to browse</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-text-muted">
          <FileText size={16} />
          <Image size={16} />
          <FileSpreadsheet size={16} />
        </div>
        <p className="text-xs text-text-muted">
          PDF, Images, Word, Excel, PowerPoint, Text
        </p>
      </div>
    </div>
  );
}

export default DragDropZone;
