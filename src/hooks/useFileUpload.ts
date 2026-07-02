import { useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { MAX_SESSION_SIZE_WARNING } from '../constants/ACCEPTED_TYPES';
import { formatFileSize } from '../utils/formatFileSize';
import { AppView, WorkflowType } from '../types/UI.types';
import { OutputFormat } from '../types/Output.types';

/**
 * Hook for handling file uploads with validation and IPC communication.
 *
 * BUG FIX (size=0):
 * Files opened through the native Electron dialog are represented as mock File
 * objects whose .size is always 0 because the renderer process doesn't actually
 * read the file bytes — only the main process does.
 * 
 * To get the real size, we rely on the DocumentItem returned from the IPC
 * call (window.electron.uploadFiles), which reads the actual stat() size on
 * the main side. Session-size warnings are therefore deferred until after IPC.
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

      // ── Workflow-level input constraints ────────────────────────────────
      if (
        activeWorkflow === WorkflowType.COMPRESS ||
        activeWorkflow === WorkflowType.SPLIT ||
        activeWorkflow === WorkflowType.PROTECT
      ) {
        if (files.length > 1 || documents.length > 0) {
          toast.error('This action accepts exactly one PDF document.');
          return;
        }
        const file = files[0];
        const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
        if (!isPdf) {
          toast.error('Only PDF documents are accepted for this action.');
          return;
        }
      } else if (activeWorkflow === WorkflowType.MERGE) {
        for (const file of files) {
          const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
          if (!isPdf) {
            toast.error('Only PDF documents are accepted for merging.');
            return;
          }
        }
      } else if (activeWorkflow === WorkflowType.CONVERT) {
        if (files.length > 1 || documents.length > 0) {
          toast.error('This action accepts exactly one document for conversion.');
          return;
        }
      }

      setIsUploading(true);

      try {
        // Collect file paths — for native dialog files, path is the real FS path
        // For drag-and-drop files, use .path if available (Electron adds it), else .name
        const filePaths = files.map(
          (file) => (file as File & { path?: string }).path || file.name
        );

        // ── IPC call ───────────────────────────────────────────────────────
        // uploadFiles in main process copies files to temp dir and returns
        // DocumentItem[] with REAL file sizes from stat().
        const result = await window.electron.uploadFiles(filePaths);

        if (result.success) {
          const uploadedDocs = result.data;

          if (uploadedDocs.length === 0) {
            toast.error('No valid files were uploaded');
            setIsUploading(false);
            return;
          }

          // Check session size WARNING using real sizes returned from IPC
          const uploadedSize = uploadedDocs.reduce((sum, doc) => sum + doc.size, 0);
          const existingSize = documents.reduce((sum, doc) => sum + doc.size, 0);
          const totalSize = existingSize + uploadedSize;

          if (totalSize > MAX_SESSION_SIZE_WARNING) {
            // Use in-app confirm dialog instead of native dialog
            const confirmed = await useAppStore.getState().showConfirm(
              `Total session size (${formatFileSize(totalSize)}) exceeds ${formatFileSize(
                MAX_SESSION_SIZE_WARNING
              )}. Processing large files may be slow. Continue?`,
              'Large Session Warning'
            );
            if (!confirmed) {
              // Clean up the just-uploaded docs since user cancelled
              for (const doc of uploadedDocs) {
                await window.electron.deleteFile(doc.id).catch(() => {});
              }
              setIsUploading(false);
              return;
            }
          }

          addDocuments(uploadedDocs);

          const skippedCount = files.length - uploadedDocs.length;
          if (skippedCount > 0) {
            toast.error(`${skippedCount} file(s) were invalid and skipped`);
          }

          const label = uploadedDocs.length === 1 ? 'file' : 'files';
          toast.success(
            `${uploadedDocs.length} ${label} added (${formatFileSize(uploadedSize)})`
          );

          // ── Navigate to next screen based on workflow ─────────────────────
          const firstDoc = uploadedDocs[0];
          const fileBaseName = firstDoc.filename.substring(0, firstDoc.filename.lastIndexOf('.')) || firstDoc.filename;

          if (activeWorkflow === WorkflowType.COMPRESS) {
            updateOutputOptions({ format: OutputFormat.PDF, compress: true, filename: `${fileBaseName}_compressed` });
            setView(AppView.OUTPUT_OPTIONS);
          } else if (activeWorkflow === WorkflowType.PROTECT) {
            updateOutputOptions({ format: OutputFormat.PDF, protection: { enabled: true }, filename: `${fileBaseName}_protected` });
            setView(AppView.OUTPUT_OPTIONS);
          } else if (activeWorkflow === WorkflowType.CONVERT) {
            updateOutputOptions({ filename: `${fileBaseName}_converted` });
            setView(AppView.OUTPUT_OPTIONS);
          } else if (activeWorkflow === WorkflowType.SPLIT) {
            updateOutputOptions({ format: OutputFormat.PDF, filename: `${fileBaseName}_split` });
            setView(AppView.OUTPUT_OPTIONS);
          } else {
            setView(AppView.DOCUMENT_LIST);
          }
        } else {
          toast.error(result.error.message);
        }
      } catch (error) {
        console.error('Upload error:', error);
        toast.error('Failed to upload files. Please try again.');
      } finally {
        setIsUploading(false);
      }
    },
    [addDocuments, documents, setView, activeWorkflow, updateOutputOptions]
  );

  return {
    uploadFiles,
    isUploading,
  };
}
