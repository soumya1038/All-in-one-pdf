import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { AppView, ModalType, WorkflowType } from '../types/UI.types';
import { ScannerStatus } from '../types/Scanner.types';

/**
 * Hook for handling global keyboard shortcuts
 */
export function useKeyboardShortcuts() {
  const currentView = useAppStore((state) => state.ui.currentView);
  const modal = useAppStore((state) => state.ui.modal);
  const isLoading = useAppStore((state) => state.ui.isLoading);
  const scannerStatus = useAppStore((state) => state.scannerStatus.status);
  const setView = useAppStore((state) => state.setView);
  const openModal = useAppStore((state) => state.openModal);
  const closeModal = useAppStore((state) => state.closeModal);
  const documents = useAppStore((state) => state.documents);
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);

  const isProcessing = 
    currentView === AppView.PROCESSING || 
    isLoading || 
    scannerStatus === ScannerStatus.SCANNING || 
    scannerStatus === ScannerStatus.CHECKING ||
    (activeWorkflow !== WorkflowType.NONE && documents.length > 0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore all shortcuts if a process is active
      if (isProcessing) return;

      // Escape - close modal
      if (e.key === 'Escape' && modal.type !== ModalType.NONE) {
        closeModal();
        return;
      }

      // Ctrl+O - Upload files
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        if (currentView === AppView.HOME) {
          // Trigger file input
          document.getElementById('file-input')?.click();
        }
        return;
      }

      // Ctrl+Shift+S - Scan
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        openModal(ModalType.SCANNER);
        return;
      }

      // Ctrl+M - Merge PDFs
      if (e.ctrlKey && e.key === 'm') {
        e.preventDefault();
        // TODO: Navigate to merge
        return;
      }

      // Ctrl+Shift+C - Compress PDF
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        // TODO: Navigate to compress
        return;
      }

      // Ctrl+E - Convert
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        // TODO: Navigate to convert
        return;
      }

      // Ctrl+Z - Undo (reorder)
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        // TODO: Implement undo
        return;
      }

      // Delete - Delete selected document
      if (e.key === 'Delete') {
        // TODO: Delete selected document
        return;
      }

      // Space - Preview document
      if (e.key === ' ' && currentView === AppView.DOCUMENT_LIST) {
        e.preventDefault();
        // TODO: Open preview
        return;
      }

      // Ctrl+S - Save output
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (currentView === AppView.OUTPUT_OPTIONS) {
          // Trigger process
          setView(AppView.PROCESSING);
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentView, modal, setView, openModal, closeModal, isProcessing]);
}
