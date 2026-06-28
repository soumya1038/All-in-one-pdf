import { useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { MAX_SESSION_SIZE_WARNING } from '../constants/ACCEPTED_TYPES';
import { formatFileSize } from '../utils/formatFileSize';
import { AppView, WorkflowType } from '../types/UI.types';
import { OutputFormat } from '../types/Output.types';

/**
 * Hook for handling file uploads with validation and IPC communication
 */
export function useFileUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const addDocuments = useAppStore((state) => state.addDocuments);
  const documents = useAppStore((state) => state.documents);
  const setView = useAppStore((state) => state.setView);
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);
  const updateOutputOptions = useAppStore((state) => state.updateOutputOptions);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      // 1. Enforce workflow input constraints
      if (activeWorkflow === WorkflowType.COMPRESS || activeWorkflow === WorkflowType.SPLIT || activeWorkflow === WorkflowType.PROTECT) {
        // Enforce exactly one file
        if (files.length > 1 || documents.length > 0) {
          toast.error('This action accepts exactly one PDF document.');
          return;
        }
        // Enforce PDF format
        const file = files[0];
        const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
        if (!isPdf) {
          toast.error('Only PDF documents are accepted for this action.');
          return;
        }
      } else if (activeWorkflow === WorkflowType.MERGE) {
        // Enforce PDF format on all uploaded files
        for (const file of files) {
          const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
          if (!isPdf) {
            toast.error('Only PDF documents are accepted for merging.');
            return;
          }
        }
      } else if (activeWorkflow === WorkflowType.CONVERT) {
        // Enforce exactly one document
        if (files.length > 1 || documents.length > 0) {
          toast.error('This action accepts exactly one document for conversion.');
          return;
        }
      }

      setIsUploading(true);

      try {
        // Get file paths
        const filePaths = files.map((file) => (file as File & { path?: string }).path || file.name);

        // Check total session size
        const newFilesSize = files.reduce((sum, file) => sum + file.size, 0);
        const currentSize = documents.reduce((sum, doc) => sum + doc.size, 0);
        const totalSize = currentSize + newFilesSize;

        if (totalSize > MAX_SESSION_SIZE_WARNING) {
          const confirmed = window.confirm(
            `Total file size (${formatFileSize(totalSize)}) exceeds ${formatFileSize(MAX_SESSION_SIZE_WARNING)}. This may affect performance. Continue?`
          );
          if (!confirmed) {
            setIsUploading(false);
            return;
          }
        }

        // Call IPC to upload files
        const result = await window.electron.uploadFiles(filePaths);

        if (result.success) {
          const uploadedDocs = result.data;

          if (uploadedDocs.length === 0) {
            toast.error('No valid files were uploaded');
            setIsUploading(false);
            return;
          }

          // Add documents to store
          addDocuments(uploadedDocs);

          // Show success message
          const skippedCount = files.length - uploadedDocs.length;
          if (skippedCount > 0) {
            toast.error(`${skippedCount} file(s) were invalid and skipped`);
          }
          toast.success(`${uploadedDocs.length} file(s) uploaded successfully`);

          // 2. Navigate based on the active workflow
          if (activeWorkflow === WorkflowType.COMPRESS) {
            updateOutputOptions({ format: OutputFormat.PDF });
            setView(AppView.OUTPUT_OPTIONS);
          } else if (activeWorkflow === WorkflowType.PROTECT) {
            updateOutputOptions({ format: OutputFormat.PDF, protection: { enabled: true } });
            setView(AppView.OUTPUT_OPTIONS);
          } else if (activeWorkflow === WorkflowType.CONVERT) {
            setView(AppView.OUTPUT_OPTIONS);
          } else if (activeWorkflow === WorkflowType.SPLIT) {
            updateOutputOptions({ format: OutputFormat.PDF });
            setView(AppView.OUTPUT_OPTIONS);
          } else {
            setView(AppView.DOCUMENT_LIST);
          }
        } else {
          toast.error(result.error.message);
        }
      } catch (error) {
        console.error('Upload error:', error);
        toast.error('Failed to upload files');
      } finally {
        setIsUploading(false);
      }
    },
    [addDocuments, documents, setView]
  );

  return {
    uploadFiles,
    isUploading,
  };
}
