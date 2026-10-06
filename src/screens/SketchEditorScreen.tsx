import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Excalidraw, 
  exportToBlob,
  convertToExcalidrawElements,
  CaptureUpdateAction,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw';
import type { 
  ExcalidrawImperativeAPI, 
  ExcalidrawInitialDataState, 
  BinaryFileData,
  UIOptions 
} from '@excalidraw/excalidraw/types';
import { useAppStore } from '../store/appStore';
import { DocumentItem, DocumentType } from '../types/Document.types';
import { ToolbarDocumentTray } from '../components/sketch/ToolbarDocumentTray';
import { 
  serializeExcalidrawSketchScene, 
  type ExcalidrawSketchScene 
} from '../components/sketch/sketch-model';
import '../components/sketch/sketch.css';
import { registerUploadedFile } from '../utils/fileUploadHelper';
import { AppView } from '../types/UI.types';
import { toast } from 'react-hot-toast';
import { 
  AlertCircle, 
  ArrowLeft, 
  Download, 
  Paintbrush, 
  RotateCcw, 
  Trash2 
} from 'lucide-react';

const STORAGE_KEY = 'docuflow-sketch-canvas-scene';

// Stable UIOptions to prevent re-render loops in Excalidraw
const UI_OPTIONS: Partial<UIOptions> = {
  canvasActions: {
    changeViewBackgroundColor: true,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    toggleTheme: false,
    saveAsImage: false,
  },
};

