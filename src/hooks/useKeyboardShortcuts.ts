import { useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView, ModalType, WorkflowType } from '../types/UI.types';
import { OutputFormat } from '../types/Output.types';
import { ScannerStatus } from '../types/Scanner.types';

/**
 * Hook for handling global keyboard shortcuts
 */
export function useKeyboardShortcuts() {
  const currentView = useAppStore((state) => state.ui.currentView);
  const modal = useAppStore((state) => state.ui.modal);
  const isLoading = useAppStore((state) => state.ui.isLoading);
  const scannerStatus = useAppStore((state) => state.scannerStatus.status);
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);

  const isProcessing =
    currentView === AppView.PROCESSING ||
    isLoading ||
    scannerStatus === ScannerStatus.SCANNING ||
    scannerStatus === ScannerStatus.CHECKING ||
    (activeWorkflow !== WorkflowType.NONE && useAppStore.getState().documents.length > 0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore all shortcuts if a process is active
      if (isProcessing) return;

      // Escape — close modal
      if (e.key === 'Escape' && modal.type !== ModalType.NONE) {
        e.preventDefault();
        useAppStore.getState().closeModal();
        return;
      }

      // ── Ctrl+O — Open files (Home screen) ─────────────────────────────────
      if (e.ctrlKey && !e.shiftKey && e.key === 'o') {
        e.preventDefault();
        if (currentView === AppView.HOME) {
          document.getElementById('upload-drop-zone')?.click();
        }
        return;
      }

      // ── Ctrl+Shift+S — Scan ────────────────────────────────────────────────
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        useAppStore.getState().openModal(ModalType.SCANNER);
        return;
      }

      // ── Ctrl+M — Merge PDFs ───────────────────────────────────────────────
      if (e.ctrlKey && !e.shiftKey && e.key === 'm') {
        e.preventDefault();
        const state = useAppStore.getState();
        const docs = state.documents;
        if (docs.length === 0) {
          // No documents — let sidebar handle the upload flow
          toast('Use the sidebar "Merge PDFs" button to upload files first.', { icon: 'ℹ️' });
          return;
        }
        const allPdfs = docs.every((d) => d.type === 'PDF');
        if (!allPdfs) {
          toast.error('Merge requires all documents to be PDFs.');
          return;
        }
        state.setActiveWorkflow(WorkflowType.MERGE);
        state.updateOutputOptions({ mergeAsSingle: true, format: OutputFormat.PDF });
        state.setView(AppView.DOCUMENT_LIST);
        return;
      }

      // ── Ctrl+Shift+C — Compress PDF ───────────────────────────────────────
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const state = useAppStore.getState();
        const docs = state.documents;
        if (docs.length === 0) {
          toast('Use the sidebar "Compress PDF" button to upload a file first.', { icon: 'ℹ️' });
          return;
        }
        if (docs.length !== 1 || docs[0].type !== 'PDF') {
          toast.error('Compress requires exactly one PDF document.');
          return;
        }
        state.setActiveWorkflow(WorkflowType.COMPRESS);
        state.updateOutputOptions({ format: OutputFormat.PDF });
        state.setView(AppView.OUTPUT_OPTIONS);
        return;
      }

      // ── Ctrl+E — Convert ─────────────────────────────────────────────────
      if (e.ctrlKey && !e.shiftKey && e.key === 'e') {
        e.preventDefault();
        const state = useAppStore.getState();
        const docs = state.documents;
        if (docs.length === 0) {
          toast('Use the sidebar "Convert Format" button to upload a file first.', { icon: 'ℹ️' });
          return;
        }
        if (docs.length !== 1) {
          toast.error('Convert requires exactly one document.');
          return;
        }
        state.setActiveWorkflow(WorkflowType.CONVERT);
        state.setView(AppView.OUTPUT_OPTIONS);
        return;
      }

      // ── Ctrl+Shift+P — Split PDF ─────────────────────────────────────────
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        const state = useAppStore.getState();
        const docs = state.documents;
        if (docs.length === 0) {
          toast('Use the sidebar "Split PDF" button to upload a file first.', { icon: 'ℹ️' });
          return;
        }
        if (docs.length !== 1 || docs[0].type !== 'PDF') {
          toast.error('Split requires exactly one PDF document.');
          return;
        }
        state.setActiveWorkflow(WorkflowType.SPLIT);
        state.updateOutputOptions({ format: OutputFormat.PDF });
        state.setView(AppView.OUTPUT_OPTIONS);
        return;
      }

      // ── Ctrl+Shift+L — Protect PDF ────────────────────────────────────────
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        const state = useAppStore.getState();
        const docs = state.documents;
        if (docs.length === 0) {
          toast('Use the sidebar "Protect PDF" button to upload a file first.', { icon: 'ℹ️' });
          return;
        }
        if (docs.length !== 1 || docs[0].type !== 'PDF') {
          toast.error('Protect requires exactly one PDF document.');
          return;
        }
        state.setActiveWorkflow(WorkflowType.PROTECT);
        state.updateOutputOptions({ format: OutputFormat.PDF, protection: { enabled: true } });
        state.setView(AppView.OUTPUT_OPTIONS);
        return;
      }

      // ── Ctrl+S — Trigger process (from Output Options screen) ─────────────
      if (e.ctrlKey && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        if (currentView === AppView.OUTPUT_OPTIONS) {
          document.getElementById('process-output-button')?.click();
        }
        return;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, modal, isProcessing]);
}
