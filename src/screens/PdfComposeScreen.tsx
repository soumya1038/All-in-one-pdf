import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Upload,
  Plus,
  RotateCw,
  Trash2,
  Sliders,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  FileText,
  ChevronDown,
  FileImage,
  FolderOpen
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { OutputFormat } from '../types/Output.types';
import Button from '../components/ui/Button';
import DragDropZone from '../components/ui/DragDropZone';
import { PDFDocument } from 'pdf-lib';
import { DocumentItem } from '../types/Document.types';

interface PlacedItem {
  id: string;
  imgSrc: string; // base64 crop
  originalW: number;
  originalH: number;
  x: number; // relative to visual A4 canvas width (440px)
  y: number; // relative to visual A4 canvas height (622px)
  w: number;
  h: number;
  rotation: number; // 0, 90, 180, 270
  filter: 'none' | 'grayscale' | 'binarize' | 'invert';
  binarizeThreshold: number; // 0-255
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  outputPage: number; // 1-indexed output page number
}

interface CropBox {
  x: number; // percentage (0-100)
  y: number; // percentage (0-100)
  w: number; // percentage (0-100)
  h: number; // percentage (0-100)
}

export default function PdfComposeScreen() {
  const setView = useAppStore((state) => state.setView);
  const addDocuments = useAppStore((state) => state.addDocuments);
  const removeDocument = useAppStore((state) => state.removeDocument);
  const globalDocs = useAppStore((state) => state.documents);

  const [isUploading, setIsUploading] = useState(false);
  const [loadedDocs, setLoadedDocs] = useState<DocumentItem[]>(globalDocs);
  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    globalDocs.forEach(d => {
      initial[d.id] = true;
    });
    return initial;
  });
  
  // Cropper source state
  const [activeDocId, setActiveDocId] = useState<string | null>(
    globalDocs.length > 0 ? globalDocs[0].id : null
  );
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageThumbnails, setPageThumbnails] = useState<Record<string, string>>({}); // Key format: docId_pageNum
  const [highResPagePath, setHighResPagePath] = useState<string | null>(null);
  const [loadingPage, setLoadingPage] = useState<boolean>(false);

  // Cropper cropbox state
  const [cropBox, setCropBox] = useState<CropBox>({ x: 10, y: 10, w: 80, h: 40 });
  const cropperContainerRef = useRef<HTMLDivElement>(null);
  const [isDraggingCrop, setIsDraggingCrop] = useState<boolean>(false);
  const [dragType, setDragType] = useState<string | null>(null); // 'move', 'tl', 'tr', 'bl', 'br'
  const [dragStart, setDragStart] = useState<{ x: number; y: number; box: CropBox } | null>(null);

  // Placed Items and Multi-Page workspace state
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);

  const handleCancel = async () => {
    if (loadedDocs.length > 0 || placedItems.length > 0) {
      const confirmed = await useAppStore.getState().showConfirm(
        'Are you sure you want to exit PDF Compose? Any unsaved edits will be lost.',
        'Exit PDF Compose'
      );
      if (!confirmed) return;
    }
    setView(AppView.HOME);
  };
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isDraggingPlaced, setIsDraggingPlaced] = useState<boolean>(false);
  const [placedDragType, setPlacedDragType] = useState<'move' | 'resize' | null>(null);
  const [placedDragStart, setPlacedDragStart] = useState<{ x: number; y: number; itemX: number; itemY: number; itemW: number; itemH: number } | null>(null);
  
  // Output page navigation
  const [outputPagesCount, setOutputPagesCount] = useState<number>(1);
  const [currentOutputPage, setCurrentOutputPage] = useState<number>(1);

  const [exporting, setExporting] = useState<boolean>(false);
  const [filename, setFilename] = useState<string>('Composed_Document');

  // Visual A4 sizes in CSS px (Increased for better view)
  const A4_WIDTH = 440;
  const A4_HEIGHT = 622;
  const A4_DPI_SCALE = 2480 / A4_WIDTH; // Scaling to 300 DPI high-res canvas (2480x3508)

  const activeDoc = loadedDocs.find(d => d.id === activeDocId);
  const selectedItem = placedItems.find((item) => item.id === selectedItemId);

  // Upload/Browse files (Accepting multiple PDFs and Images)
  const handleUploadFilePaths = async (paths: string[]) => {
    setIsUploading(true);
    try {
      const docResult = await window.electron.uploadFiles(paths);
      if (docResult.success && docResult.data.length > 0) {
        addDocuments(docResult.data);
        setLoadedDocs(prev => {
          const existingIds = new Set(prev.map(d => d.id));
          const newDocs = docResult.data.filter(d => !existingIds.has(d.id));
          const updated = [...prev, ...newDocs];
          
          if (!activeDocId && updated.length > 0) {
            setActiveDocId(updated[0].id);
            setCurrentPage(1);
          }
          return updated;
        });

        // Expand expanded state for newly loaded docs
        setExpandedDocs(prev => {
          const next = { ...prev };
          docResult.data.forEach(d => {
            next[d.id] = true;
          });
          return next;
        });

        toast.success(`Loaded ${docResult.data.length} file(s)`);
      } else {
        toast.error('Failed to load files');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to load files');
    } finally {
      setIsUploading(false);
    }
  };

  const handleBrowseFiles = async () => {
    setIsUploading(true);
    try {
      const result = await window.electron.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF and Images', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'] }]
      });

      if (result.success && result.data && result.data.length > 0) {
        await handleUploadFilePaths(result.data);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to select files');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFilesDropped = (files: File[]) => {
    const paths = files.map((file) => (file as File & { path?: string }).path).filter(Boolean) as string[];
    if (paths.length > 0) {
      handleUploadFilePaths(paths);
    } else {
      toast.error('No valid files dropped');
    }
  };

  // Remove document from library list
  const handleRemoveDoc = (id: string) => {
    setLoadedDocs(prev => prev.filter(d => d.id !== id));
    removeDocument(id);
    window.electron.deleteFile(id).catch(() => {});
    if (activeDocId === id) {
      const remaining = loadedDocs.filter(d => d.id !== id);
      if (remaining.length > 0) {
        setActiveDocId(remaining[0].id);
        setCurrentPage(1);
      } else {
        setActiveDocId(null);
        setHighResPagePath(null);
      }
    }
    toast.success('Document removed from library');
  };

  const toggleDocExpanded = (id: string) => {
    setExpandedDocs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Load high-resolution page preview for cropper
  useEffect(() => {
    if (!activeDocId) {
      setHighResPagePath(null);
      return;
    }
    const doc = loadedDocs.find(d => d.id === activeDocId);
    if (!doc) return;

    const loadPageResources = async () => {
      setLoadingPage(true);
      try {
        if (doc.type === 'PDF') {
          // Render page to image
          const highResResult = await window.electron.renderPdfPage(doc.id, currentPage);
          if (highResResult.success) {
            setHighResPagePath(highResResult.data);
          } else {
            toast.error('Failed to render page');
          }

          // Load page thumbnail
          const thumbKey = `${doc.id}_${currentPage}`;
          if (!pageThumbnails[thumbKey]) {
            const thumbResult = await window.electron.renderPdfPageThumbnail(doc.id, currentPage);
            if (thumbResult.success) {
              setPageThumbnails(prev => ({ ...prev, [thumbKey]: thumbResult.data }));
            }
          }
        } else {
          // Image file: high-res path is the temp file itself!
          setHighResPagePath(doc.tempPath);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingPage(false);
      }
    };

    loadPageResources();
  }, [activeDocId, currentPage, loadedDocs]);

  // Load PDF page thumbnails in the background sequentially
  const loadAllThumbnails = async () => {
    for (const doc of loadedDocs) {
      if (doc.type === 'PDF') {
        for (let p = 1; p <= doc.pageCount; p++) {
          const thumbKey = `${doc.id}_${p}`;
          if (!pageThumbnails[thumbKey]) {
            try {
              const thumbResult = await window.electron.renderPdfPageThumbnail(doc.id, p);
              if (thumbResult.success) {
                setPageThumbnails(prev => ({ ...prev, [thumbKey]: thumbResult.data }));
              }
            } catch (e) {
              console.error(e);
            }
          }
        }
      }
    }
  };

  useEffect(() => {
    if (loadedDocs.length > 0) {
      loadAllThumbnails();
    }
  }, [loadedDocs]);

  // Drag crop bounding box in center cropper panel
  const handleCropMouseDown = (e: React.MouseEvent, type: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (!cropperContainerRef.current) return;
    setIsDraggingCrop(true);
    setDragType(type);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      box: { ...cropBox }
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingCrop || !dragStart || !cropperContainerRef.current) return;
      
      const containerRect = cropperContainerRef.current.getBoundingClientRect();
      const deltaX = ((e.clientX - dragStart.x) / containerRect.width) * 100;
      const deltaY = ((e.clientY - dragStart.y) / containerRect.height) * 100;

      const newBox = { ...dragStart.box };

      if (dragType === 'move') {
        newBox.x = Math.max(0, Math.min(100 - newBox.w, dragStart.box.x + deltaX));
        newBox.y = Math.max(0, Math.min(100 - newBox.h, dragStart.box.y + deltaY));
      } else if (dragType === 'tl') {
        const right = dragStart.box.x + dragStart.box.w;
        const bottom = dragStart.box.y + dragStart.box.h;
        newBox.x = Math.max(0, Math.min(right - 5, dragStart.box.x + deltaX));
        newBox.y = Math.max(0, Math.min(bottom - 5, dragStart.box.y + deltaY));
        newBox.w = right - newBox.x;
        newBox.h = bottom - newBox.y;
      } else if (dragType === 'tr') {
        const left = dragStart.box.x;
        const bottom = dragStart.box.y + dragStart.box.h;
        newBox.w = Math.max(5, Math.min(100 - left, dragStart.box.w + deltaX));
        newBox.y = Math.max(0, Math.min(bottom - 5, dragStart.box.y + deltaY));
        newBox.h = bottom - newBox.y;
      } else if (dragType === 'bl') {
        const right = dragStart.box.x + dragStart.box.w;
        const top = dragStart.box.y;
        newBox.x = Math.max(0, Math.min(right - 5, dragStart.box.x + deltaX));
        newBox.w = right - newBox.x;
        newBox.h = Math.max(5, Math.min(100 - top, dragStart.box.h + deltaY));
      } else if (dragType === 'br') {
        const left = dragStart.box.x;
        const top = dragStart.box.y;
        newBox.w = Math.max(5, Math.min(100 - left, dragStart.box.w + deltaX));
        newBox.h = Math.max(5, Math.min(100 - top, dragStart.box.h + deltaY));
      }

      setCropBox(newBox);
    };

    const handleMouseUp = () => {
      setIsDraggingCrop(false);
      setDragType(null);
      setDragStart(null);
    };

    if (isDraggingCrop) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingCrop, dragStart, dragType]);

  // Crop selection and add to active page
  const handleAddCropToSheet = () => {
    if (!highResPagePath) return;

    const img = new Image();
    img.src = `docuflow:///${highResPagePath.replace(/\\/g, '/')}`;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cropPxX = (cropBox.x / 100) * img.width;
      const cropPxY = (cropBox.y / 100) * img.height;
      const cropPxW = (cropBox.w / 100) * img.width;
      const cropPxH = (cropBox.h / 100) * img.height;

      canvas.width = cropPxW;
      canvas.height = cropPxH;

      ctx.drawImage(img, cropPxX, cropPxY, cropPxW, cropPxH, 0, 0, cropPxW, cropPxH);

      const base64Crop = canvas.toDataURL('image/png');

      const aspect = cropPxW / cropPxH;
      const defaultW = Math.min(220, cropPxW / 2);
      const defaultH = defaultW / aspect;

      const newItem: PlacedItem = {
        id: `item_${Date.now()}`,
        imgSrc: base64Crop,
        originalW: cropPxW,
        originalH: cropPxH,
        x: (A4_WIDTH - defaultW) / 2,
        y: (A4_HEIGHT - defaultH) / 2,
        w: defaultW,
        h: defaultH,
        rotation: 0,
        filter: 'none',
        binarizeThreshold: 128,
        brightness: 0,
        contrast: 0,
        outputPage: currentOutputPage // Set to currently open page
      };

      setPlacedItems(prev => [...prev, newItem]);
      setSelectedItemId(newItem.id);
      toast.success(`Crop added to Page ${currentOutputPage}`);
    };
    img.onerror = () => {
      toast.error('Failed to load page image for cropping');
    };
  };

  // Drag and resize placed elements
  const handlePlacedItemMouseDown = (e: React.MouseEvent, item: PlacedItem, type: 'move' | 'resize') => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedItemId(item.id);
    setIsDraggingPlaced(true);
    setPlacedDragType(type);
    setPlacedDragStart({
      x: e.clientX,
      y: e.clientY,
      itemX: item.x,
      itemY: item.y,
      itemW: item.w,
      itemH: item.h
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingPlaced || !placedDragStart || !selectedItemId) return;

      const deltaX = e.clientX - placedDragStart.x;
      const deltaY = e.clientY - placedDragStart.y;

      setPlacedItems(prev =>
        prev.map(item => {
          if (item.id !== selectedItemId) return item;

          if (placedDragType === 'move') {
            const newX = Math.max(-item.w / 2, Math.min(A4_WIDTH - item.w / 2, placedDragStart.itemX + deltaX));
            const newY = Math.max(-item.h / 2, Math.min(A4_HEIGHT - item.h / 2, placedDragStart.itemY + deltaY));
            return { ...item, x: newX, y: newY };
          } else if (placedDragType === 'resize') {
            const aspect = placedDragStart.itemW / placedDragStart.itemH;
            const newW = Math.max(30, placedDragStart.itemW + deltaX);
            const newH = newW / aspect;
            return { ...item, w: newW, h: newH };
          }
          return item;
        })
      );
    };

    const handleMouseUp = () => {
      setIsDraggingPlaced(false);
      setPlacedDragType(null);
      setPlacedDragStart(null);
    };

    if (isDraggingPlaced) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingPlaced, placedDragStart, placedDragType, selectedItemId]);

  const handleRotateItem = () => {
    if (!selectedItemId) return;
    setPlacedItems(prev =>
      prev.map(item => {
        if (item.id !== selectedItemId) return item;
        const nextRotation = (item.rotation + 90) % 360;
        return { ...item, rotation: nextRotation };
      })
    );
  };

  const handleFilterChange = (filter: 'none' | 'grayscale' | 'binarize' | 'invert') => {
    if (!selectedItemId) return;
    setPlacedItems(prev =>
      prev.map(item => (item.id === selectedItemId ? { ...item, filter } : item))
    );
  };

  const handleSliderChange = (key: 'brightness' | 'contrast' | 'binarizeThreshold', val: number) => {
    if (!selectedItemId) return;
    setPlacedItems(prev =>
      prev.map(item => (item.id === selectedItemId ? { ...item, [key]: val } : item))
    );
  };

  const handleRemoveItem = () => {
    if (!selectedItemId) return;
    setPlacedItems(prev => prev.filter(item => item.id !== selectedItemId));
    setSelectedItemId(null);
    toast.success('Item removed');
  };

  // Multi-Page visual sheets modifiers
  const handleAddPage = () => {
    const nextCount = outputPagesCount + 1;
    setOutputPagesCount(nextCount);
    setCurrentOutputPage(nextCount);
    setSelectedItemId(null);
    toast.success(`Page ${nextCount} added`);
  };

  const handleDeletePage = async () => {
    if (outputPagesCount <= 1) return;

    const confirm = await window.electron.showConfirmDialog(
      `Are you sure you want to delete Page ${currentOutputPage}? All layout items placed on this page will be removed permanently.`,
      'Delete Output Page'
    );

    if (!confirm) return;

    // Filter items on deleted page, and shift page counts down for pages above
    setPlacedItems(prev =>
      prev
        .filter(item => item.outputPage !== currentOutputPage)
        .map(item => {
          if (item.outputPage > currentOutputPage) {
            return { ...item, outputPage: item.outputPage - 1 };
          }
          return item;
        })
    );

    setSelectedItemId(null);
    const newCount = outputPagesCount - 1;
    setOutputPagesCount(newCount);
    
    // Switch to page below
    setCurrentOutputPage(prev => Math.max(1, Math.min(newCount, prev - 1)));
    toast.success('Page deleted');
  };

  // Filter computation helper
  const applyImageFilters = (imgUrl: string, item: PlacedItem): Promise<HTMLCanvasElement> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = imgUrl;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(canvas);
          return;
        }

        ctx.drawImage(img, 0, 0);

        if (item.filter === 'none' && item.brightness === 0 && item.contrast === 0) {
          resolve(canvas);
          return;
        }

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        const cVal = item.contrast; 
        const factor = (259 * (cVal + 255)) / (255 * (259 - cVal));

        for (let i = 0; i < data.length; i += 4) {
          let r = data[i];
          let g = data[i + 1];
          let b = data[i + 2];

          if (item.brightness !== 0) {
            r += item.brightness;
            g += item.brightness;
            b += item.brightness;
          }

          if (cVal !== 0) {
            r = factor * (r - 128) + 128;
            g = factor * (g - 128) + 128;
            b = factor * (b - 128) + 128;
          }

          if (item.filter === 'grayscale') {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = g = b = gray;
          } else if (item.filter === 'binarize') {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            const thresholdVal = item.binarizeThreshold;
            const binarized = gray >= thresholdVal ? 255 : 0;
            r = g = b = binarized;
          } else if (item.filter === 'invert') {
            r = 255 - r;
            g = 255 - g;
            b = 255 - b;
          }

          data[i] = Math.max(0, Math.min(255, r));
          data[i + 1] = Math.max(0, Math.min(255, g));
          data[i + 2] = Math.max(0, Math.min(255, b));
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas);
      };
      img.onerror = () => {
        resolve(document.createElement('canvas'));
      };
    });
  };

  // Compile multi-page PDF document
  const handleExportPDF = async () => {
    if (placedItems.length === 0) {
      toast.error('Add at least one cropped item to the page first');
      return;
    }

    setExporting(true);
    try {
      const pdfDocument = await PDFDocument.create();

      // Compile each page index in sequence
      for (let p = 1; p <= outputPagesCount; p++) {
        const pageItems = placedItems.filter(item => item.outputPage === p);

        // High-res rendering canvas
        const outCanvas = document.createElement('canvas');
        outCanvas.width = 2480;
        outCanvas.height = 3508;
        const ctx = outCanvas.getContext('2d');
        if (!ctx) throw new Error('Could not get output canvas 2D context');

        // Draw white background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);

        for (const item of pageItems) {
          const filteredCanvas = await applyImageFilters(item.imgSrc, item);

          const highResX = item.x * A4_DPI_SCALE;
          const highResY = item.y * A4_DPI_SCALE;
          const highResW = item.w * A4_DPI_SCALE;
          const highResH = item.h * A4_DPI_SCALE;

          ctx.save();
          ctx.translate(highResX + highResW / 2, highResY + highResH / 2);
          ctx.rotate((item.rotation * Math.PI) / 180);
          ctx.drawImage(filteredCanvas, -highResW / 2, -highResH / 2, highResW, highResH);
          ctx.restore();
        }

        const pngBase64 = outCanvas.toDataURL('image/png');
        const rawBase64 = pngBase64.split(',')[1];
        const imageBytes = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));

        // Add A4 points page
        const page = pdfDocument.addPage([595.28, 841.89]);
        const embeddedImage = await pdfDocument.embedPng(imageBytes);

        page.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: 595.28,
          height: 841.89,
        });
      }

      const pdfBytes = await pdfDocument.save();
      const base64Pdf = btoa(
        new Uint8Array(pdfBytes).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const cleanFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
      const result = await window.electron.saveFileFromBase64(
        `data:application/pdf;base64,${base64Pdf}`,
        cleanFilename,
        [{ name: 'PDF Documents', extensions: ['pdf'] }]
      );

      if (result.success) {
        toast.success(`Multi-page PDF saved: ${result.data.split(/[\\/]/).pop()}`);
        const statsResult = await window.electron.validateFile(result.data);
        const savedSize = statsResult.success ? statsResult.data.size : 0;

        useAppStore.getState().updateOutputOptions({
          filename: cleanFilename.split('.')[0],
          format: OutputFormat.PDF
        });
        useAppStore.getState().setProcessingStatus({
          outputPath: result.data,
          outputSize: savedSize,
          status: 'completed',
          progress: 100
        });
        setView(AppView.SUCCESS);
      } else if (result.error && result.error.message !== 'Save cancelled by user') {
        toast.error(result.error.message);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  const handleClear = () => {
    setPlacedItems([]);
    setSelectedItemId(null);
    setOutputPagesCount(1);
    setCurrentOutputPage(1);
    toast.success('Workspace layout reset');
  };

  // Filter items visible on the currently selected output page
  const visibleItems = placedItems.filter((item) => item.outputPage === currentOutputPage);

  return (
    <div className="h-full flex flex-col bg-bg-base select-none">
      {/* Top Header */}
      <div className="bg-bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handleCancel}
            className="p-1.5 hover:bg-bg-sunken rounded text-text-secondary hover:text-text-primary transition-fast"
            title="Go Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-base font-bold text-text-primary">PDF Compose & Combine</h1>
            <p className="text-xs text-text-secondary">Crop snippets from multiple PDFs and Images onto custom layouts</p>
          </div>
        </div>

        {loadedDocs.length > 0 && (
          <div className="flex items-center gap-3 animate-fade-in">
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Filename"
              className="px-3 py-1.5 border border-border rounded-md text-sm bg-bg-surface focus:outline-none focus:border-accent w-48 text-text-primary"
            />
            <Button variant="secondary" size="md" onClick={handleClear}>
              <Trash2 size={16} className="mr-1.5" /> Clear All
            </Button>
            <Button variant="primary" size="md" onClick={handleExportPDF} disabled={exporting}>
              {exporting ? <Loader2 size={16} className="animate-spin mr-1.5" /> : <Check size={16} className="mr-1.5" />}
              Save PDF
            </Button>
            <Button variant="secondary" size="md" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Main workspace layout */}
      {loadedDocs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="bg-bg-surface p-10 rounded-xl border border-border shadow-md max-w-xl w-full text-center flex flex-col items-center animate-scale-in">
            <div className="w-16 h-16 bg-accent/5 rounded-full flex items-center justify-center text-accent mb-6">
              <FolderOpen size={32} />
            </div>
            <h2 className="text-lg font-bold text-text-primary mb-2">Upload Files to Compose</h2>
            <p className="text-sm text-text-secondary mb-8 max-w-md">
              Select or drop multiple PDFs and Image files. You can crop elements from different pages and lay them out on a single or multiple pages!
            </p>
            
            {/* Custom drag-drop panel */}
            <div className="w-full mb-6">
              <DragDropZone
                onFilesDropped={handleFilesDropped}
                accept={['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif']}
                disabled={isUploading}
                multiple={true}
              />
            </div>
            
            <div className="flex gap-3">
              <Button variant="primary" size="lg" onClick={handleBrowseFiles} disabled={isUploading}>
                {isUploading ? <Loader2 size={20} className="animate-spin mr-2" /> : <Upload size={20} className="mr-2" />}
                Browse PDF & Images
              </Button>
              <Button variant="secondary" size="lg" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden animate-fade-in">
          {/* Col 1: Expandable Document Accordion (Left sidebar) */}
          <div className="w-64 border-r border-border bg-bg-surface flex flex-col overflow-y-auto scrollbar-thin">
            <div className="p-3 border-b border-border flex items-center justify-between bg-bg-sunken/40">
              <span className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">Document Library</span>
              <button
                onClick={handleBrowseFiles}
                className="text-[10px] text-accent hover:underline flex items-center gap-1 font-semibold"
                title="Add more files to layout list"
              >
                <Plus size={10} /> Add Files
              </button>
            </div>
            
            <div className="flex flex-col p-2 gap-2">
              {loadedDocs.map((doc) => {
                const isExpanded = !!expandedDocs[doc.id];
                const isActive = activeDocId === doc.id;
                
                return (
                  <div key={doc.id} className="border border-border/70 rounded-md overflow-hidden bg-bg-base/30">
                    {/* Header accordion bar */}
                    <div
                      className={`flex items-center justify-between p-2 cursor-pointer transition-fast ${
                        isActive ? 'bg-accent/5' : 'hover:bg-bg-sunken/50'
                      }`}
                      onClick={() => toggleDocExpanded(doc.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <ChevronDown
                          size={14}
                          className={`text-text-secondary transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                        />
                        {doc.type === 'PDF' ? (
                          <FileText size={14} className="text-red-500 shrink-0" />
                        ) : (
                          <FileImage size={14} className="text-blue-500 shrink-0" />
                        )}
                        <span
                          className={`text-xs truncate font-medium ${isActive ? 'text-accent font-semibold' : 'text-text-primary'}`}
                          title={doc.filename}
                        >
                          {doc.filename}
                        </span>
                      </div>
                      
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveDoc(doc.id);
                        }}
                        className="p-1 hover:bg-error-light hover:text-error rounded text-text-muted transition-fast shrink-0"
                        title="Remove file"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* Accordion pages panel */}
                    {isExpanded && (
                      <div className="p-2 border-t border-border bg-bg-surface flex flex-wrap gap-2 justify-center max-h-48 overflow-y-auto scrollbar-thin">
                        {doc.type === 'PDF' ? (
                          Array.from({ length: doc.pageCount }, (_, i) => i + 1).map((page) => {
                            const isPageActive = isActive && currentPage === page;
                            const thumbKey = `${doc.id}_${page}`;
                            
                            return (
                              <button
                                key={page}
                                onClick={() => {
                                  setActiveDocId(doc.id);
                                  setCurrentPage(page);
                                }}
                                className={`w-12 flex flex-col items-center p-0.5 rounded border transition-fast ${
                                  isPageActive ? 'border-accent bg-accent/5' : 'border-border hover:border-text-secondary'
                                }`}
                              >
                                <div className="w-full aspect-[3/4] bg-bg-sunken rounded border border-border/40 overflow-hidden relative flex items-center justify-center mb-0.5">
                                  {pageThumbnails[thumbKey] ? (
                                    <img
                                      src={`docuflow:///${pageThumbnails[thumbKey].replace(/\\/g, '/')}?t=${doc.id}`}
                                      alt={`Page ${page}`}
                                      className="w-full h-full object-contain bg-white pointer-events-none"
                                    />
                                  ) : (
                                    <div className="text-[8px] text-text-muted">{page}</div>
                                  )}
                                </div>
                                <span className="text-[8px] text-text-secondary">P. {page}</span>
                              </button>
                            );
                          })
                        ) : (
                          // Image Document thumbnail
                          <button
                            onClick={() => {
                              setActiveDocId(doc.id);
                              setCurrentPage(1);
                            }}
                            className={`w-14 flex flex-col items-center p-0.5 rounded border transition-fast ${
                              isActive ? 'border-accent bg-accent/5' : 'border-border hover:border-text-secondary'
                            }`}
                          >
                            <div className="w-full aspect-[3/4] bg-bg-sunken rounded border border-border/40 overflow-hidden relative flex items-center justify-center mb-0.5">
                              <img
                                src={doc.thumbnailPath ? `docuflow:///${doc.thumbnailPath.replace(/\\/g, '/')}?t=${doc.id}` : ''}
                                alt="Image source"
                                className="w-full h-full object-cover bg-white pointer-events-none"
                              />
                            </div>
                            <span className="text-[8px] text-text-secondary">Image</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Col 2: Cropper Panel (Center) */}
          <div className="flex-1 flex flex-col p-6 overflow-hidden bg-bg-base items-center justify-center relative">
            {activeDoc ? (
              <>
                <div className="text-center mb-3">
                  <span className="text-xs font-semibold text-text-secondary block">
                    {activeDoc.filename} 
                    {activeDoc.type === 'PDF' && ` — Page ${currentPage} of ${activeDoc.pageCount}`}
                  </span>
                  <h2 className="text-sm font-semibold text-text-primary mt-0.5">Crop Selection Frame</h2>
                </div>

                {/* Cropping Frame */}
                <div className="flex-1 w-full max-w-xl aspect-[3/4] bg-bg-surface rounded-lg border border-border shadow-sm flex items-center justify-center relative p-3 overflow-hidden">
                  {loadingPage ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="animate-spin text-accent" size={24} />
                      <span className="text-xs text-text-secondary">Loading document page...</span>
                    </div>
                  ) : highResPagePath ? (
                    <div
                      ref={cropperContainerRef}
                      className="relative max-h-full max-w-full overflow-hidden select-none shadow-md"
                      style={{ display: 'inline-block' }}
                    >
                      <img
                        src={`docuflow:///${highResPagePath.replace(/\\/g, '/')}?t=${currentPage}`}
                        alt="Crop zone"
                        className="max-h-[50vh] max-w-full object-contain pointer-events-none"
                        onLoad={() => {
                          setCropBox({ x: 20, y: 20, w: 60, h: 40 });
                        }}
                      />
                      
                      {/* Draggable Bounding Crop Box */}
                      <div
                        className="absolute border-2 border-dashed border-accent bg-accent/10 cursor-move"
                        style={{
                          left: `${cropBox.x}%`,
                          top: `${cropBox.y}%`,
                          width: `${cropBox.w}%`,
                          height: `${cropBox.h}%`
                        }}
                        onMouseDown={(e) => handleCropMouseDown(e, 'move')}
                      >
                        {/* Guides */}
                        <div className="absolute top-1/3 left-0 right-0 border-t border-accent/20 pointer-events-none" />
                        <div className="absolute top-2/3 left-0 right-0 border-t border-accent/20 pointer-events-none" />
                        <div className="absolute left-1/3 top-0 bottom-0 border-l border-accent/20 pointer-events-none" />
                        <div className="absolute left-2/3 top-0 bottom-0 border-l border-accent/20 pointer-events-none" />

                        {/* Handles */}
                        <div className="absolute w-3 h-3 bg-accent border border-white -top-1.5 -left-1.5 rounded-full cursor-nwse-resize shadow" onMouseDown={(e) => handleCropMouseDown(e, 'tl')} />
                        <div className="absolute w-3 h-3 bg-accent border border-white -top-1.5 -right-1.5 rounded-full cursor-nesw-resize shadow" onMouseDown={(e) => handleCropMouseDown(e, 'tr')} />
                        <div className="absolute w-3 h-3 bg-accent border border-white -bottom-1.5 -left-1.5 rounded-full cursor-nesw-resize shadow" onMouseDown={(e) => handleCropMouseDown(e, 'bl')} />
                        <div className="absolute w-3 h-3 bg-accent border border-white -bottom-1.5 -right-1.5 rounded-full cursor-nwse-resize shadow" onMouseDown={(e) => handleCropMouseDown(e, 'br')} />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-text-muted">Failed to resolve page content</span>
                  )}
                </div>

                <div className="mt-4 flex items-center gap-3">
                  {activeDoc.type === 'PDF' && (
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className="p-2 border border-border hover:bg-bg-sunken bg-bg-surface rounded-md disabled:opacity-40"
                    >
                      <ChevronLeft size={16} />
                    </button>
                  )}
                  
                  <Button variant="primary" size="md" onClick={handleAddCropToSheet} disabled={!highResPagePath}>
                    <Plus size={16} className="mr-1.5" /> Add Crop to Page {currentOutputPage}
                  </Button>

                  {activeDoc.type === 'PDF' && (
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(activeDoc.pageCount, prev + 1))}
                      disabled={currentPage === activeDoc.pageCount}
                      className="p-2 border border-border hover:bg-bg-sunken bg-bg-surface rounded-md disabled:opacity-40"
                    >
                      <ChevronRight size={16} />
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="text-xs text-text-muted">Select a page or image from the sidebar library to crop</div>
            )}
          </div>

          {/* Col 3: Visual Page Composer (Right workspace panel) - Increased panel width */}
          <div className="w-[560px] border-l border-border bg-bg-surface flex flex-col p-5 overflow-y-auto scrollbar-thin">
            <h2 className="text-sm font-bold text-text-primary mb-3 text-center">Visual Composer Page</h2>

            {/* Visual sheet canvas representation - Increased sheet sizes */}
            <div className="flex justify-center mb-4">
              <div
                className="relative bg-white shadow-md border border-border overflow-hidden select-none"
                style={{ width: `${A4_WIDTH}px`, height: `${A4_HEIGHT}px` }}
                onClick={() => setSelectedItemId(null)}
              >
                {visibleItems.length === 0 && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center border-2 border-dashed border-border/80 m-4 rounded-lg bg-bg-base/30">
                    <span className="text-xs text-text-muted font-bold">Output Page {currentOutputPage}</span>
                    <span className="text-[11px] text-text-muted mt-2 max-w-[220px]">
                      No items placed on this page. Choose a snippet in the center cropper and click &quot;Add Crop to Page {currentOutputPage}&quot; to drop it here.
                    </span>
                  </div>
                )}

                {/* Placed Cropped Items */}
                {visibleItems.map((item) => {
                  const isSelected = item.id === selectedItemId;

                  // CSS filter string preview
                  let filterStyle = '';
                  if (item.filter === 'grayscale') filterStyle = 'grayscale(100%)';
                  else if (item.filter === 'invert') filterStyle = 'invert(100%)';
                  else if (item.filter === 'binarize') {
                    filterStyle = 'contrast(300%) grayscale(100%)';
                  }

                  if (item.brightness !== 0) {
                    filterStyle += ` brightness(${100 + item.brightness}%)`;
                  }
                  if (item.contrast !== 0) {
                    filterStyle += ` contrast(${100 + item.contrast}%)`;
                  }

                  return (
                    <div
                      key={item.id}
                      className={`absolute group select-none ${
                        isSelected ? 'ring-2 ring-accent z-20' : 'hover:ring-1 hover:ring-accent/50 z-10'
                      }`}
                      style={{
                        left: `${item.x}px`,
                        top: `${item.y}px`,
                        width: `${item.w}px`,
                        height: `${item.h}px`,
                        transform: `rotate(${item.rotation}deg)`,
                      }}
                      onMouseDown={(e) => handlePlacedItemMouseDown(e, item, 'move')}
                      onClick={(e) => {
                        // CRITICAL: Stop propagation so that the parent div onClick does NOT clear the selection
                        e.stopPropagation();
                      }}
                    >
                      <img
                        src={item.imgSrc}
                        alt="Crop snippet"
                        className="w-full h-full object-contain pointer-events-none bg-transparent"
                        style={{ filter: filterStyle || undefined }}
                      />

                      {/* Resize handles */}
                      {isSelected && (
                        <>
                          <div
                            className="absolute w-3.5 h-3.5 bg-accent border-2 border-white rounded-full -bottom-1.5 -right-1.5 cursor-se-resize shadow"
                            onMouseDown={(e) => handlePlacedItemMouseDown(e, item, 'resize')}
                          />
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-text-primary text-white text-[9px] px-1.5 py-0.5 rounded shadow flex items-center gap-1 font-mono pointer-events-none">
                            {item.rotation}°
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Page Navigation & Controls */}
            <div className="flex items-center justify-between border-t border-b border-border py-2.5 mb-4 px-2 bg-bg-base/30 rounded">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentOutputPage(prev => Math.max(1, prev - 1))}
                  disabled={currentOutputPage === 1}
                  className="p-1.5 hover:bg-bg-sunken rounded text-text-secondary hover:text-text-primary transition-fast disabled:opacity-40"
                  title="Previous Page"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-semibold text-text-primary min-w-[70px] text-center font-mono">
                  Page {currentOutputPage} / {outputPagesCount}
                </span>
                <button
                  onClick={() => setCurrentOutputPage(prev => Math.min(outputPagesCount, prev + 1))}
                  disabled={currentOutputPage === outputPagesCount}
                  className="p-1.5 hover:bg-bg-sunken rounded text-text-secondary hover:text-text-primary transition-fast disabled:opacity-40"
                  title="Next Page"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleAddPage}>
                  <Plus size={12} className="mr-1" /> Add Page
                </Button>
                <button
                  onClick={handleDeletePage}
                  disabled={outputPagesCount <= 1}
                  className="px-2.5 py-1 text-xs border border-border bg-bg-surface hover:bg-error-light hover:text-error hover:border-error rounded transition-fast disabled:opacity-30 disabled:hover:bg-bg-surface disabled:hover:text-text-muted disabled:hover:border-border text-text-secondary"
                  title="Delete current page"
                >
                  <Trash2 size={12} className="inline mr-1" /> Delete
                </button>
              </div>
            </div>

            {/* Item Settings Card */}
            {selectedItem ? (
              <div className="border border-border rounded-lg p-4 bg-bg-base/50 flex flex-col gap-4 animate-fade-in-up">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                    <Sliders size={14} className="text-accent" /> Item Settings
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRotateItem}
                      className="p-1 hover:bg-bg-sunken bg-bg-surface border border-border rounded text-text-secondary hover:text-text-primary transition-fast flex items-center justify-center"
                      title="Rotate 90 degrees"
                    >
                      <RotateCw size={14} />
                    </button>
                    <button
                      onClick={handleRemoveItem}
                      className="p-1 hover:bg-error-light hover:text-error bg-bg-surface border border-border rounded text-text-secondary transition-fast flex items-center justify-center"
                      title="Delete Item"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Filter Selector */}
                <div>
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider block mb-2">Preset Filter</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['none', 'grayscale', 'binarize', 'invert'] as const).map((filterOpt) => (
                      <button
                        key={filterOpt}
                        onClick={() => handleFilterChange(filterOpt)}
                        className={`py-1 text-xs border rounded-md capitalize transition-fast ${
                          selectedItem.filter === filterOpt
                            ? 'border-accent bg-accent/10 text-accent font-semibold'
                            : 'border-border bg-bg-surface text-text-secondary hover:border-text-secondary'
                        }`}
                      >
                        {filterOpt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Adjust Sliders */}
                <div className="flex flex-col gap-3">
                  {selectedItem.filter === 'binarize' && (
                    <div>
                      <div className="flex justify-between text-xs text-text-secondary mb-1">
                        <span>Binarize Threshold</span>
                        <span className="font-mono">{selectedItem.binarizeThreshold}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="255"
                        value={selectedItem.binarizeThreshold}
                        onChange={(e) => handleSliderChange('binarizeThreshold', parseInt(e.target.value))}
                        className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between text-xs text-text-secondary mb-1">
                      <span>Brightness</span>
                      <span className="font-mono">{selectedItem.brightness > 0 ? `+${selectedItem.brightness}` : selectedItem.brightness}</span>
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      value={selectedItem.brightness}
                      onChange={(e) => handleSliderChange('brightness', parseInt(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-text-secondary mb-1">
                      <span>Contrast</span>
                      <span className="font-mono">{selectedItem.contrast > 0 ? `+${selectedItem.contrast}` : selectedItem.contrast}</span>
                    </div>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      value={selectedItem.contrast}
                      onChange={(e) => handleSliderChange('contrast', parseInt(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="border border-border/80 border-dashed rounded-lg p-6 text-center text-xs text-text-muted">
                Click a placed snippet on the layout sheet to rotate, apply grayscale/binarization filters, or adjust brightness.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