// Error boundary to prevent white blank screens
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class SketchErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Excalidraw error caught by boundary:', error, errorInfo);
  }

  handleReset = () => {
    localStorage.removeItem(STORAGE_KEY);
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-bg-base text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-500 flex items-center justify-center mb-4">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-lg font-bold text-text-primary mb-2">Sketch Canvas Error</h2>
          <p className="text-sm text-text-secondary max-w-md mb-6">
            An unexpected error occurred while rendering the canvas. You can reset the canvas session to restore normal operation.
          </p>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition-colors shadow-sm"
          >
            <RotateCcw size={16} /> Reset & Reload Canvas
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SketchEditorScreen() {
  const documents = useAppStore((state) => state.documents);
  const removeDocument = useAppStore((state) => state.removeDocument);
  const setView = useAppStore((state) => state.setView);

  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestElementsRef = useRef<readonly any[]>([]);
  const [activeDocIds, setActiveDocIds] = useState<Set<string>>(new Set());
  const [activeTool, setActiveTool] = useState<string>('selection');
  const activeToolRef = useRef<string>('selection');

  // Stable portal container element that never gets recreated
  const trayElRef = useRef<HTMLDivElement | null>(null);
  if (!trayElRef.current) {
    trayElRef.current = document.createElement('div');
    trayElRef.current.id = 'sketch-toolbar-docs-tray';
    trayElRef.current.className = 'sketch-toolbar-docs-tray';
  }
  const [isTrayMounted, setIsTrayMounted] = useState(false);

  const lastActiveKeyRef = useRef<string>('');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial scene safely from localStorage
  const [initialData] = useState<ExcalidrawInitialDataState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.elements)) {
          return {
            elements: parsed.elements,
            appState: parsed.appState || { viewBackgroundColor: '#ffffff' },
            files: parsed.files || {},
          };
        }
      }
    } catch (e) {
      console.warn('Could not restore sketch scene:', e);
    }
    return {
      elements: [],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    };
  });

  // Attach Document Tray directly into Excalidraw's floating toolbar
  // right next to the image tool button with the logo (marked with the green box)
  // and link clicking that button directly to open our file upload dialog
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    const tryAttach = () => {
      const imageTool = wrap.querySelector(
        '[data-testid="toolbar-image"], input[value="image"], [aria-label*="Image"], [title*="Image"]'
      );
      if (!imageTool) return false;

      const imageLabel = imageTool.closest('label') || imageTool.parentElement;
      if (!imageLabel || !imageLabel.parentElement) return false;

      // Ensure image tool has clean native styling without green highlight
      imageLabel.classList.remove('sketch-image-tool-highlight');

      // Link clicking on the button with the logo directly to upload
      if (!imageLabel.getAttribute('data-docuflow-upload-linked')) {
        imageLabel.setAttribute('data-docuflow-upload-linked', 'true');
        imageLabel.setAttribute('title', 'Click to upload and place images or documents on canvas');
        imageLabel.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            uploadInputRef.current?.click();
          },
          true
        );
      }

      const tray = trayElRef.current;
      if (!tray) return false;

      // If already attached right after imageLabel, do nothing!
      if (imageLabel.nextElementSibling === tray) {
        return true;
      }

      imageLabel.insertAdjacentElement('afterend', tray);
      setIsTrayMounted(true);
      return true;
    };

    // Attempt attachment immediately
    tryAttach();

    // Check periodically during the first few seconds to ensure Excalidraw's toolbar is ready
    const intervalId = setInterval(() => {
      tryAttach();
    }, 250);

    // Immediate toolbar click listener to detect tool changes instantly
    const handleToolbarPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.App-toolbar, .ToolIcon, .App-toolbar-content')) {
        setTimeout(() => {
          const api = excalidrawAPIRef.current;
          if (api) {
            const type = api.getAppState()?.activeTool?.type;
            if (type && type !== activeToolRef.current) {
              activeToolRef.current = type;
              setActiveTool(type);
            }
          }
        }, 40);
      }
    };
    wrap.addEventListener('pointerdown', handleToolbarPointerDown, true);

    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
    }, 3500);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      wrap.removeEventListener('pointerdown', handleToolbarPointerDown, true);
      trayElRef.current?.remove();
    };
  }, []); // Run ONLY once on mount

  // API initialization callback - ensures excalidrawAPIRef ALWAYS points to the active instance
  // (handles React StrictMode remounts and hot-reloads properly)
  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawAPIRef.current = api;
    setExcalidrawAPI(api);

    // Initial sync of active tool
    const initialAppState = api.getAppState();
    if (initialAppState?.activeTool?.type) {
      activeToolRef.current = initialAppState.activeTool.type;
      setActiveTool(initialAppState.activeTool.type);
    }

    // Initial sync of active document IDs from scene
    const elements = api.getSceneElements();
    latestElementsRef.current = elements;
    const initialIds: string[] = [];
    for (const el of elements) {
      if (!el.isDeleted && el.type === 'image' && el.customData?.documentId) {
        initialIds.push(el.customData.documentId);
      }
    }
    if (initialIds.length > 0) {
      initialIds.sort();
      lastActiveKeyRef.current = initialIds.join(',');
      setActiveDocIds(new Set(initialIds));
    }
  }, []);

  // Save changes locally and keep activeDocIds in sync without infinite loops
  const handleChange = useCallback((elements: readonly any[], appState: any, files: any) => {
    latestElementsRef.current = elements;

    // Keep active tool in sync
    const currentToolType = appState?.activeTool?.type || 'selection';
    if (currentToolType !== activeToolRef.current) {
      activeToolRef.current = currentToolType;
      setActiveTool(currentToolType);
    }

    // Check if active document IDs on canvas changed
    const activeIds: string[] = [];
    for (const el of elements) {
      if (!el.isDeleted && el.type === 'image' && el.customData?.documentId) {
        activeIds.push(el.customData.documentId);
      }
    }
    activeIds.sort();
    const serialized = activeIds.join(',');
    if (serialized !== lastActiveKeyRef.current) {
      lastActiveKeyRef.current = serialized;
      setActiveDocIds(new Set(activeIds));
    }

    // Debounce scene persistence to localStorage
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try {
        const activeElements = elements.filter((el) => !el.isDeleted);
        if (activeElements.length > 0 || Object.keys(files || {}).length > 0) {
          const sceneToSave: ExcalidrawSketchScene = {
            elements,
            appState: {
              viewBackgroundColor: appState.viewBackgroundColor || '#ffffff',
            },
            files: files || {},
          };
          localStorage.setItem(STORAGE_KEY, serializeExcalidrawSketchScene(sceneToSave));
        }
      } catch {
        // Ignore quota limits
      }
    }, 400);
  }, []);

  // Helper to measure image dimensions
  const getImageDimensions = (src: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || 600, height: img.naturalHeight || 800 });
      img.onerror = () => resolve({ width: 600, height: 800 });
      img.src = src;
    });
  };

  // Read document as base64 image data URL
  const getDocumentImageDataUrl = useCallback(async (doc: DocumentItem): Promise<{ dataUrl: string; width: number; height: number } | null> => {
    try {
      let dataUrl: string | null = null;
      if (doc.type === DocumentType.IMAGE) {
        if (window.electron?.readImageAsDataUrl) {
          const res = await window.electron.readImageAsDataUrl(doc.tempPath);
          if (res.success && res.data) {
            dataUrl = res.data;
          }
        }
        if (!dataUrl && doc.originalPath && window.electron?.readImageAsDataUrl) {
          const res = await window.electron.readImageAsDataUrl(doc.originalPath);
          if (res.success && res.data) {
            dataUrl = res.data;
          }
        }
        if (!dataUrl) {
          dataUrl = `docuflow:///${doc.tempPath.replace(/\\/g, '/')}`;
        }
      } else if (doc.type === DocumentType.PDF) {
        let renderedPath: string | null = null;
        if (window.electron?.renderPdfPage) {
          const renderRes = await window.electron.renderPdfPage(doc.id, 1);
          if (renderRes.success && renderRes.data) {
            renderedPath = renderRes.data;
          }
        }
        if (!renderedPath && doc.thumbnailPath) {
          renderedPath = doc.thumbnailPath;
        }
        if (renderedPath && window.electron?.readImageAsDataUrl) {
          const readRes = await window.electron.readImageAsDataUrl(renderedPath);
          if (readRes.success && readRes.data) {
            dataUrl = readRes.data;
          }
        }
        if (!dataUrl && renderedPath) {
          dataUrl = `docuflow:///${renderedPath.replace(/\\/g, '/')}`;
        }
      }

      if (!dataUrl) return null;

      // Ensure dataUrl is converted to a true data: URL (base64) so Excalidraw never fails
      if (!dataUrl.startsWith('data:')) {
        try {
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (fetchErr) {
          console.warn('Could not convert URL to data URL:', fetchErr);
        }
      }

      const dims = await getImageDimensions(dataUrl);
      return { dataUrl, width: dims.width, height: dims.height };
    } catch (err) {
      console.error('Failed to get document image data:', err);
    }
    return null;
  }, []);

  // Toggle document placement on canvas
  const handleToggleDocument = useCallback(async (doc: DocumentItem, insert: boolean) => {
    const api = excalidrawAPI || excalidrawAPIRef.current;
    if (!api) {
      toast.error('Canvas is still initializing');
      return;
    }

    const currentElements = api.getSceneElements();

    if (insert) {
      const toastId = toast.loading(`Placing "${doc.filename}" onto canvas...`);
      const imgData = await getDocumentImageDataUrl(doc);

      if (!imgData) {
        toast.dismiss(toastId);
        toast.error(`Could not load image for "${doc.filename}"`);
        return;
      }

      const fileId = `file_${doc.id}_${Date.now()}` as any;
      const elementId = `doc_elem_${doc.id}`;

      // Extract mime type accurately
      const mimeMatch = imgData.dataUrl.match(/^data:([^;]+);/);
      const mimeType = (mimeMatch ? mimeMatch[1] : 'image/png') as any;

      // Add binary file to Excalidraw files
      const binaryFile: BinaryFileData = {
        id: fileId,
        dataURL: imgData.dataUrl as any,
        mimeType: mimeType,
        created: Date.now(),
        lastRetrieved: Date.now(),
      };

      // Calculate placement: scale to fit comfortably on screen
      let width = imgData.width;
      let height = imgData.height;
      const maxInitialW = 550;
      if (width > maxInitialW) {
        const ratio = maxInitialW / width;
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      // Calculate center coordinates of current viewport using Excalidraw's own viewportCoordsToSceneCoords
      const appState = api.getAppState();
      const clientX = (appState.width / 2) + (appState.offsetLeft || 0);
      const clientY = (appState.height / 2) + (appState.offsetTop || 0);
      const center = viewportCoordsToSceneCoords({ clientX, clientY }, appState);
      const x = Math.round(center.x - width / 2);
      const y = Math.round(center.y - height / 2);

      // Convert to proper Excalidraw element with fractional index
      const [imageElement] = convertToExcalidrawElements([
        {
          type: 'image',
          id: elementId,
          fileId: fileId,
          x,
          y,
          width,
          height,
          status: 'saved',
          customData: { documentId: doc.id, filename: doc.filename },
        }
      ], { regenerateIds: false });

      // Add file to Excalidraw API first
      api.addFiles([binaryFile]);

      // Filter out any older element for this document, then append new one
      const updatedElements = currentElements.filter(
        (el) => el.id !== elementId && el.customData?.documentId !== doc.id
      );

      api.updateScene({
        elements: [...updatedElements, imageElement],
        appState: {
          selectedElementIds: { [elementId]: true },
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });

      // Call addFiles once more so addNewImagesToImageCache renders the element now present in scene
      api.addFiles([binaryFile]);

      // Mark selected in shelf
      setActiveDocIds((prev) => new Set(prev).add(doc.id));
      toast.dismiss(toastId);
      toast.success(`"${doc.filename}" placed on canvas! You can resize or move it.`);
    } else {
      // Remove document from canvas
      const updatedElements = currentElements.map((el) => {
        if (el.customData?.documentId === doc.id || el.id === `doc_elem_${doc.id}`) {
          return { ...el, isDeleted: true };
        }
        return el;
      });

      api.updateScene({
        elements: updatedElements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      setActiveDocIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.id);
        return next;
      });
      toast.success(`Removed "${doc.filename}" from canvas`);
    }
  }, [excalidrawAPI, getDocumentImageDataUrl]);

  // Upload a new document/image directly from the linked logo button
  const handleUploadFile = useCallback(async (file: File) => {
    try {
      const toastId = toast.loading(`Uploading "${file.name}"...`);
      const docItem = await registerUploadedFile(file);
      if (docItem) {
        toast.dismiss(toastId);
        // Automatically place on canvas and tick it
        await handleToggleDocument(docItem, true);
      } else {
        toast.dismiss(toastId);
        toast.error('Failed to process file');
      }
    } catch (err) {
      console.error('Upload failed:', err);
      toast.error('Failed to upload document');
    }
  }, [handleToggleDocument]);

  // Remove document from session
  const handleRemoveDocumentFromSession = useCallback(async (docId: string) => {
    const api = excalidrawAPI || excalidrawAPIRef.current;
    if (api) {
      const currentElements = api.getSceneElements();
      const updatedElements = currentElements.map((el) => {
        if (el.customData?.documentId === docId || el.id === `doc_elem_${docId}`) {
          return { ...el, isDeleted: true };
        }
        return el;
      });
      api.updateScene({
        elements: updatedElements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    }

    setActiveDocIds((prev) => {
      const next = new Set(prev);
      next.delete(docId);
      return next;
    });

    const doc = documents.find((d) => d.id === docId);
    if (doc) {
      await window.electron.deleteFile(doc.id).catch(() => {});
      removeDocument(doc.id);
      toast.success(`"${doc.filename}" removed from session`);
    }
  }, [documents, excalidrawAPI, removeDocument]);

  // Clear Canvas - reliably clears all active drawings, documents, and persistence
  const handleClearCanvas = useCallback(async () => {
    const api = excalidrawAPI || excalidrawAPIRef.current;
    if (!api) return;

    const sceneElements = api.getSceneElements();
    const latestElements = latestElementsRef.current.length > 0 ? latestElementsRef.current : sceneElements;
    const activeElements = (latestElements.length > 0 ? latestElements : sceneElements).filter(
      (el) => !el.isDeleted
    );

    if (activeElements.length === 0) {
      toast('Canvas is already clear');
      return;
    }

    const confirmed = await useAppStore.getState().showConfirm(
      'Are you sure you want to clear the entire sketch canvas? Any unsaved drawings will be removed.',
      'Clear Canvas',
      'Clear All',
      'Cancel'
    );
    if (!confirmed) return;

    // Properly mark all elements as deleted so Excalidraw's store, history, and canvas clear completely
    const allKnown = sceneElements.length >= latestElements.length ? sceneElements : latestElements;
    const deletedElements = allKnown.map((el) => ({ ...el, isDeleted: true }));

    api.updateScene({
      elements: deletedElements,
      appState: {
        selectedElementIds: {},
        selectedGroupIds: {},
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    api.history?.clear?.();
    latestElementsRef.current = [];
    localStorage.removeItem(STORAGE_KEY);
    setActiveDocIds(new Set());
    lastActiveKeyRef.current = '';
    toast.success('Canvas cleared');
  }, [excalidrawAPI]);

  // Export current canvas as PNG
  const handleExportPng = useCallback(async () => {
    const api = excalidrawAPI || excalidrawAPIRef.current;
    if (!api) return;
    const elements = api.getSceneElements().filter((el) => !el.isDeleted);
    if (elements.length === 0) {
      toast.error('Canvas is blank. Draw or add a document first.');
      return;
    }

    try {
      const blob = await exportToBlob({
        elements,
        appState: api.getAppState(),
        files: api.getFiles(),
        mimeType: 'image/png',
        quality: 1,
      });

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const defaultName = `sketch_${Date.now()}.png`;

        if (window.electron?.saveFileFromBase64) {
          const res = await window.electron.saveFileFromBase64(
            base64,
            defaultName,
            [{ name: 'PNG Image', extensions: ['png'] }]
          );
          if (res.success) {
            toast.success(`Exported: ${res.data.split(/[\\/]/).pop()}`);
          }
        } else {
          const a = document.createElement('a');
          a.href = base64;
          a.download = defaultName;
          a.click();
          toast.success('Exported sketch image');
        }
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('Failed to export image:', err);
      toast.error('Failed to export sketch image');
    }
  }, [excalidrawAPI]);

  return (
    <SketchErrorBoundary>
      <div className="sketch-editor-container animate-fade-in">
        {/* Sleek Top Header Bar */}
        <div className="sketch-header-bar flex items-center justify-between px-5 py-2.5 bg-bg-surface border-b border-border shadow-xs shrink-0 select-none">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const hasDocs = useAppStore.getState().documents.length > 0;
                setView(hasDocs ? AppView.DOCUMENT_LIST : AppView.HOME);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-border bg-bg-base hover:bg-bg-sunken text-text-secondary hover:text-text-primary transition-fast"
              title="Exit Sketch Editor"
            >
              <ArrowLeft size={14} /> Exit Editor
            </button>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Paintbrush size={16} className="text-accent" />
              <h1 className="text-sm font-bold text-text-primary">Sketch Canvas</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearCanvas}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-border hover:bg-bg-sunken text-text-secondary hover:text-text-primary transition-fast"
              title="Clear entire canvas"
            >
              <Trash2 size={13} /> Clear
            </button>
            <button
              onClick={handleExportPng}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md bg-accent hover:bg-accent-hover text-white transition-fast shadow-xs"
              title="Export sketch as PNG image"
            >
              <Download size={13} /> Export Image
            </button>
          </div>
        </div>

        {/* Main Excalidraw Canvas Area */}
        <div ref={canvasWrapRef} className="sketch-canvas-wrap" data-active-tool={activeTool}>
          <Excalidraw
            initialData={initialData}
            excalidrawAPI={handleExcalidrawAPI}
            onChange={handleChange}
            theme="light"
            detectScroll={false}
            autoFocus={true}
            UIOptions={UI_OPTIONS}
          />

          {/* Hidden File Input linked directly with the Excalidraw Image Tool Button */}
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*,.pdf"
            multiple
            style={{ display: 'none' }}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              if (files.length === 0) return;
              for (const file of files) {
                await handleUploadFile(file);
              }
              e.target.value = '';
            }}
          />

          {/* Portal Document Tray directly inside Excalidraw's floating toolbar next to image tool */}
          {isTrayMounted &&
            trayElRef.current &&
            createPortal(
              <ToolbarDocumentTray
                documents={documents}
                activeDocIds={activeDocIds}
                onToggleDocument={handleToggleDocument}
                onRemoveDocument={handleRemoveDocumentFromSession}
              />,
              trayElRef.current
            )}
        </div>
      </div>
    </SketchErrorBoundary>
  );
}
