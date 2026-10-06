import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft, Printer, Crop, Sparkles,
  RotateCcw, RotateCw, Sliders, Check, ShieldAlert, X,
  AlertCircle, Upload, XCircle, ChevronLeft, ChevronRight,
  Trash2, Plus, FilePlus, Layout, ZoomIn, ZoomOut, Maximize2, Loader2
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { PlacedSignature } from '../types/Document.types';
import Button from '../components/ui/Button';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { detectDocumentCorners, expandCropWithMargin } from '../utils/documentDetector';

// Edit Tab types
enum EditTab {
  FILTERS = 'FILTERS',
  CROP = 'CROP',
  SIGNATURE = 'SIGNATURE'
}

const SIGNATURE_FONTS = [
  'Alex Brush',
  'Mrs Saint Delafield',
  'Caveat'
];

interface Point {
  x: number;
  y: number;
}

interface QuadCrop {
  tl: Point;
  tr: Point;
  bl: Point;
  br: Point;
}

// Solves A * x = B using Gaussian elimination
function solveLinearSystem(A: number[][], B: number[]): number[] {
  const n = B.length;
  for (let i = 0; i < n; i++) {
    // Search for maximum in this column
    let maxEl = Math.abs(A[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > maxEl) {
        maxEl = Math.abs(A[k][i]);
        maxRow = k;
      }
    }

    // Swap maximum row with current row (column by column)
    for (let k = i; k < n; k++) {
      const tmp = A[maxRow][k];
      A[maxRow][k] = A[i][k];
      A[i][k] = tmp;
    }
    const tmp = B[maxRow];
    B[maxRow] = B[i];
    B[i] = tmp;

    // Singular matrix check
    if (Math.abs(A[i][i]) < 1e-8) {
      return []; // Failed to solve
    }

    // Factor remaining rows
    for (let k = i + 1; k < n; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j < n; j++) {
        if (i === j) {
          A[k][j] = 0;
        } else {
          A[k][j] += c * A[i][j];
        }
      }
      B[k] += c * B[i];
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = B[i] / A[i][i];
    for (let k = i - 1; k >= 0; k--) {
      B[k] -= A[k][i] * x[i];
    }
  }
  return x;
}

// Calculates homography matrix parameters mapping standard coordinates to warped space
function getHomography(src: Point[], dst: Point[]): number[] {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;
    A.push([dx, dy, 1, 0, 0, 0, -sx * dx, -sx * dy]);
    B.push(sx);
    A.push([0, 0, 0, dx, dy, 1, -sy * dx, -sy * dy]);
    B.push(sy);
  }
  return solveLinearSystem(A, B);
}

// Warp perspective from srcCanvas to dstCanvas
function warpPerspective(
  srcCanvas: HTMLCanvasElement,
  dstCanvas: HTMLCanvasElement,
  matrix: number[],
  dstWidth: number,
  dstHeight: number
) {
  const srcCtx = srcCanvas.getContext('2d');
  const dstCtx = dstCanvas.getContext('2d');
  if (!srcCtx || !dstCtx) return;

  const srcData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const dstData = dstCtx.createImageData(dstWidth, dstHeight);

  const [a, b, c, d, e, f, g, h] = matrix;

  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const denominator = g * x + h * y + 1;
      const srcX = (a * x + b * y + c) / denominator;
      const srcY = (d * x + e * y + f) / denominator;

      const sx = Math.round(srcX);
      const sy = Math.round(srcY);

      if (sx >= 0 && sx < srcCanvas.width && sy >= 0 && sy < srcCanvas.height) {
        const dstIdx = (y * dstWidth + x) * 4;
        const srcIdx = (sy * srcCanvas.width + sx) * 4;

        dstData.data[dstIdx] = srcData.data[srcIdx];
        dstData.data[dstIdx + 1] = srcData.data[srcIdx + 1];
        dstData.data[dstIdx + 2] = srcData.data[srcIdx + 2];
        dstData.data[dstIdx + 3] = srcData.data[srcIdx + 3];
      }
    }
  }
  dstCtx.putImageData(dstData, 0, 0);
}

// Helper to rotate a base64 image by 90 degrees
const rotateBase64Image = (base64Str: string, clockwise: boolean): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
      }
      resolve(canvas.toDataURL());
    };
    img.onerror = () => {
      resolve(base64Str);
    };
    img.src = base64Str;
  });
};


interface SortablePageItemProps {
  id: number;
  pageNumber: number;
  isSelected: boolean;
  thumbPath?: string;
  timestamp: number;
  isProcessing: boolean;
  onClick: () => void;
}

function SortablePageItem({
  id,
  pageNumber,
  isSelected,
  thumbPath,
  timestamp,
  isProcessing,
  onClick
}: SortablePageItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 30 : undefined
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={isProcessing ? undefined : onClick}
      className={`w-full flex flex-col items-center p-2 rounded-lg border transition-fast text-center relative cursor-grab active:cursor-grabbing select-none ${
        isSelected
          ? 'border-accent bg-accent/5 shadow-sm'
          : 'border-border hover:border-text-secondary hover:bg-bg-sunken'
      }`}
    >
      <div className="w-full aspect-[3/4] bg-bg-sunken rounded border border-border/50 overflow-hidden relative flex items-center justify-center mb-1.5 shadow-inner pointer-events-none">
        {thumbPath ? (
          <img
            src={`docuflow:///${thumbPath.replace(/\\/g, '/')}?t=${timestamp}`}
            alt={`Page ${pageNumber}`}
            className="w-full h-full object-contain select-none bg-white p-1"
          />
        ) : (
          <div className="animate-pulse bg-bg-sunken w-full h-full flex items-center justify-center text-[10px] text-text-muted">
            Loading...
          </div>
        )}
      </div>

      <span className="text-xs font-medium pointer-events-none text-text-secondary group-hover:text-text-primary">
        Page {pageNumber}
      </span>
    </div>
  );
}

export interface PlacedText {
  id: string;
  x: number;      // percentage (0-100)
  y: number;      // percentage (0-100)
  width: number;  // percentage (0-100)
  height: number; // percentage (0-100)
  text: string;
  fontSize: number;
  color: string;
  page: number;
}

interface SortableGridItemProps {
  id: number;
  pageNumber: number;
  thumbPath?: string;
  timestamp: number;
  isProcessing: boolean;
  onRotate: (direction: 'cw' | 'ccw') => void;
  onDelete: () => void;
  onClick: () => void;
}

function SortableGridItem({
  id,
  pageNumber,
  thumbPath,
  timestamp,
  isProcessing,
  onRotate,
  onDelete,
  onClick,
}: SortableGridItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col bg-bg-surface border border-border rounded-lg p-3 relative hover:shadow-md hover:border-accent transition-all duration-normal group select-none ${
        isDragging ? 'shadow-lg border-accent ring-2 ring-accent/15 cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* Draggable preview area */}
      <div 
        {...attributes} 
        {...listeners} 
        onClick={isProcessing ? undefined : onClick}
        className="w-full aspect-[3/4] bg-bg-sunken rounded border border-border/50 overflow-hidden relative flex items-center justify-center mb-2 shadow-inner bg-white cursor-pointer"
      >
        {thumbPath ? (
          <img
            src={`docuflow:///${thumbPath.replace(/\\/g, '/')}?t=${timestamp}`}
            alt={`Page ${pageNumber}`}
            className="w-full h-full object-contain bg-white select-none pointer-events-none p-1"
          />
        ) : (
          <div className="animate-pulse bg-bg-sunken w-full h-full flex items-center justify-center text-[11px] text-text-muted">
            Loading...
          </div>
        )}
        
        {/* Overlay Drag Hint */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 flex items-center justify-center transition-colors">
          <span className="text-[10px] text-white bg-black/60 rounded px-2 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            Drag to Move
          </span>
        </div>

        {/* Floating Page Number */}
        <span className="absolute top-2 left-2 bg-text-primary/80 text-white font-mono text-[10px] font-bold rounded px-1.5 py-0.5 animate-fade-in">
          {pageNumber}
        </span>
      </div>

      {/* Grid Item Controls */}
      <div className="flex items-center justify-between border-t border-border pt-2 bg-bg-surface select-none">
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={isProcessing}
            onClick={(e) => {
              e.stopPropagation();
              onRotate('ccw');
            }}
            className="p-1 hover:bg-bg-sunken hover:text-accent rounded text-text-secondary transition-colors"
            title="Rotate 90° CCW"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            disabled={isProcessing}
            onClick={(e) => {
              e.stopPropagation();
              onRotate('cw');
            }}
            className="p-1 hover:bg-bg-sunken hover:text-accent rounded text-text-secondary transition-colors"
            title="Rotate 90° CW"
          >
            <RotateCw size={14} />
          </button>
        </div>
        <button
          type="button"
          disabled={isProcessing}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 hover:bg-error-light hover:text-error rounded text-text-muted transition-colors"
          title="Delete Page"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}


function PreviewScreen() {
  const documents = useAppStore((state) => state.documents);
  const selectedDocumentId = useAppStore((state) => state.ui.selectedDocumentId);
  const previewBackView = useAppStore((state) => state.ui.previewBackView);
  const setView = useAppStore((state) => state.setView);
  const updateDocument = useAppStore((state) => state.updateDocument);
  const clearDocuments = useAppStore((state) => state.clearDocuments);
  const sessionSignatures = useAppStore((state) => state.sessionSignatures);
  const addSessionSignature = useAppStore((state) => state.addSessionSignature);

  const [isEditing, setIsEditing] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [activeTab, setActiveTab] = useState<EditTab>(EditTab.CROP);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<number>(Date.now());
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [showAddPageMenu, setShowAddPageMenu] = useState(false);
  const [pageThumbnails, setPageThumbnails] = useState<Record<number, string>>({});

  // Canvas Signature Modal state
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);

  // Text Annotations states
  const [placedTexts, setPlacedTexts] = useState<PlacedText[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);

  // Canvas Refs for editing
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const editedImageRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  const [activeFilter, setActiveFilter] = useState<'grayscale' | 'binarize' | 'clean' | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [displayDimensions, setDisplayDimensions] = useState<{ width: number; height: number } | null>(null);
  const [activeHandle, setActiveHandle] = useState<keyof QuadCrop | null>('tl');

  // 4 Corner Perspective Crop State (Defaults to entire image 0-100%)
  const [cropBox, setCropBox] = useState<QuadCrop>({
    tl: { x: 0, y: 0 },
    tr: { x: 100, y: 0 },
    bl: { x: 0, y: 100 },
    br: { x: 100, y: 100 }
  });

  // Subject detector margin state & raw detected box ref
  const [cropMargin, setCropMargin] = useState<number>(1.5);
  const rawDetectedBoxRef = useRef<QuadCrop | null>(null);

  // Auto-crop detector loading spinner state
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);

  // Checks whether the crop box has been adjusted away from the default full-image rectangle
  const isCropPending = useCallback((): boolean => {
    const isDefault =
      Math.abs(cropBox.tl.x - 0) < 0.8 &&
      Math.abs(cropBox.tl.y - 0) < 0.8 &&
      Math.abs(cropBox.tr.x - 100) < 0.8 &&
      Math.abs(cropBox.tr.y - 0) < 0.8 &&
      Math.abs(cropBox.bl.x - 0) < 0.8 &&
      Math.abs(cropBox.bl.y - 100) < 0.8 &&
      Math.abs(cropBox.br.x - 100) < 0.8 &&
      Math.abs(cropBox.br.y - 100) < 0.8;
    return !isDefault;
  }, [cropBox]);

  // Compute and lock display dimensions to match image aspect ratio inside the workspace
  const updateDisplayDimensions = useCallback(() => {
    const ws = workspaceRef.current;
    const img = editedImageRef.current || originalImageRef.current;
    if (!ws || !img) return;
    const imgW = (img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width) || 0;
    const imgH = (img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height) || 0;
    if (imgW === 0 || imgH === 0) return;

    const wsRect = ws.getBoundingClientRect();
    if (wsRect.width === 0 || wsRect.height === 0) return;

    const pad = 24; // safety padding so canvas never overflows workspace
    const availW = Math.max(50, wsRect.width - pad);
    const availH = Math.max(50, wsRect.height - pad);
    const scale = Math.min(availW / imgW, availH / imgH);
    const displayW = Math.max(1, Math.round(imgW * scale));
    const displayH = Math.max(1, Math.round(imgH * scale));
    setDisplayDimensions({ width: displayW, height: displayH });
  }, []);

  // Sync display dimensions on window/workspace resize
  useEffect(() => {
    if (!isEditing || !workspaceRef.current) return;
    const observer = new ResizeObserver(() => {
      updateDisplayDimensions();
    });
    observer.observe(workspaceRef.current);
    updateDisplayDimensions();
    return () => observer.disconnect();
  }, [isEditing, updateDisplayDimensions]);

  // Custom Crop Dimensions State
  const [customCropEnabled, setCustomCropEnabled] = useState(false);
  const [customCropWidth, setCustomCropWidth] = useState<string>('');
  const [customCropHeight, setCustomCropHeight] = useState<string>('');
  const [customCropUnit, setCustomCropUnit] = useState<'px' | 'mm' | 'cm' | 'in'>('px');

  // Interactive draw crop state
  const [drawCropStart, setDrawCropStart] = useState<Point | null>(null);
  const prevCropBeforeDrawRef = useRef<QuadCrop>(cropBox);

  const applyCustomCropDimensions = (
    widthStr?: string,
    heightStr?: string,
    unitStr?: 'px' | 'mm' | 'cm' | 'in'
  ) => {
    const wVal = parseFloat(widthStr !== undefined ? widthStr : customCropWidth);
    const hVal = parseFloat(heightStr !== undefined ? heightStr : customCropHeight);
    const unit = unitStr || customCropUnit;

    if (isNaN(wVal) || isNaN(hVal) || wVal <= 0 || hVal <= 0) {
      toast.error('Please enter valid width and height numbers.');
      return;
    }

    const img = editedImageRef.current || originalImageRef.current;
    const imgWidth = img ? (img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width) : 1000;
    const imgHeight = img ? (img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height) : 1000;

    const dpi = 300;
    let targetWpx = wVal;
    let targetHpx = hVal;

    if (unit === 'cm') {
      targetWpx = (wVal * dpi) / 2.54;
      targetHpx = (hVal * dpi) / 2.54;
    } else if (unit === 'mm') {
      targetWpx = (wVal * dpi) / 25.4;
      targetHpx = (hVal * dpi) / 25.4;
    } else if (unit === 'in') {
      targetWpx = wVal * dpi;
      targetHpx = hVal * dpi;
    }

    let pctW = (targetWpx / imgWidth) * 100;
    let pctH = (targetHpx / imgHeight) * 100;

    if (pctW > 100 || pctH > 100) {
      const scaleFactor = Math.min(100 / pctW, 100 / pctH);
      pctW *= scaleFactor;
      pctH *= scaleFactor;
    }

    const left = Math.max(0, (100 - pctW) / 2);
    const top = Math.max(0, (100 - pctH) / 2);

    setCropBox({
      tl: { x: left, y: top },
      tr: { x: Math.min(100, left + pctW), y: top },
      bl: { x: left, y: Math.min(100, top + pctH) },
      br: { x: Math.min(100, left + pctW), y: Math.min(100, top + pctH) }
    });

    toast.success(`Crop box updated to ${wVal} × ${hVal} ${unit}`);
  };

  // Signature states
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);
  const [placedSignatures, setPlacedSignatures] = useState<PlacedSignature[]>([]);

  // Typed signature states
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [sigTypeName, setSigTypeName] = useState('');
  const [sigTypeInitials, setSigTypeInitials] = useState('');
  const [sigTypeFontIndex, setSigTypeFontIndex] = useState(0);
  const [sigInitialsFontIndex, setSigInitialsFontIndex] = useState(0);
  const [isChangingSigStyle, setIsChangingSigStyle] = useState(false);
  const [isChangingInitialsStyle, setIsChangingInitialsStyle] = useState(false);

  // 3-Step Signature Upload Wizard states
  const [uploadStep, setUploadStep] = useState<'select' | 'crop' | 'preview'>('select');
  const [uploadRawImg, setUploadRawImg] = useState<string | null>(null);
  const [sigCropBox, setSigCropBox] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 15,
    y: 25,
    width: 70,
    height: 30 // Initial 140px x 60px ratio (70 / (140/60)) = 30
  });
  const [croppedSigDataUrl, setCroppedSigDataUrl] = useState<string | null>(null);
  const sigCropContainerRef = useRef<HTMLDivElement>(null);

  const processRemoveBackground = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);

        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        // 1. Calculate min and max luminance across all pixels
        let minLum = 255;
        let maxLum = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum < minLum) minLum = lum;
          if (lum > maxLum) maxLum = lum;
        }

        // 2. Determine adaptive background threshold
        const lumRange = maxLum - minLum;
        const threshold = lumRange > 20 ? minLum + lumRange * 0.55 : 200;

        // 3. Process pixels: paper background -> transparent, ink -> crisp dark
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;

          if (lum > threshold) {
            // Paper background -> 100% Transparent
            data[i + 3] = 0;
          } else {
            // Ink stroke -> calculate smooth alpha & enhance dark ink contrast
            const factor = Math.max(0, Math.min(1, (threshold - lum) / Math.max(1, threshold - minLum)));
            const alpha = Math.round(150 + factor * 105);

            data[i] = Math.max(0, Math.round(r * 0.3));
            data[i + 1] = Math.max(0, Math.round(g * 0.3));
            data[i + 2] = Math.max(0, Math.round(b * 0.3));
            data[i + 3] = alpha;
          }
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  };

  const handleSigCropMouseMove = (e: React.MouseEvent) => {
    if (!dragStart || !dragType || !dragType.startsWith('sigUploadCrop-') || !sigCropContainerRef.current) return;

    const rect = sigCropContainerRef.current.getBoundingClientRect();
    const deltaXPct = ((e.clientX - dragStart.x) / rect.width) * 100;
    const deltaYPct = ((e.clientY - dragStart.y) / rect.height) * 100;

    const handleType = dragType.replace('sigUploadCrop-', '');

    setSigCropBox((prev) => {
      let newX = prev.x;
      let newY = prev.y;
      let newW = prev.width;
      let newH = prev.height;

      const aspect = 140 / 60; // 140:60 aspect ratio (2.333)

      if (handleType === 'move') {
        newX = Math.max(0, Math.min(100 - prev.width, prev.x + deltaXPct));
        newY = Math.max(0, Math.min(100 - prev.height, prev.y + deltaYPct));
      } else {
        // Proportional resizing: width & height scale correspondingly maintaining 140x40 ratio
        if (handleType.includes('r') || handleType.includes('l')) {
          const wChange = handleType.includes('l') ? -deltaXPct : deltaXPct;
          newW = Math.max(15, Math.min(100 - prev.x, prev.width + wChange));
          newH = newW / aspect;
        } else {
          const hChange = handleType.includes('t') ? -deltaYPct : deltaYPct;
          newH = Math.max(5, Math.min(100 - prev.y, prev.height + hChange));
          newW = newH * aspect;
        }
      }

      return { x: newX, y: newY, width: newW, height: newH };
    });

    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleConfirmSigCrop = () => {
    if (!uploadRawImg) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const cropX = (sigCropBox.x / 100) * img.width;
      const cropY = (sigCropBox.y / 100) * img.height;
      const cropW = (sigCropBox.width / 100) * img.width;
      const cropH = (sigCropBox.height / 100) * img.height;

      canvas.width = Math.max(10, cropW);
      canvas.height = Math.max(10, cropH);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
      setCroppedSigDataUrl(canvas.toDataURL('image/png'));
      setUploadStep('preview');
    };
    img.src = uploadRawImg;
  };

  const handleFinalizeUploadSignature = async () => {
    if (!croppedSigDataUrl) return;
    setIsProcessing(true);
    try {
      const transparentDataUrl = await processRemoveBackground(croppedSigDataUrl);
      const newSig: PlacedSignature = {
        id: Math.random().toString(36).substring(2, 9),
        x: 35,
        y: 35,
        width: 30,
        height: 15,
        imgSrc: transparentDataUrl,
        page: pageNumber,
        rotation: 0
      };
      setPlacedSignatures((prev) => [...prev, newSig]);
      addSessionSignature(transparentDataUrl);
      toast.success('Transparent signature created & placed on document!');
      setIsSignatureModalOpen(false);
      setUploadStep('select');
      setUploadRawImg(null);
      setCroppedSigDataUrl(null);
    } catch (err) {
      toast.error('Failed to remove signature background.');
    } finally {
      setIsProcessing(false);
    }
  };

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragType, setDragType] = useState<string | null>(null); // 'tl', 'tr', 'bl', 'br', 'sigMove-id', 'sigResize-id', 'edge-top', etc.

  // Zoom & Pan states for editor workspace (CTRL + Scroll Wheel & Canvas Drag)
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [panPosition, setPanPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Spacebar pan mode detection & Escape key to discard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        setIsSpacePressed(true);
      }
      if (e.key === 'Escape' && isEditing && !isSignatureModalOpen) {
        handleDiscardEdit();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isEditing, isSignatureModalOpen]);

  // Reset zoom & pan on exiting editing
  useEffect(() => {
    if (!isEditing) {
      setZoomScale(1.0);
      setPanPosition({ x: 0, y: 0 });
    }
  }, [isEditing]);

  // Non-passive Ctrl + Wheel listener for smooth canvas zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isEditing) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        setZoomScale((prev) => parseFloat(Math.min(4.0, Math.max(0.5, prev + delta)).toFixed(2)));
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [isEditing]);

  const doc = documents.find((d) => d.id === selectedDocumentId);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !doc) return;

    const pages = Array.from({ length: doc.pageCount }, (_, i) => i + 1);
    const oldIndex = pages.indexOf(active.id as number);
    const newIndex = pages.indexOf(over.id as number);

    const reorderedPages = arrayMove(pages, oldIndex, newIndex);

    setIsProcessing(true);
    try {
      const result = await window.electron.reorderPages(doc.id, reorderedPages);
      if (result.success) {
        // Find the new page number for the currently selected page
        const selectedPageIndex = reorderedPages.indexOf(pageNumber);
        const newPageNum = selectedPageIndex !== -1 ? selectedPageIndex + 1 : 1;

        // 1. Update document item metadata in store
        updateDocument(doc.id, result.data);

        // 2. Explicitly load/generate all thumbnails for the updated document first!
        await loadAllPageThumbnails(result.data);

        // 3. Explicitly render the preview image for the new active page number
        const renderResult = await window.electron.renderPdfPage(doc.id, newPageNum);
        if (renderResult.success) {
          setPreviewImagePath(renderResult.data);
        }

        // 4. Update the pageNumber and timestamp at the same time to force a full re-render
        setPageNumber(newPageNum);
        setTimestamp(Date.now());

        toast.success('Pages rearranged successfully');
      } else {
        toast.error(result.error.message);
      }
    } catch (e) {
      toast.error('Failed to rearrange pages');
    } finally {
      setIsProcessing(false);
    }
  };

  // Load existing signatures when entering edit mode or page switches
  useEffect(() => {
    if (doc && isEditing) {
      const pageSigs = (doc.signatures || []).filter((sig) => (sig.page || 1) === pageNumber);
      setPlacedSignatures(pageSigs);
    }
  }, [isEditing, doc, pageNumber]);

  // Reset page number and sync existing signatures to session library when document changes
  useEffect(() => {
    setPageNumber(1);
    if (doc && doc.signatures && doc.signatures.length > 0) {
      doc.signatures.forEach((sig) => {
        addSessionSignature(sig.imgSrc);
      });
    }
  }, [selectedDocumentId, doc, addSessionSignature]);

  // Pre-render or load document image paths on mount or page change
  useEffect(() => {
    if (doc) {
      loadPreviewImage();
    }
  }, [doc, pageNumber]);

  const loadPreviewImage = async () => {
    if (!doc) return;
    setIsProcessing(true);
    try {
      if (doc.type === 'PDF') {
        const renderResult = await window.electron.renderPdfPage(doc.id, pageNumber);
        if (renderResult.success) {
          setPreviewImagePath(renderResult.data);
          setTimestamp(Date.now());
        } else {
          toast.error(renderResult.error.message);
        }
      } else {
        setPreviewImagePath(doc.tempPath);
        setTimestamp(Date.now());
      }
    } catch (e) {
      toast.error('Failed to load preview image');
    } finally {
      setIsProcessing(false);
    }
  };

  const loadAllPageThumbnails = async (targetDoc = doc) => {
    if (!targetDoc || targetDoc.type !== 'PDF') return;
    const thumbs: Record<number, string> = {};
    const pages = Array.from({ length: targetDoc.pageCount }, (_, i) => i + 1);
    await Promise.all(
      pages.map(async (i) => {
        try {
          const res = await window.electron.renderPdfPageThumbnail(targetDoc.id, i);
          if (res.success) {
            thumbs[i] = res.data;
          }
        } catch (e) {
          console.error(`Failed to load thumbnail for page ${i}`, e);
        }
      })
    );
    setPageThumbnails(thumbs);
  };

  useEffect(() => {
    if (doc && doc.type === 'PDF') {
      loadAllPageThumbnails();
    }
  }, [selectedDocumentId, doc?.pageCount, doc?.tempPath]);

  const handleDeletePageAt = async (pNum: number) => {
    if (!doc) return;
    const confirmed = await useAppStore.getState().showConfirm(
      `Are you sure you want to delete Page ${pNum} of "${doc.filename}"? This action cannot be undone.`,
      'Delete Page'
    );
    if (!confirmed) return;

    setIsProcessing(true);
    try {
      const result = await window.electron.deletePage(doc.id, pNum);
      if (result.success) {
        updateDocument(doc.id, result.data);
        toast.success(`Page ${pNum} deleted successfully`);
        const newPageNum = Math.max(1, Math.min(pageNumber, result.data.pageCount));
        setPageNumber(newPageNum);
        setTimestamp(Date.now());
      } else {
        toast.error(result.error.message);
      }
    } catch (e) {
      toast.error('Failed to delete page');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeletePage = () => handleDeletePageAt(pageNumber);

  const handleRotatePageAt = async (pNum: number, direction: 'cw' | 'ccw') => {
    if (!doc) return;
    setIsProcessing(true);
    try {
      const result = await window.electron.rotatePage(doc.id, pNum, direction);
      if (result.success) {
        updateDocument(doc.id, result.data);
        toast.success(`Page ${pNum} rotated successfully`);
        
        await loadAllPageThumbnails(result.data);
        
        if (pNum === pageNumber) {
          const renderResult = await window.electron.renderPdfPage(doc.id, pageNumber);
          if (renderResult.success) {
            setPreviewImagePath(renderResult.data);
          }
        }
        setTimestamp(Date.now());
      } else {
        toast.error(result.error.message);
      }
    } catch (e) {
      toast.error('Failed to rotate page');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddBlankPage = async () => {
    setShowAddPageMenu(false);
    if (!doc) return;
    setIsProcessing(true);
    try {
      const insertAtPage = pageNumber + 1;
      const result = await window.electron.addPage(doc.id, insertAtPage);
      if (result.success) {
        updateDocument(doc.id, result.data);
        toast.success('Blank page inserted successfully');
        setPageNumber(insertAtPage);
        setTimestamp(Date.now());
      } else {
        toast.error(result.error.message);
      }
    } catch (e) {
      toast.error('Failed to insert blank page');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddPageFromFile = async () => {
    setShowAddPageMenu(false);
    if (!doc) return;

    try {
      const dialogRes = await window.electron.showOpenDialog({
        title: 'Select PDF or Image to Insert',
        filters: [
          { name: 'Supported Files', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'] },
          { name: 'PDF Documents', extensions: ['pdf'] },
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'] }
        ],
        properties: ['openFile']
      });

      if (!dialogRes.success || !dialogRes.data || dialogRes.data.length === 0) {
        return;
      }

      const filePath = dialogRes.data[0];
      setIsProcessing(true);

      const insertAtPage = pageNumber + 1;
      const result = await window.electron.addPage(doc.id, insertAtPage, filePath);
      if (result.success) {
        updateDocument(doc.id, result.data);
        toast.success('Page(s) inserted successfully from file');
        setPageNumber(insertAtPage);
        setTimestamp(Date.now());
      } else {
        toast.error(result.error.message);
      }
    } catch (e) {
      toast.error('Failed to insert page from file');
    } finally {
      setIsProcessing(false);
    }
  };

  // Image load & setup for editing
  const setupEditorImage = () => {
    if (!doc) return;
    const baseImgPath = doc.cleanTempPaths?.[pageNumber] || previewImagePath;
    if (!baseImgPath) return;
    const img = new Image();
    img.src = `docuflow:///${baseImgPath.replace(/\\/g, '/')}?t=${timestamp}`;
    img.onload = () => {
      originalImageRef.current = img;
      editedImageRef.current = img;
      setActiveFilter(null);
      setCanvasDimensions({ width: img.width, height: img.height });
      resetCanvas();
      setTimeout(() => {
        updateDisplayDimensions();
        // If in Crop tab, run auto-detection to snap to subject with margin
        if (activeTab === EditTab.CROP) {
          handleAutoCrop(cropMargin, true);
        }
      }, 60);
    };
    img.onerror = () => {
      toast.error('Failed to load editor image');
      setIsEditing(false);
    };
  };

  useEffect(() => {
    if (isEditing && (previewImagePath || doc?.cleanTempPaths?.[pageNumber])) {
      setupEditorImage();
    }
  }, [isEditing, previewImagePath, doc?.cleanTempPaths?.[pageNumber]]);

  const resetCanvas = () => {
    const canvas = canvasRef.current;
    const img = originalImageRef.current;
    if (!canvas || !img) return;

    editedImageRef.current = img;
    setActiveFilter(null);

    canvas.width = img.width;
    canvas.height = img.height;
    setCanvasDimensions({ width: img.width, height: img.height });
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
    }
    setCropBox({
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      bl: { x: 0, y: 100 },
      br: { x: 100, y: 100 }
    });
    setActiveHandle('tl');
    setPlacedSignatures((doc?.signatures || []).filter((sig) => (sig.page || 1) === pageNumber));
  };

  const applyFilterPixels = (canvas: HTMLCanvasElement, filterType: 'grayscale' | 'binarize' | 'clean') => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    if (filterType === 'grayscale') {
      for (let i = 0; i < data.length; i += 4) {
        const grayscale = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
        data[i] = grayscale;
        data[i + 1] = grayscale;
        data[i + 2] = grayscale;
      }
    } else if (filterType === 'binarize') {
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
        const val = gray > 127 ? 255 : 0;
        data[i] = val;
        data[i + 1] = val;
        data[i + 2] = val;
      }
    } else if (filterType === 'clean') {
      // Document enhancement (contrast boost + high pass)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        let target = gray;
        if (gray > 160) {
          target = Math.min(255, gray * 1.25); // Bleach backgrounds
        } else if (gray < 80) {
          target = Math.max(0, gray * 0.6); // Darken text
        } else {
          target = (gray - 80) * 1.5 + 40; // High contrast midtones
        }

        data[i] = target;
        data[i + 1] = target;
        data[i + 2] = target;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  };

  const redrawCanvas = (filterOverride?: 'grayscale' | 'binarize' | 'clean' | null) => {
    const canvas = canvasRef.current;
    const img = editedImageRef.current || originalImageRef.current;
    if (!canvas || !img) return;

    canvas.width = img.width;
    canvas.height = img.height;
    setCanvasDimensions({ width: img.width, height: img.height });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0);

    const filterToApply = filterOverride !== undefined ? filterOverride : activeFilter;
    if (filterToApply) {
      applyFilterPixels(canvas, filterToApply);
    }
  };

  // Filter application
  const applyFilter = (filterType: 'grayscale' | 'binarize' | 'clean') => {
    setActiveFilter(filterType);
    redrawCanvas(filterType);
    toast.success(`${filterType.toUpperCase()} filter applied`);
  };

  // Run perspective warp cropping
  const executeCrop = (showToast = true): boolean => {
    const canvas = canvasRef.current;
    const img = editedImageRef.current || originalImageRef.current;
    if (!canvas || !img) return false;

    // Map percentage handles back to actual source image pixel coordinates based on img width/height
    const srcPoints: Point[] = [
      { x: (cropBox.tl.x / 100) * img.width, y: (cropBox.tl.y / 100) * img.height },
      { x: (cropBox.tr.x / 100) * img.width, y: (cropBox.tr.y / 100) * img.height },
      { x: (cropBox.bl.x / 100) * img.width, y: (cropBox.bl.y / 100) * img.height },
      { x: (cropBox.br.x / 100) * img.width, y: (cropBox.br.y / 100) * img.height }
    ];

    // Compute size of destination bounding rect (use average coordinates)
    const w1 = Math.hypot(srcPoints[1].x - srcPoints[0].x, srcPoints[1].y - srcPoints[0].y);
    const w2 = Math.hypot(srcPoints[3].x - srcPoints[2].x, srcPoints[3].y - srcPoints[2].y);
    const dstWidth = Math.round(Math.max(w1, w2));

    const h1 = Math.hypot(srcPoints[2].x - srcPoints[0].x, srcPoints[2].y - srcPoints[0].y);
    const h2 = Math.hypot(srcPoints[3].x - srcPoints[1].x, srcPoints[3].y - srcPoints[1].y);
    const dstHeight = Math.round(Math.max(h1, h2));

    if (dstWidth < 10 || dstHeight < 10) {
      toast.error('Crop area is too small.');
      return false;
    }

    // Target rectangular output coordinates
    const dstPoints: Point[] = [
      { x: 0, y: 0 },
      { x: dstWidth, y: 0 },
      { x: 0, y: dstHeight },
      { x: dstWidth, y: dstHeight }
    ];

    // Create temp canvas containing original state
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return false;
    tempCtx.drawImage(img, 0, 0);

    // Create cropped canvas for destination
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = dstWidth;
    croppedCanvas.height = dstHeight;

    // Solve homography
    const matrix = getHomography(srcPoints, dstPoints);
    if (matrix.length === 0) {
      toast.error('Failed to compute perspective matrix. Verify shape.');
      return false;
    }

    // Resize canvas and project pixels projectively
    warpPerspective(tempCanvas, croppedCanvas, matrix, dstWidth, dstHeight);

    // Save the cropped version
    editedImageRef.current = croppedCanvas;
    setCanvasDimensions({ width: dstWidth, height: dstHeight });

    // Reset selection handles to full image
    setCropBox({
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      bl: { x: 0, y: 100 },
      br: { x: 100, y: 100 }
    });
    rawDetectedBoxRef.current = null;
    setActiveHandle('tl');

    // Redraw canvas and apply active filter if present
    redrawCanvas();
    updateDisplayDimensions();

    if (showToast) {
      toast.success('Perspective crop applied');
    }
    return true;
  };

  const handleRotate = async (clockwise: boolean) => {
    const img = editedImageRef.current || originalImageRef.current;
    if (!img) return;

    // Create rotated canvas
    const rotatedCanvas = document.createElement('canvas');
    rotatedCanvas.width = img.height;
    rotatedCanvas.height = img.width;
    const ctx = rotatedCanvas.getContext('2d');
    if (!ctx) return;

    ctx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
    ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    // Save rotated image
    editedImageRef.current = rotatedCanvas;
    setCanvasDimensions({ width: rotatedCanvas.width, height: rotatedCanvas.height });

    // Rotate placed signatures for this page
    const rotatedSigs = await Promise.all(
      placedSignatures.map(async (sig) => {
        const rotatedImgSrc = await rotateBase64Image(sig.imgSrc, clockwise);
        const newX = clockwise ? 100 - sig.y - sig.height : sig.y;
        const newY = clockwise ? sig.x : 100 - sig.x - sig.width;
        return {
          ...sig,
          x: newX,
          y: newY,
          width: sig.height,
          height: sig.width,
          imgSrc: rotatedImgSrc
        };
      })
    );
    setPlacedSignatures(rotatedSigs);

    // Rotate placed texts for this page
    const rotatedTexts = placedTexts.map((txt) => {
      const newX = clockwise ? 100 - txt.y - txt.height : txt.y;
      const newY = clockwise ? txt.x : 100 - txt.x - txt.width;
      return {
        ...txt,
        x: newX,
        y: newY,
        width: txt.height,
        height: txt.width
      };
    });
    setPlacedTexts(rotatedTexts);

    // Reset crop handles to fit the new aspect ratio / rotated image
    setCropBox({
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      bl: { x: 0, y: 100 },
      br: { x: 100, y: 100 }
    });
    rawDetectedBoxRef.current = null;
    setActiveHandle('tl');

    // Redraw canvas
    redrawCanvas();
    updateDisplayDimensions();

    toast.success(`Rotated 90° ${clockwise ? 'clockwise' : 'counter-clockwise'}`);
  };

  const handleResetFilters = () => {
    setActiveFilter(null);
    redrawCanvas(null);
    toast.success('Filters reset');
  };

  const handleResetCrop = () => {
    const img = originalImageRef.current;
    if (!img) return;

    editedImageRef.current = img;
    setCanvasDimensions({ width: img.width, height: img.height });
    setCropBox({
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      bl: { x: 0, y: 100 },
      br: { x: 100, y: 100 }
    });
    rawDetectedBoxRef.current = null;
    setActiveHandle('tl');

    setPlacedSignatures((doc?.signatures || []).filter((sig) => (sig.page || 1) === pageNumber));
    setPlacedTexts([]);
    setActiveFilter(null);
    redrawCanvas(null);
    updateDisplayDimensions();
    toast.success('Crop and rotation reset to original');
  };

  // Clean cancellation that resets all pending annotations, filters, and canvas edits
  const handleDiscardEdit = useCallback(() => {
    setIsEditing(false);
    setPlacedSignatures((doc?.signatures || []).filter((sig) => (sig.page || 1) === pageNumber));
    setPlacedTexts([]);
    setSelectedTextId(null);
    setActiveFilter(null);
    if (originalImageRef.current) {
      editedImageRef.current = originalImageRef.current;
      redrawCanvas(null);
    }
    toast.error('Changes discarded');
  }, [doc, pageNumber]);

  // Draw real-time magnifying loupe zoom with safe boundary clamping
  const drawLoupe = useCallback((pctX: number, pctY: number) => {
    const loupeCanvas = loupeCanvasRef.current;
    const canvas = canvasRef.current;
    if (!loupeCanvas || !canvas || canvas.width === 0 || canvas.height === 0) return;

    const ctx = loupeCanvas.getContext('2d');
    if (!ctx) return;

    const destSize = 130;
    if (loupeCanvas.width !== destSize || loupeCanvas.height !== destSize) {
      loupeCanvas.width = destSize;
      loupeCanvas.height = destSize;
    }

    // Clear loupe canvas with clean dark neutral background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, destSize, destSize);

    // Map handle percentages to canvas coordinates
    const px = (pctX / 100) * canvas.width;
    const py = (pctY / 100) * canvas.height;

    // Magnified zoom parameters: crop a square around handle and stretch to 130x130 loupe
    const srcSize = Math.max(20, Math.min(Math.min(canvas.width, canvas.height), 92));
    const halfSrc = srcSize / 2;

    // Safe bounds clamping to avoid drawImage out-of-bounds error on extreme edges
    const sx = Math.max(0, Math.min(canvas.width - 1, px - halfSrc));
    const sy = Math.max(0, Math.min(canvas.height - 1, py - halfSrc));
    const sw = Math.max(1, Math.min(canvas.width - sx, (px + halfSrc) - sx));
    const sh = Math.max(1, Math.min(canvas.height - sy, (py + halfSrc) - sy));

    const dx = Math.round(((sx - (px - halfSrc)) / srcSize) * destSize);
    const dy = Math.round(((sy - (py - halfSrc)) / srcSize) * destSize);
    const dw = Math.round((sw / srcSize) * destSize);
    const dh = Math.round((sh / srcSize) * destSize);

    try {
      ctx.drawImage(canvas, sx, sy, sw, sh, dx, dy, dw, dh);
    } catch {
      // Fallback if coordinates are out of bounds
    }

    // Draw 90-degree crossing target lines (crosshairs) crossing the exact center
    const center = destSize / 2;
    ctx.strokeStyle = '#EF4444'; // Solid Red crosshair lines
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Vertical line
    ctx.moveTo(center, 0);
    ctx.lineTo(center, destSize);
    // Horizontal line
    ctx.moveTo(0, center);
    ctx.lineTo(destSize, center);
    ctx.stroke();

    // Center precision circle
    ctx.beginPath();
    ctx.arc(center, center, 4, 0, 2 * Math.PI);
    ctx.stroke();
  }, []);

  // Automatically keep Loupe updated when switching to crop tab or when handles change
  useEffect(() => {
    if (activeTab === EditTab.CROP && activeHandle && ['tl', 'tr', 'bl', 'br'].includes(activeHandle)) {
      const handle = activeHandle as keyof QuadCrop;
      const timer = setTimeout(() => {
        drawLoupe(cropBox[handle].x, cropBox[handle].y);
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [activeTab, activeHandle, cropBox, canvasDimensions, drawLoupe]);

  // Automatic document & ID boundary detection with margin and visual loading state
  const handleAutoCrop = useCallback((margin: number = cropMargin, isInitialAuto: boolean = false) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      if (!isInitialAuto) toast.error('No image canvas available to detect');
      return;
    }
    if (!isInitialAuto) setIsAutoDetecting(true);
    // Yield execution to the browser thread so the loading spinner renders immediately
    setTimeout(() => {
      try {
        const result = detectDocumentCorners(canvas, margin);
        if (result.hasDetectedSubject) {
          rawDetectedBoxRef.current = result.rawBox;
          setCropBox(result.cropBox);
          setActiveHandle('tl');
          setTimeout(() => {
            drawLoupe(result.cropBox.tl.x, result.cropBox.tl.y);
          }, 20);
          if (isInitialAuto) {
            toast.success(`Subject automatically detected with ${margin}% margin`, { icon: '✨' });
          } else {
            toast.success(`Subject detected with ${margin}% margin`, { icon: '✨' });
          }
        } else {
          rawDetectedBoxRef.current = null;
          if (!isInitialAuto) {
            setCropBox({
              tl: { x: 0, y: 0 },
              tr: { x: 100, y: 0 },
              bl: { x: 0, y: 100 },
              br: { x: 100, y: 100 }
            });
            toast('No distinct subject found; framed to full image', { icon: 'ℹ️' });
          }
        }
      } catch (err) {
        console.error('Auto crop error:', err);
        if (!isInitialAuto) toast.error('Failed to auto-detect document');
      } finally {
        if (!isInitialAuto) setIsAutoDetecting(false);
      }
    }, 50);
  }, [cropMargin, drawLoupe]);

  // Adjust margin dynamically on detected subject
  const applySubjectWithMargin = useCallback((newMargin: number) => {
    const raw = rawDetectedBoxRef.current;
    if (!raw) {
      handleAutoCrop(newMargin, false);
      return;
    }
    const expanded = expandCropWithMargin(raw, newMargin);
    setCropBox(expanded);
    drawLoupe(expanded.tl.x, expanded.tl.y);
    toast.success(`Subject margin updated to ${newMargin}%`);
  }, [handleAutoCrop, drawLoupe]);

  // Signature Pad Handlers
  const startSigDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const sigCanvas = sigCanvasRef.current;
    if (!sigCanvas) return;
    const ctx = sigCanvas.getContext('2d');
    if (!ctx) return;

    const rect = sigCanvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#000000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setIsDrawingSig(true);
  };

  const drawSigLine = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig) return;
    const sigCanvas = sigCanvasRef.current;
    if (!sigCanvas) return;
    const ctx = sigCanvas.getContext('2d');
    if (!ctx) return;

    const rect = sigCanvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const startSigDrawingTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const sigCanvas = sigCanvasRef.current;
    if (!sigCanvas || e.touches.length !== 1) return;
    const ctx = sigCanvas.getContext('2d');
    if (!ctx) return;

    const rect = sigCanvas.getBoundingClientRect();
    const touch = e.touches[0];
    ctx.beginPath();
    ctx.moveTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#000000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setIsDrawingSig(true);
  };

  const drawSigLineTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig || e.touches.length !== 1) return;
    const sigCanvas = sigCanvasRef.current;
    if (!sigCanvas) return;
    const ctx = sigCanvas.getContext('2d');
    if (!ctx) return;

    const rect = sigCanvas.getBoundingClientRect();
    const touch = e.touches[0];
    ctx.lineTo(touch.clientX - rect.left, touch.clientY - rect.top);
    ctx.stroke();
  };

  const endSigDrawing = () => {
    setIsDrawingSig(false);
  };

  const clearSigPad = () => {
    const sigCanvas = sigCanvasRef.current;
    if (!sigCanvas) return;
    const ctx = sigCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  };

  const trimCanvas = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const imgWidth = canvas.width;
    const imgHeight = canvas.height;
    const imgData = ctx.getImageData(0, 0, imgWidth, imgHeight);
    const data = imgData.data;

    let minX = imgWidth;
    let minY = imgHeight;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < imgHeight; y++) {
      for (let x = 0; x < imgWidth; x++) {
        const index = (y * imgWidth + x) * 4;
        const alpha = data[index + 3];
        if (alpha > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) {
      return canvas;
    }

    const pad = 5;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(imgWidth - cropX, (maxX - minX) + pad * 2);
    const cropH = Math.min(imgHeight - cropY, (maxY - minY) + pad * 2);

    const trimmedCanvas = document.createElement('canvas');
    trimmedCanvas.width = cropW;
    trimmedCanvas.height = cropH;
    const trimmedCtx = trimmedCanvas.getContext('2d');
    if (!trimmedCtx) return canvas;

    trimmedCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return trimmedCanvas;
  };

  const handleAddSignature = () => {
    const sigCanvas = sigCanvasRef.current;
    if (!sigCanvas) return;

    // Check if canvas has drawings
    const blank = document.createElement('canvas');
    blank.width = sigCanvas.width;
    blank.height = sigCanvas.height;
    if (sigCanvas.toDataURL() === blank.toDataURL()) {
      toast.error('Please draw a signature first.');
      return;
    }

    const trimmedCanvas = trimCanvas(sigCanvas);
    const dataUrl = trimmedCanvas.toDataURL();
    const newSig: PlacedSignature = {
      id: Math.random().toString(36).substring(2, 9),
      x: 35,
      y: 35,
      width: 30,
      height: 15,
      imgSrc: dataUrl,
      page: pageNumber
    };
    setPlacedSignatures((prev) => [...prev, newSig]);
    addSessionSignature(dataUrl);
    toast.success('Signature added! Drag and resize it on the document.');
    clearSigPad();
  };

  const generateTypedSignatureDataUrl = (text: string, sigFont: string, initialFont: string): string => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 600;
    tempCanvas.height = 200;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return '';

    // Clear canvas
    ctx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

    ctx.fillStyle = '#0f172a';
    ctx.textBaseline = 'middle';

    if (text.length > 1) {
      const firstChar = text.charAt(0);
      const restText = text.substring(1);

      const firstFontSpec = `italic 46px "${initialFont}", cursive`;
      const restFontSpec = `italic 40px "${sigFont}", cursive`;

      ctx.font = firstFontSpec;
      const firstWidth = ctx.measureText(firstChar).width;
      ctx.font = restFontSpec;
      const restWidth = ctx.measureText(restText).width;

      const totalWidth = firstWidth + restWidth;
      const startX = (tempCanvas.width - totalWidth) / 2;

      ctx.font = firstFontSpec;
      ctx.textAlign = 'left';
      ctx.fillText(firstChar, startX, tempCanvas.height / 2);

      ctx.font = restFontSpec;
      ctx.fillText(restText, startX + firstWidth, tempCanvas.height / 2);
    } else {
      ctx.font = `italic 46px "${sigFont}", cursive`;
      ctx.textAlign = 'center';
      ctx.fillText(text, tempCanvas.width / 2, tempCanvas.height / 2);
    }

    const trimmed = trimCanvas(tempCanvas);
    return trimmed.toDataURL('image/png');
  };

  const handleAddTypedSignature = () => {
    if (!sigTypeName.trim()) {
      toast.error('Please enter a name first.');
      return;
    }
    const dataUrl = generateTypedSignatureDataUrl(sigTypeName, SIGNATURE_FONTS[sigTypeFontIndex], SIGNATURE_FONTS[sigInitialsFontIndex]);
    const newSig: PlacedSignature = {
      id: Math.random().toString(36).substring(2, 9),
      x: 35,
      y: 35,
      width: 30,
      height: 15,
      imgSrc: dataUrl,
      page: pageNumber
    };
    setPlacedSignatures((prev) => [...prev, newSig]);
    addSessionSignature(dataUrl);
    toast.success('Signature added! Drag and resize it on the document.');
  };

  const handleAddTypedInitials = () => {
    if (!sigTypeInitials.trim()) {
      toast.error('Please enter initials first.');
      return;
    }
    const dataUrl = generateTypedSignatureDataUrl(sigTypeInitials, SIGNATURE_FONTS[sigInitialsFontIndex], SIGNATURE_FONTS[sigInitialsFontIndex]);
    const newSig: PlacedSignature = {
      id: Math.random().toString(36).substring(2, 9),
      x: 45,
      y: 45,
      width: 15,
      height: 15,
      imgSrc: dataUrl,
      page: pageNumber
    };
    setPlacedSignatures((prev) => [...prev, newSig]);
    addSessionSignature(dataUrl);
    toast.success('Initials added! Drag and resize on the document.');
  };

  // Save changes to backend (flattened with signatures, and clean copy preserved)
  const handleSaveEdit = async (): Promise<boolean> => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return false;

    // Auto-commit any active/pending crop box so user's adjustments are never lost
    if (isCropPending()) {
      const croppedOk = executeCrop(false);
      if (!croppedOk) {
        return false;
      }
    }

    setIsProcessing(true);
    try {
      // 1. Get base64 of the clean canvas (no signatures drawn yet)
      const cleanCanvas = document.createElement('canvas');
      cleanCanvas.width = canvas.width;
      cleanCanvas.height = canvas.height;
      const cleanCtx = cleanCanvas.getContext('2d');
      if (!cleanCtx) throw new Error('Could not get 2D context for clean canvas');
      cleanCtx.fillStyle = '#ffffff';
      cleanCtx.fillRect(0, 0, cleanCanvas.width, cleanCanvas.height);
      cleanCtx.drawImage(canvas, 0, 0);
      const cleanBase64Data = cleanCanvas.toDataURL('image/jpeg', 0.95);

      // 2. Create a temporary canvas to draw the flattened version with signatures
      const flatCanvas = document.createElement('canvas');
      flatCanvas.width = canvas.width;
      flatCanvas.height = canvas.height;
      const flatCtx = flatCanvas.getContext('2d');
      if (!flatCtx) throw new Error('Could not get 2D context for flattening');

      // Draw clean canvas contents on solid white background
      flatCtx.fillStyle = '#ffffff';
      flatCtx.fillRect(0, 0, flatCanvas.width, flatCanvas.height);
      flatCtx.drawImage(canvas, 0, 0);

      // Draw all signatures in correct position
      const loadPromises = placedSignatures.map((sig) => {
        return new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const destX = (sig.x / 100) * canvas.width;
            const destY = (sig.y / 100) * canvas.height;
            const destW = (sig.width / 100) * canvas.width;
            const destH = (sig.height / 100) * canvas.height;
            
            flatCtx.save();
            const centerX = destX + destW / 2;
            const centerY = destY + destH / 2;
            flatCtx.translate(centerX, centerY);
            if (sig.rotation) {
              flatCtx.rotate((sig.rotation * Math.PI) / 180);
            }
            flatCtx.drawImage(img, -destW / 2, -destH / 2, destW, destH);
            flatCtx.restore();
            resolve();
          };
          img.onerror = () => reject(new Error('Failed to load signature image'));
          img.src = sig.imgSrc;
        });
      });

      await Promise.all(loadPromises);

      // Draw all text annotations in correct position
      placedTexts.forEach((txt) => {
        if (txt.page !== pageNumber) return;
        
        flatCtx.save();
        
        // Calculate font size relative to canvas height
        const scaleFactor = canvas.height / 600;
        const fontPx = Math.round(txt.fontSize * scaleFactor);
        
        flatCtx.font = `bold ${fontPx}px sans-serif`;
        flatCtx.fillStyle = txt.color;
        flatCtx.textBaseline = 'top';
        
        const destX = (txt.x / 100) * canvas.width;
        const destY = (txt.y / 100) * canvas.height;
        const destW = (txt.width / 100) * canvas.width;
        const destH = (txt.height / 100) * canvas.height;
        
        // Wrap text if needed
        const words = txt.text.split(' ');
        let line = '';
        const lines = [];
        
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const metrics = flatCtx.measureText(testLine);
          const testWidth = metrics.width;
          if (testWidth > destW && n > 0) {
            lines.push(line);
            line = words[n] + ' ';
          } else {
            line = testLine;
          }
        }
        lines.push(line);
        
        const lineHeight = fontPx * 1.2;
        lines.forEach((l, index) => {
          if (destY + (index * lineHeight) < destY + destH) {
            flatCtx.fillText(l.trim(), destX, destY + (index * lineHeight));
          }
        });
        
        flatCtx.restore();
      });

      // 3. Get the flattened base64 data URL
      const base64Data = flatCanvas.toDataURL('image/jpeg', 0.95);

      // Get all other pages' signatures
      const otherPagesSignatures = (doc.signatures || []).filter(
        (sig) => sig.page !== pageNumber
      );
      // Combine with active page's signatures (assigning active pageNumber to them!)
      const signaturesToSave = [
        ...otherPagesSignatures,
        ...placedSignatures.map((sig) => ({ ...sig, page: pageNumber }))
      ];

      // Save both to the backend
      const result = await window.electron.applyDocumentEdit(
        doc.id,
        base64Data,
        cleanBase64Data,
        signaturesToSave,
        pageNumber
      );

      if (result.success) {
        updateDocument(doc.id, result.data);
        toast.success('Document updated successfully');
        setIsEditing(false);
        setPlacedTexts([]);
        setSelectedTextId(null);
        setActiveFilter(null);
        const newTimestamp = Date.now();
        setTimestamp(newTimestamp);
        if (doc.type === 'PDF') {
          const renderResult = await window.electron.renderPdfPage(doc.id, pageNumber);
          if (renderResult.success) {
            setPreviewImagePath(renderResult.data);
          }
        } else {
          setPreviewImagePath(result.data.tempPath);
        }
        return true;
      } else {
        toast.error(result.error.message);
        return false;
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to save document edits');
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelSession = async () => {
    const confirmed = await useAppStore.getState().showConfirm(
      'Are you sure you want to cancel this session? All uploaded files will be discarded.',
      'Cancel Session'
    );
    if (!confirmed) return;

    await window.electron.clearTemp().catch(() => { });
    clearDocuments();
    toast.success('Session cancelled');
    setView(AppView.HOME);
  };

  // Drag / Resize corner point handlers
  const handleMouseDown = (e: React.MouseEvent, type: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Force canvasPan if Spacebar is held or Middle Click (button 1) is pressed
    const actualType = (isSpacePressed || e.button === 1) ? 'canvasPan' : type;

    setDragStart({ x: e.clientX, y: e.clientY });
    setDragType(actualType);

    if (['tl', 'tr', 'bl', 'br'].includes(actualType)) {
      const handle = actualType as keyof QuadCrop;
      setActiveHandle(handle);
      // Draw zoomed magnifier loupe immediately on mousedown
      setTimeout(() => {
        drawLoupe(cropBox[handle].x, cropBox[handle].y);
      }, 0);
    } else if (actualType === 'cropDraw') {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const startX = Math.max(0, Math.min(100, ((e.clientX - containerRect.left) / containerRect.width) * 100));
      const startY = Math.max(0, Math.min(100, ((e.clientY - containerRect.top) / containerRect.height) * 100));
      prevCropBeforeDrawRef.current = cropBox;
      setDrawCropStart({ x: startX, y: startY });
      setActiveHandle(null);
      drawLoupe(startX, startY);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart || !dragType || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const deltaX = ((e.clientX - dragStart.x) / containerRect.width) * 100;
    const deltaY = ((e.clientY - dragStart.y) / containerRect.height) * 100;

    if (dragType === 'canvasPan') {
      const deltaPxX = e.clientX - dragStart.x;
      const deltaPxY = e.clientY - dragStart.y;
      setPanPosition((prev) => ({
        x: prev.x + deltaPxX,
        y: prev.y + deltaPxY
      }));
    } else if (dragType.startsWith('sigMove-')) {
      const sigId = dragType.split('-')[1];
      setPlacedSignatures((prev) =>
        prev.map((sig) =>
          sig.id === sigId
            ? {
              ...sig,
              x: Math.max(-sig.width + 1, Math.min(100 - 1, sig.x + deltaX)),
              y: Math.max(-sig.height + 1, Math.min(100 - 1, sig.y + deltaY))
            }
            : sig
        )
      );
    } else if (dragType.startsWith('sigRotate-')) {
      const sigId = dragType.split('-')[1];
      const targetSig = placedSignatures.find((s) => s.id === sigId);
      if (targetSig) {
        const sigCenterX = containerRect.left + ((targetSig.x + targetSig.width / 2) / 100) * containerRect.width;
        const sigCenterY = containerRect.top + ((targetSig.y + targetSig.height / 2) / 100) * containerRect.height;
        const angleRad = Math.atan2(e.clientY - sigCenterY, e.clientX - sigCenterX);
        let angleDeg = Math.round((angleRad * 180) / Math.PI);
        if (angleDeg < 0) angleDeg += 360;
        setPlacedSignatures((prev) =>
          prev.map((sig) => (sig.id === sigId ? { ...sig, rotation: angleDeg } : sig))
        );
      }
    } else if (dragType.startsWith('sigResize-')) {
      const sigId = dragType.split('-')[1];
      setPlacedSignatures((prev) =>
        prev.map((sig) =>
          sig.id === sigId
            ? {
              ...sig,
              width: Math.max(2, sig.width + deltaX),
              height: Math.max(1, sig.height + deltaY)
            }
            : sig
        )
      );
    } else if (dragType.startsWith('textMove-')) {
      const textId = dragType.split('-')[1];
      setPlacedTexts((prev) =>
        prev.map((txt) =>
          txt.id === textId
            ? {
              ...txt,
              x: Math.max(-txt.width + 1, Math.min(100 - 1, txt.x + deltaX)),
              y: Math.max(-txt.height + 1, Math.min(100 - 1, txt.y + deltaY))
            }
            : txt
        )
      );
    } else if (dragType.startsWith('textResize-')) {
      const textId = dragType.split('-')[1];
      setPlacedTexts((prev) =>
        prev.map((txt) =>
          txt.id === textId
            ? {
              ...txt,
              width: Math.max(5, txt.width + deltaX),
              height: Math.max(2, txt.height + deltaY)
            }
            : txt
        )
      );
    } else if (['tl', 'tr', 'bl', 'br'].includes(dragType)) {
      const newX = Math.max(0, Math.min(100, ((e.clientX - containerRect.left) / containerRect.width) * 100));
      const newY = Math.max(0, Math.min(100, ((e.clientY - containerRect.top) / containerRect.height) * 100));

      setActiveHandle(dragType as keyof QuadCrop);
      setCropBox((prev) => {
        const updated = {
          ...prev,
          [dragType]: { x: newX, y: newY }
        };
        // Redraw loupe with new real-time coordinates
        drawLoupe(newX, newY);
        return updated;
      });
    } else if (dragType === 'cropDraw' && drawCropStart) {
      const currentX = Math.max(0, Math.min(100, ((e.clientX - containerRect.left) / containerRect.width) * 100));
      const currentY = Math.max(0, Math.min(100, ((e.clientY - containerRect.top) / containerRect.height) * 100));
      const minX = Math.min(drawCropStart.x, currentX);
      const maxX = Math.max(drawCropStart.x, currentX);
      const minY = Math.min(drawCropStart.y, currentY);
      const maxY = Math.max(drawCropStart.y, currentY);

      setCropBox({
        tl: { x: minX, y: minY },
        tr: { x: maxX, y: minY },
        bl: { x: minX, y: maxY },
        br: { x: maxX, y: maxY }
      });
      drawLoupe(currentX, currentY);
    } else if (dragType === 'cropMove') {
      setCropBox((prev) => {
        const minX = Math.min(prev.tl.x, prev.tr.x, prev.bl.x, prev.br.x);
        const maxX = Math.max(prev.tl.x, prev.tr.x, prev.bl.x, prev.br.x);
        const minY = Math.min(prev.tl.y, prev.tr.y, prev.bl.y, prev.br.y);
        const maxY = Math.max(prev.tl.y, prev.tr.y, prev.bl.y, prev.br.y);

        const boundedDeltaX = Math.max(-minX, Math.min(100 - maxX, deltaX));
        const boundedDeltaY = Math.max(-minY, Math.min(100 - maxY, deltaY));

        return {
          tl: { x: prev.tl.x + boundedDeltaX, y: prev.tl.y + boundedDeltaY },
          tr: { x: prev.tr.x + boundedDeltaX, y: prev.tr.y + boundedDeltaY },
          bl: { x: prev.bl.x + boundedDeltaX, y: prev.bl.y + boundedDeltaY },
          br: { x: prev.br.x + boundedDeltaX, y: prev.br.y + boundedDeltaY }
        };
      });
    } else if (['edge-top', 'edge-right', 'edge-bottom', 'edge-left'].includes(dragType)) {
      setCropBox((prev) => {
        const updated = { ...prev };
        if (dragType === 'edge-top') {
          const newY = Math.max(0, Math.min(Math.min(prev.bl.y, prev.br.y) - 1, prev.tl.y + deltaY));
          updated.tl = { x: prev.tl.x, y: newY };
          updated.tr = { x: prev.tr.x, y: newY };
        } else if (dragType === 'edge-right') {
          const newX = Math.min(100, Math.max(Math.max(prev.tl.x, prev.bl.x) + 1, prev.tr.x + deltaX));
          updated.tr = { x: newX, y: prev.tr.y };
          updated.br = { x: newX, y: prev.br.y };
        } else if (dragType === 'edge-bottom') {
          const newY = Math.min(100, Math.max(Math.max(prev.tl.y, prev.tr.y) + 1, prev.bl.y + deltaY));
          updated.bl = { x: prev.bl.x, y: newY };
          updated.br = { x: prev.br.x, y: newY };
        } else if (dragType === 'edge-left') {
          const newX = Math.max(0, Math.min(Math.min(prev.tr.x, prev.br.x) - 1, prev.tl.x + deltaX));
          updated.tl = { x: newX, y: prev.tl.y };
          updated.bl = { x: newX, y: prev.bl.y };
        }
        return updated;
      });
    }

    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    if (dragType === 'cropDraw') {
      setCropBox((prev) => {
        const w = Math.abs(prev.tr.x - prev.tl.x);
        const h = Math.abs(prev.bl.y - prev.tl.y);
        // If the drawn rectangle is tiny (accidental click), restore previous
        if (w < 2 || h < 2) {
          return prevCropBeforeDrawRef.current;
        }
        return prev;
      });
      setDrawCropStart(null);
      setActiveHandle('br');
    }
    setDragStart(null);
    setDragType(null);
  };

  const handleBack = () => {
    if (isEditing) {
      handleDiscardEdit();
    } else {
      setView(previewBackView || AppView.DOCUMENT_LIST);
    }
  };

  const handlePrint = async () => {
    if (!doc) return;
    setIsPrinting(true);
    try {
      const result = await window.electron.printDocument(doc.id);
      if (!result.success) {
        toast.error(result.error.message);
      } else {
        toast.success('Document print job submitted');
      }
    } catch (error) {
      toast.error('Print failed');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleContinue = async () => {
    if (isEditing) {
      const saved = await handleSaveEdit();
      if (!saved) return;
    }
    setView(AppView.OUTPUT_OPTIONS);
  };

  const renderPageOrganizer = () => {
    if (!doc || doc.type !== 'PDF') return null;

    const pages = Array.from({ length: doc.pageCount }, (_, i) => i + 1);

    return (
      <div className="w-full h-full flex flex-col overflow-hidden animate-fade-in p-2 select-none">
        <div className="flex items-center justify-between mb-4 border-b border-border pb-3 flex-shrink-0">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Visual Page Organizer</h2>
            <p className="text-xs text-text-secondary">Drag cards to reorder pages. Rotate 90° clockwise/counter-clockwise, or delete pages.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setIsOrganizing(false)}>
            Close Organizer
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={pages}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 p-1">
                {pages.map((p) => {
                  const thumbPath = pageThumbnails[p];
                  return (
                    <SortableGridItem
                      key={p}
                      id={p}
                      pageNumber={p}
                      thumbPath={thumbPath}
                      timestamp={timestamp}
                      isProcessing={isProcessing}
                      onRotate={(dir) => handleRotatePageAt(p, dir)}
                      onDelete={() => handleDeletePageAt(p)}
                      onClick={() => {
                        setPageNumber(p);
                        setIsOrganizing(false);
                      }}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    );
  };

  const renderSignatureModal = () => {
    if (!isSignatureModalOpen) return null;

    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in select-none">
        <div className="bg-bg-surface w-full max-w-xl rounded-xl flex flex-col overflow-hidden shadow-2xl border border-border">
          {/* Header */}
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="font-bold text-text-primary text-base">Create New Signature</h3>
              <p className="text-xs text-text-secondary mt-0.5">Design a signature or initials to use across documents.</p>
            </div>
            <button
              onClick={() => setIsSignatureModalOpen(false)}
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-5 max-h-[75vh]">
            {/* Mode Tabs */}
            <div className="flex border border-border bg-bg-sunken p-1.5 rounded-lg">
              <button
                type="button"
                onClick={() => setSignatureMode('draw')}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-fast ${signatureMode === 'draw' ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Draw Signature
              </button>
              <button
                type="button"
                onClick={() => setSignatureMode('type')}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-fast ${signatureMode === 'type' ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Type Signature
              </button>
              <button
                type="button"
                onClick={() => setSignatureMode('upload')}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-fast ${signatureMode === 'upload' ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Upload PNG File
              </button>
            </div>

            {/* DRAW TAB */}
            {signatureMode === 'draw' && (
              <div className="flex flex-col gap-4 animate-fade-in">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Draw on Pad</span>
                <div className="relative border border-border bg-white rounded-xl shadow-inner overflow-hidden flex items-center justify-center p-2">
                  <canvas
                    ref={sigCanvasRef}
                    width={480}
                    height={160}
                    className="signature-pad-canvas touch-none bg-white max-w-full"
                    onMouseDown={startSigDrawing}
                    onMouseMove={drawSigLine}
                    onMouseUp={endSigDrawing}
                    onMouseLeave={endSigDrawing}
                    onTouchStart={startSigDrawingTouch}
                    onTouchMove={drawSigLineTouch}
                    onTouchEnd={endSigDrawing}
                  />
                </div>
                <div className="flex gap-3 justify-end">
                  <Button variant="ghost" onClick={clearSigPad} className="px-5">
                    Clear Canvas
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      handleAddSignature();
                      setIsSignatureModalOpen(false);
                    }}
                    className="px-6"
                  >
                    Save & Place Signature
                  </Button>
                </div>
              </div>
            )}

            {/* TYPE TAB */}
            {signatureMode === 'type' && (
              <div className="flex flex-col gap-5 animate-fade-in">
                <div className="flex gap-4">
                  <div className="flex-1 min-w-0">
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">Full Name</label>
                    <input
                      type="text"
                      value={sigTypeName}
                      onChange={(e) => {
                        setSigTypeName(e.target.value);
                        if (e.target.value && !sigTypeInitials) {
                          setSigTypeInitials(e.target.value.charAt(0).toUpperCase());
                        }
                      }}
                      placeholder="Type your name..."
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg-surface text-text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div className="w-28 flex-shrink-0">
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">Initials</label>
                    <input
                      type="text"
                      value={sigTypeInitials}
                      onChange={(e) => setSigTypeInitials(e.target.value.toUpperCase())}
                      placeholder="Initials"
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg-surface text-text-primary text-center focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Signature Preview */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">Signature Preview</span>
                    <div className="border border-border rounded-xl bg-bg-sunken p-4 flex flex-col justify-center items-center h-24 shadow-inner relative overflow-hidden select-none bg-white">
                      {sigTypeName ? (
                        <span
                          className="text-text-primary truncate max-w-full text-center"
                          style={{ fontFamily: `"${SIGNATURE_FONTS[sigTypeFontIndex]}", cursive`, fontSize: '28px' }}
                        >
                          {sigTypeName}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted italic">Signature Preview</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsChangingSigStyle(true)}
                      className="text-[11px] text-accent hover:underline font-semibold block text-center w-full"
                    >
                      Change Cursive Font Style
                    </button>
                  </div>

                  {/* Initials Preview */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">Initials Preview</span>
                    <div className="border border-border rounded-xl bg-bg-sunken p-4 flex flex-col justify-center items-center h-24 shadow-inner relative overflow-hidden select-none bg-white">
                      {sigTypeInitials ? (
                        <span
                          className="text-text-primary truncate max-w-full text-center"
                          style={{ fontFamily: `"${SIGNATURE_FONTS[sigInitialsFontIndex]}", cursive`, fontSize: '28px' }}
                        >
                          {sigTypeInitials}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted italic">Initials Preview</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsChangingInitialsStyle(true)}
                      className="text-[11px] text-accent hover:underline font-semibold block text-center w-full"
                    >
                      Change Initials Font Style
                    </button>
                  </div>
                </div>

                {isChangingSigStyle && (
                  <div className="border border-border rounded-xl p-4 space-y-3 bg-bg-sunken animate-slide-in max-h-[220px] overflow-y-auto">
                    <span className="text-xs font-semibold text-text-primary block">Select Cursive Style for Name</span>
                    <div className="grid grid-cols-2 gap-2">
                      {SIGNATURE_FONTS.map((font, idx) => (
                        <button
                          key={font}
                          type="button"
                          onClick={() => {
                            setSigTypeFontIndex(idx);
                            setIsChangingSigStyle(false);
                          }}
                          className={`p-3 border rounded-lg bg-white text-center hover:border-accent hover:bg-accent-light/10 transition-all ${sigTypeFontIndex === idx ? 'border-accent ring-2 ring-accent/20 font-bold' : 'border-border'}`}
                          style={{ fontFamily: `"${font}", cursive`, fontSize: '20px' }}
                        >
                          {sigTypeName || 'Signature'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isChangingInitialsStyle && (
                  <div className="border border-border rounded-xl p-4 space-y-3 bg-bg-sunken animate-slide-in max-h-[220px] overflow-y-auto">
                    <span className="text-xs font-semibold text-text-primary block">Select Cursive Style for Initials</span>
                    <div className="grid grid-cols-2 gap-2">
                      {SIGNATURE_FONTS.map((font, idx) => (
                        <button
                          key={font}
                          type="button"
                          onClick={() => {
                            setSigInitialsFontIndex(idx);
                            setIsChangingInitialsStyle(false);
                          }}
                          className={`p-3 border rounded-lg bg-white text-center hover:border-accent hover:bg-accent-light/10 transition-all ${sigInitialsFontIndex === idx ? 'border-accent ring-2 ring-accent/20' : 'border-border'}`}
                          style={{ fontFamily: `"${font}", cursive`, fontSize: '20px' }}
                        >
                          {sigTypeInitials || 'Initials'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 justify-end border-t border-border pt-4">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      handleAddTypedInitials();
                      setIsSignatureModalOpen(false);
                    }}
                    disabled={!sigTypeInitials.trim()}
                  >
                    Add Initials only
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      handleAddTypedSignature();
                      setIsSignatureModalOpen(false);
                    }}
                    disabled={!sigTypeName.trim()}
                  >
                    Add Signature & Initials
                  </Button>
                </div>
              </div>
            )}

            {/* UPLOAD TAB - 3 STEP GUIDED WIZARD */}
            {signatureMode === 'upload' && (
              <div className="flex flex-col gap-4 animate-fade-in">
                {/* Step Indicator */}
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                    <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-mono ${uploadStep === 'select' ? 'bg-accent text-white' : 'bg-accent/20 text-accent'}`}>1</span>
                    Select Image
                  </span>
                  <span className="text-text-muted text-xs">→</span>
                  <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                    <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-mono ${uploadStep === 'crop' ? 'bg-accent text-white' : 'bg-accent/20 text-accent'}`}>2</span>
                    Crop 140×60 Area
                  </span>
                  <span className="text-text-muted text-xs">→</span>
                  <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                    <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-mono ${uploadStep === 'preview' ? 'bg-accent text-white' : 'bg-accent/20 text-accent'}`}>3</span>
                    Preview & Transparent PNG
                  </span>
                </div>

                {uploadStep === 'select' && (
                  <div className="flex flex-col gap-4">
                    <div className="p-3 bg-bg-sunken border border-border rounded-xl text-xs text-text-secondary space-y-1">
                      <p className="font-semibold text-accent flex items-center gap-1.5">
                        <AlertCircle size={14} /> Upload Guidelines:
                      </p>
                      <ul className="list-disc pl-5 space-y-0.5 leading-relaxed text-[11px]">
                        <li>Take a clear photo/scan of your signature on white paper.</li>
                        <li>Supports PNG, JPG, JPEG, and WebP images.</li>
                      </ul>
                    </div>

                    <div className="relative">
                      <input
                        type="file"
                        accept="image/png, image/jpeg, image/jpg, image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const dataUrl = ev.target?.result as string;
                            setUploadRawImg(dataUrl);
                            setSigCropBox({
                              x: 15,
                              y: 25,
                              width: 70,
                              height: 30
                            });
                            setUploadStep('crop');
                          };
                          reader.readAsDataURL(file);
                        }}
                        className="hidden"
                        id="sig-modal-file-upload"
                      />
                      <label
                        htmlFor="sig-modal-file-upload"
                        className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border hover:border-accent hover:bg-accent-light/5 rounded-xl p-8 cursor-pointer text-sm font-medium text-text-secondary hover:text-accent transition-all duration-normal"
                      >
                        <Upload size={24} className="mb-1" />
                        <span className="font-semibold text-text-primary">Click to select signature image</span>
                        <span className="text-xs text-text-muted">PNG, JPG, WebP up to 5MB</span>
                      </label>
                    </div>
                  </div>
                )}

                {uploadStep === 'crop' && uploadRawImg && (
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-text-primary">Step 1: Crop Signature (140×60 Proportional Box)</span>
                      <span className="text-text-muted text-[11px]">Drag handles to scale proportionally</span>
                    </div>

                    <div
                      ref={sigCropContainerRef}
                      className="relative w-full h-[260px] bg-black/80 rounded-xl overflow-hidden flex items-center justify-center select-none"
                      onMouseMove={(e) => handleSigCropMouseMove(e)}
                      onMouseUp={() => { setDragStart(null); setDragType(null); }}
                    >
                      <img
                        src={uploadRawImg}
                        alt="Raw signature upload"
                        className="max-w-full max-h-full object-contain pointer-events-none"
                      />

                      {/* Proportional 140x60 Selection Box Overlay */}
                      <div
                        className="absolute border-2 border-accent bg-accent/20 cursor-grab active:cursor-grabbing shadow-lg"
                        style={{
                          left: `${sigCropBox.x}%`,
                          top: `${sigCropBox.y}%`,
                          width: `${sigCropBox.width}%`,
                          height: `${sigCropBox.height}%`
                        }}
                        onMouseDown={(e) => handleMouseDown(e, 'sigUploadCrop-move')}
                      >
                        <span className="absolute top-1 left-1 bg-accent text-white text-[9px] font-mono px-1 rounded shadow pointer-events-none">
                          140×60 Ratio
                        </span>

                        {/* Proportional Corner Handles */}
                        <div
                          className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-accent border-2 border-white rounded-full cursor-nwse-resize hover:scale-125"
                          onMouseDown={(e) => handleMouseDown(e, 'sigUploadCrop-tl')}
                        />
                        <div
                          className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-accent border-2 border-white rounded-full cursor-nesw-resize hover:scale-125"
                          onMouseDown={(e) => handleMouseDown(e, 'sigUploadCrop-tr')}
                        />
                        <div
                          className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-accent border-2 border-white rounded-full cursor-nesw-resize hover:scale-125"
                          onMouseDown={(e) => handleMouseDown(e, 'sigUploadCrop-bl')}
                        />
                        <div
                          className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-accent border-2 border-white rounded-full cursor-nwse-resize hover:scale-125"
                          onMouseDown={(e) => handleMouseDown(e, 'sigUploadCrop-br')}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between gap-3 pt-2">
                      <Button
                        variant="secondary"
                        onClick={() => { setUploadStep('select'); setUploadRawImg(null); }}
                      >
                        Change Image
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleConfirmSigCrop}
                      >
                        Continue to Preview →
                      </Button>
                    </div>
                  </div>
                )}

                {uploadStep === 'preview' && croppedSigDataUrl && (
                  <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-text-primary">Step 2: Preview Cropped Section</span>
                      <span className="text-text-muted text-[11px]">Ready for background removal</span>
                    </div>

                    <div className="p-4 border border-border rounded-xl bg-white flex flex-col items-center justify-center min-h-[140px] shadow-inner">
                      <img
                        src={croppedSigDataUrl}
                        alt="Cropped signature preview"
                        className="max-h-[100px] object-contain rounded shadow"
                      />
                    </div>

                    <div className="flex justify-between gap-3 pt-2">
                      <Button
                        variant="secondary"
                        onClick={() => setUploadStep('crop')}
                      >
                        ← Back to Crop
                      </Button>
                      <Button
                        variant="primary"
                        onClick={handleFinalizeUploadSignature}
                        disabled={isProcessing}
                      >
                        {isProcessing ? 'Removing Background...' : 'Continue & Remove Background ✓'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!doc) {
    return (
      <div className="h-full flex flex-col items-center justify-center animate-fade-in bg-bg-base">
        <div className="text-center p-8 bg-bg-surface border border-border rounded-xl shadow-md max-w-sm">
          <h2 className="text-lg font-semibold text-text-primary mb-2">No document selected</h2>
          <p className="text-sm text-text-secondary mb-6">We could not find the preview document.</p>
          <Button variant="primary" onClick={handleBack} className="w-full justify-center">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col animate-fade-in bg-bg-base overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Header */}
      <div className="border-b border-border bg-bg-surface backdrop-blur-md shadow-sm z-10">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <Button variant="ghost" size="sm" onClick={handleBack} disabled={isProcessing || isPrinting}>
              <ArrowLeft size={16} />
              Back
            </Button>
            <Button variant="secondary" size="sm" className="text-error hover:bg-error-light hover:border-error" onClick={handleCancelSession} disabled={isProcessing || isPrinting}>
              <XCircle size={16} />
              Cancel Session
            </Button>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-text-primary truncate" title={doc.filename}>
                {isEditing ? `Editing: ${doc.filename}` : `Previewing: ${doc.filename}`}
              </h1>
              <p className="text-xs text-text-muted font-mono mt-0.5">
                Type: {doc.type} • Pages: {doc.pageCount}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                {doc.type === 'PDF' && (
                  <div className="relative">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowAddPageMenu(!showAddPageMenu)}
                      disabled={isProcessing || isPrinting}
                    >
                      <Plus size={16} className="mr-1.5" />
                      Add Page
                    </Button>
                    {showAddPageMenu && (
                      <>
                        <div 
                          className="fixed inset-0 z-10" 
                          onClick={() => setShowAddPageMenu(false)}
                        />
                        <div className="absolute right-0 mt-1.5 w-48 bg-bg-surface border border-border rounded-lg shadow-lg py-1 z-20 animate-fade-in">
                          <button
                            onClick={handleAddBlankPage}
                            className="w-full text-left px-4 py-2.5 text-xs font-semibold hover:bg-bg-sunken text-text-primary flex items-center gap-2 transition-fast"
                          >
                            <FilePlus size={14} className="text-accent" />
                            Insert Blank Page
                          </button>
                          <button
                            onClick={handleAddPageFromFile}
                            className="w-full text-left px-4 py-2.5 text-xs font-semibold hover:bg-bg-sunken text-text-primary flex items-center gap-2 transition-fast"
                          >
                            <Upload size={14} className="text-accent" />
                            Insert Page from File
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {doc.type === 'PDF' && doc.pageCount > 1 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-error hover:bg-error-light hover:border-error"
                    onClick={handleDeletePage}
                    disabled={isProcessing || isPrinting}
                  >
                    <Trash2 size={16} className="mr-1.5" />
                    Delete Page
                  </Button>
                )}
                {doc.type === 'PDF' && doc.pageCount > 1 && (
                  <Button
                    variant={isOrganizing ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setIsOrganizing(!isOrganizing)}
                    disabled={isProcessing || isPrinting}
                  >
                    <Layout size={16} className="mr-1.5" />
                    {isOrganizing ? 'Single Page' : 'Organize Pages'}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setActiveTab(EditTab.CROP);
                    setIsEditing(true);
                  }}
                  disabled={isProcessing || isPrinting}
                >
                  <Crop size={16} className="mr-1.5" />
                  {doc.type === 'PDF' ? 'Edit Page' : 'Edit Document'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePrint}
                  disabled={isProcessing || isPrinting}
                >
                  <Printer size={16} className="mr-1.5" />
                  {isPrinting ? 'Printing...' : 'Print'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleContinue}
                  disabled={isProcessing || isPrinting}
                >
                  <Check size={16} className="mr-1.5" />
                  Continue
                </Button>
              </>
            ) : (
              <span className="text-xs text-text-muted italic bg-bg-sunken px-2.5 py-1 rounded">
                Editing Mode Active
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Pages list (only for PDF files, when not editing) */}
        {!isEditing && !isOrganizing && doc && doc.type === 'PDF' && (
          <div className="w-48 border-r border-border bg-bg-surface flex flex-col h-full select-none animate-slide-in">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">Pages</span>
              <span className="text-[10px] font-medium bg-bg-sunken px-2 py-0.5 rounded text-text-secondary">
                Total: {doc.pageCount}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={Array.from({ length: doc.pageCount }, (_, i) => i + 1)}
                  strategy={verticalListSortingStrategy}
                >
                  {Array.from({ length: doc.pageCount }, (_, i) => i + 1).map((p) => {
                    const isSelected = pageNumber === p;
                    const thumbPath = pageThumbnails[p];
                    return (
                      <SortablePageItem
                        key={p}
                        id={p}
                        pageNumber={p}
                        isSelected={isSelected}
                        thumbPath={thumbPath}
                        timestamp={timestamp}
                        isProcessing={isProcessing}
                        onClick={() => setPageNumber(p)}
                      />
                    );
                  })}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        )}

        {/* Center/Viewer Side: Viewer or Editor Canvas */}
        <div className="flex-1 p-2 flex flex-col justify-between items-center overflow-hidden gap-2">
          <div className="w-full flex-1 bg-bg-surface border border-border rounded-lg shadow-md overflow-hidden relative flex justify-center items-center p-1">
            {!isEditing ? (
              isOrganizing ? (
                renderPageOrganizer()
              ) : isProcessing ? (
                <div className="text-center p-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto mb-2"></div>
                  <p className="text-xs text-text-secondary">Generating preview...</p>
                </div>
              ) : previewImagePath ? (
                <div className="w-full h-full flex justify-center items-center overflow-auto animate-fade-in">
                  <img
                    src={`docuflow:///${previewImagePath.replace(/\\/g, '/')}?t=${timestamp}`}
                    alt={doc.filename}
                    className="max-w-full max-h-full rounded shadow-sm object-contain select-none bg-white p-1"
                  />
                </div>
              ) : (
                <p className="text-sm text-text-secondary">Preview not available</p>
              )
            ) : (
              // Active Editor Workspace
              <div
                ref={workspaceRef}
                className={`relative w-full h-full flex items-center justify-center border border-border bg-bg-sunken p-1 rounded-lg overflow-hidden ${(zoomScale > 1.0 || isSpacePressed) ? (dragType === 'canvasPan' ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
                onMouseDown={(e) => {
                  if (isSpacePressed || e.button === 1 || zoomScale > 1.0) {
                    handleMouseDown(e, 'canvasPan');
                  }
                }}
              >
                {/* Floating Zoom Controls Badge */}
                <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 bg-bg-surface/90 backdrop-blur-md border border-border px-2.5 py-1 rounded-full shadow-md text-xs font-semibold text-text-primary select-none">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(0.5, parseFloat((zoomScale - 0.2).toFixed(2)));
                      setZoomScale(next);
                      if (next === 1.0) setPanPosition({ x: 0, y: 0 });
                    }}
                    className="p-0.5 rounded hover:bg-bg-sunken text-text-secondary hover:text-text-primary transition-colors"
                    title="Zoom Out (Ctrl + Scroll Down)"
                  >
                    <ZoomOut size={14} />
                  </button>
                  <span className="font-mono text-[11px] min-w-[36px] text-center">
                    {Math.round(zoomScale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomScale((prev) => Math.min(4.0, parseFloat((prev + 0.2).toFixed(2))))}
                    className="p-0.5 rounded hover:bg-bg-sunken text-text-secondary hover:text-text-primary transition-colors"
                    title="Zoom In (Ctrl + Scroll Up)"
                  >
                    <ZoomIn size={14} />
                  </button>
                  {(panPosition.x !== 0 || panPosition.y !== 0) && (
                    <button
                      type="button"
                      onClick={() => setPanPosition({ x: 0, y: 0 })}
                      className="ml-1 text-[10px] text-accent hover:underline font-medium"
                      title="Center Image View"
                    >
                      Center
                    </button>
                  )}
                  {(zoomScale !== 1.0 || panPosition.x !== 0 || panPosition.y !== 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setZoomScale(1.0);
                        setPanPosition({ x: 0, y: 0 });
                      }}
                      className="ml-1 text-[10px] text-accent hover:underline font-medium"
                      title="Reset Zoom to 100%"
                    >
                      Reset
                    </button>
                  )}
                </div>

                <div
                  ref={containerRef}
                  className="relative select-none transition-transform duration-75 flex items-center justify-center shrink-0"
                  style={{
                    width: displayDimensions ? `${displayDimensions.width}px` : undefined,
                    height: displayDimensions ? `${displayDimensions.height}px` : undefined,
                    maxWidth: '100%',
                    maxHeight: '100%',
                    aspectRatio: displayDimensions
                      ? undefined
                      : (canvasDimensions.width || canvasRef.current?.width || 0) > 0 &&
                        (canvasDimensions.height || canvasRef.current?.height || 0) > 0
                        ? `${canvasDimensions.width || canvasRef.current?.width} / ${canvasDimensions.height || canvasRef.current?.height}`
                        : undefined,
                    transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoomScale})`,
                    transformOrigin: 'center center'
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    className={`block rounded shadow-md bg-white ${(zoomScale > 1.0 || isSpacePressed) ? (dragType === 'canvasPan' ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'block'
                    }}
                    onMouseDown={(e) => {
                      if (isSpacePressed || e.button === 1 || zoomScale > 1.0) {
                        handleMouseDown(e, 'canvasPan');
                      }
                    }}
                  />

                  {/* Perspective Crop Handles */}
                  {activeTab === EditTab.CROP && (
                    <div className="absolute inset-0 w-full h-full">
                      {/* SVG Connector lines and free-form crop draw overlay */}
                      <svg
                        className="absolute inset-0 w-full h-full z-10"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        style={{ pointerEvents: 'auto', cursor: isSpacePressed ? 'grab' : 'crosshair' }}
                        onMouseDown={(e) => {
                          if (isSpacePressed || e.button === 1 || zoomScale > 1.0) {
                            handleMouseDown(e, 'canvasPan');
                          } else {
                            handleMouseDown(e, 'cropDraw');
                          }
                        }}
                      >
                        <polygon
                          points={`${cropBox.tl.x},${cropBox.tl.y} ${cropBox.tr.x},${cropBox.tr.y} ${cropBox.br.x},${cropBox.br.y} ${cropBox.bl.x},${cropBox.bl.y}`}
                          className={`stroke-accent stroke-[0.4] fill-accent/15 hover:fill-accent/30 transition-colors duration-normal ${dragType === 'cropMove' ? 'cursor-grabbing' : 'cursor-grab'}`}
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleMouseDown(e, 'cropMove');
                          }}
                        />
                        {/* Top Edge (tl to tr) - Vertical Movement */}
                        <line
                          x1={cropBox.tl.x}
                          y1={cropBox.tl.y}
                          x2={cropBox.tr.x}
                          y2={cropBox.tr.y}
                          className="stroke-accent/0 hover:stroke-accent/40 cursor-ns-resize transition-colors duration-normal"
                          strokeWidth="3"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleMouseDown(e, 'edge-top');
                          }}
                        />
                        {/* Right Edge (tr to br) - Horizontal Movement */}
                        <line
                          x1={cropBox.tr.x}
                          y1={cropBox.tr.y}
                          x2={cropBox.br.x}
                          y2={cropBox.br.y}
                          className="stroke-accent/0 hover:stroke-accent/40 cursor-ew-resize transition-colors duration-normal"
                          strokeWidth="3"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleMouseDown(e, 'edge-right');
                          }}
                        />
                        {/* Bottom Edge (bl to br) - Vertical Movement */}
                        <line
                          x1={cropBox.bl.x}
                          y1={cropBox.bl.y}
                          x2={cropBox.br.x}
                          y2={cropBox.br.y}
                          className="stroke-accent/0 hover:stroke-accent/40 cursor-ns-resize transition-colors duration-normal"
                          strokeWidth="3"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleMouseDown(e, 'edge-bottom');
                          }}
                        />
                        {/* Left Edge (tl to bl) - Horizontal Movement */}
                        <line
                          x1={cropBox.tl.x}
                          y1={cropBox.tl.y}
                          x2={cropBox.bl.x}
                          y2={cropBox.bl.y}
                          className="stroke-accent/0 hover:stroke-accent/40 cursor-ew-resize transition-colors duration-normal"
                          strokeWidth="3"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleMouseDown(e, 'edge-left');
                          }}
                        />
                      </svg>

                      {/* Draggable Corner Handles */}
                      <div
                        className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${cropBox.tl.x}%`, top: `${cropBox.tl.y}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, 'tl');
                        }}
                        onMouseEnter={() => {
                          if (!dragType) {
                            setActiveHandle('tl');
                            drawLoupe(cropBox.tl.x, cropBox.tl.y);
                          }
                        }}
                        title="Top-Left Corner"
                      />
                      <div
                        className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${cropBox.tr.x}%`, top: `${cropBox.tr.y}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, 'tr');
                        }}
                        onMouseEnter={() => {
                          if (!dragType) {
                            setActiveHandle('tr');
                            drawLoupe(cropBox.tr.x, cropBox.tr.y);
                          }
                        }}
                        title="Top-Right Corner"
                      />
                      <div
                        className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${cropBox.bl.x}%`, top: `${cropBox.bl.y}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, 'bl');
                        }}
                        onMouseEnter={() => {
                          if (!dragType) {
                            setActiveHandle('bl');
                            drawLoupe(cropBox.bl.x, cropBox.bl.y);
                          }
                        }}
                        title="Bottom-Left Corner"
                      />
                      <div
                        className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${cropBox.br.x}%`, top: `${cropBox.br.y}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, 'br');
                        }}
                        onMouseEnter={() => {
                          if (!dragType) {
                            setActiveHandle('br');
                            drawLoupe(cropBox.br.x, cropBox.br.y);
                          }
                        }}
                        title="Bottom-Right Corner"
                      />

                      {/* Draggable Middle Edge Handles */}
                      <div
                        className="absolute w-4 h-4 bg-white border-2 border-accent rounded-full cursor-ns-resize -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${(cropBox.tl.x + cropBox.tr.x) / 2}%`, top: `${(cropBox.tl.y + cropBox.tr.y) / 2}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, 'edge-top');
                        }}
                        title="Drag Top Edge (Vertical Only)"
                      />
                      <div
                        className="absolute w-4 h-4 bg-white border-2 border-accent rounded-full cursor-ew-resize -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${(cropBox.tr.x + cropBox.br.x) / 2}%`, top: `${(cropBox.tr.y + cropBox.br.y) / 2}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, 'edge-right');
                        }}
                        title="Drag Right Edge (Horizontal Only)"
                      />
                      <div
                        className="absolute w-4 h-4 bg-white border-2 border-accent rounded-full cursor-ns-resize -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${(cropBox.bl.x + cropBox.br.x) / 2}%`, top: `${(cropBox.bl.y + cropBox.br.y) / 2}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, 'edge-bottom');
                        }}
                        title="Drag Bottom Edge (Vertical Only)"
                      />
                      <div
                        className="absolute w-4 h-4 bg-white border-2 border-accent rounded-full cursor-ew-resize -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${(cropBox.tl.x + cropBox.bl.x) / 2}%`, top: `${(cropBox.tl.y + cropBox.bl.y) / 2}%` }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, 'edge-left');
                        }}
                        title="Drag Left Edge (Horizontal Only)"
                      />
                    </div>
                  )}

                  {/* Active Placed Signatures Overlays */}
                  {activeTab === EditTab.SIGNATURE && placedSignatures.map((sig) => (
                    <div
                      key={sig.id}
                      className={`absolute border border-dashed border-accent bg-accent/5 z-10 ${dragType === `sigMove-${sig.id}` ? 'cursor-grabbing' : 'cursor-grab'}`}
                      style={{
                        left: `${sig.x}%`,
                        top: `${sig.y}%`,
                        width: `${sig.width}%`,
                        height: `${sig.height}%`,
                        transform: `rotate(${sig.rotation || 0}deg)`,
                        transformOrigin: 'center center'
                      }}
                      onMouseDown={(e) => handleMouseDown(e, `sigMove-${sig.id}`)}
                    >
                      <img
                        src={sig.imgSrc}
                        alt="Placed signature"
                        className="w-full h-full object-contain pointer-events-none"
                      />
                      {/* Rotate Handle & Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPlacedSignatures((prev) =>
                            prev.map((s) => (s.id === sig.id ? { ...s, rotation: ((s.rotation || 0) + 15) % 360 } : s))
                          );
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, `sigRotate-${sig.id}`);
                        }}
                        className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white text-accent border border-accent hover:bg-accent hover:text-white rounded-full p-1 shadow z-20 transition-colors cursor-grab"
                        title="Click to rotate +15° or Drag to rotate"
                      >
                        <RotateCw size={11} />
                      </button>
                      {/* Delete signature item */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPlacedSignatures((prev) => prev.filter((s) => s.id !== sig.id));
                        }}
                        className="absolute -top-2 -right-2 bg-error text-white rounded-full p-0.5 hover:bg-error-dark shadow z-20"
                        title="Remove Signature"
                      >
                        <X size={12} />
                      </button>
                      {/* Resize handle */}
                      <div
                        className="absolute -bottom-1 -right-1 w-3 h-3 bg-accent border border-white cursor-se-resize z-20"
                        onMouseDown={(e) => handleMouseDown(e, `sigResize-${sig.id}`)}
                      />
                    </div>
                  ))}
                  {/* Active Placed Text Overlays */}
                  {activeTab === EditTab.SIGNATURE && placedTexts.map((txt) => (
                    <div
                      key={txt.id}
                      className={`absolute border border-dashed z-10 p-1 flex items-center justify-center ${dragType === `textMove-${txt.id}` ? 'cursor-grabbing' : 'cursor-grab'} ${selectedTextId === txt.id ? 'border-accent bg-accent/5 ring-2 ring-accent/15' : 'border-text-secondary bg-bg-surface/30'}`}
                      style={{
                        left: `${txt.x}%`,
                        top: `${txt.y}%`,
                        width: `${txt.width}%`,
                        height: `${txt.height}%`,
                      }}
                      onMouseDown={(e) => {
                        setSelectedTextId(txt.id);
                        handleMouseDown(e, `textMove-${txt.id}`);
                      }}
                    >
                      {selectedTextId === txt.id ? (
                        <textarea
                          value={txt.text}
                          onChange={(e) => {
                            const newTextValue = e.target.value;
                            setPlacedTexts((prev) =>
                              prev.map((t) => (t.id === txt.id ? { ...t, text: newTextValue } : t))
                            );
                          }}
                          className="w-full h-full bg-transparent border-none outline-none font-semibold resize-none text-center leading-normal"
                          style={{
                            fontSize: `${txt.fontSize}px`,
                            color: txt.color,
                          }}
                          placeholder="Type text..."
                          autoFocus
                          onMouseDown={(e) => e.stopPropagation()} // Prevent dragging when typing
                        />
                      ) : (
                        <span
                          className="w-full h-full text-center overflow-hidden break-words font-semibold pointer-events-none"
                          style={{
                            fontSize: `${txt.fontSize}px`,
                            color: txt.color,
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                          }}
                        >
                          {txt.text || 'Double click to edit'}
                        </span>
                      )}

                      {/* Delete text item */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPlacedTexts((prev) => prev.filter((t) => t.id !== txt.id));
                          if (selectedTextId === txt.id) setSelectedTextId(null);
                        }}
                        className="absolute -top-2 -right-2 bg-error text-white rounded-full p-0.5 hover:bg-error-dark shadow z-20"
                        title="Remove Text"
                      >
                        <X size={12} />
                      </button>

                      {/* Resize handle */}
                      <div
                        className="absolute -bottom-1 -right-1 w-3 h-3 bg-accent border border-white cursor-se-resize z-20"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, `textResize-${txt.id}`);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Page Navigation controls (only for PDF files with pageCount > 1) */}
          {!isEditing && !isOrganizing && doc && doc.type === 'PDF' && doc.pageCount > 1 && (
            <div className="flex items-center gap-4 bg-bg-surface border border-border px-4 py-2 rounded-full shadow-sm select-none">
              <Button
                variant="ghost"
                size="sm"
                className="p-1 min-w-[32px] h-8 rounded-full flex items-center justify-center"
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                disabled={pageNumber === 1 || isProcessing}
              >
                <ChevronLeft size={18} />
              </Button>
              <span className="text-xs font-semibold text-text-primary">
                Page {pageNumber} of {doc.pageCount}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="p-1 min-w-[32px] h-8 rounded-full flex items-center justify-center"
                onClick={() => setPageNumber((p) => Math.min(doc.pageCount, p + 1))}
                disabled={pageNumber === doc.pageCount || isProcessing}
              >
                <ChevronRight size={18} />
              </Button>
            </div>
          )}
        </div>

        {/* Right Side: Tool control panel (Only visible when editing) */}
        {isEditing && (
          <div className="w-80 border-l border-border bg-bg-surface px-4 py-3 flex flex-col gap-2.5 select-none z-10 animate-slide-in h-full overflow-hidden">
            {/* Header with Title and Close Button */}
            <div className="flex items-center justify-between pb-1 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <Crop size={14} className="text-accent" />
                <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">
                  {doc ? (doc.type === 'PDF' ? `Edit Page ${pageNumber}` : 'Edit Document') : 'Image Editor'}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleDiscardEdit}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-sunken transition-colors"
                title="Discard and Close"
              >
                <X size={15} />
              </button>
            </div>

            {/* Tabs Selector: Crop, Filters, Sign & Text */}
            <div className="flex border border-border bg-bg-sunken p-1 rounded-lg flex-shrink-0">
              <button
                onClick={() => {
                  setActiveTab(EditTab.CROP);
                  updateDisplayDimensions();
                }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.CROP ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Crop
              </button>
              <button
                onClick={() => setActiveTab(EditTab.FILTERS)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.FILTERS ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Filters
              </button>
              <button
                onClick={() => setActiveTab(EditTab.SIGNATURE)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.SIGNATURE ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary hover:text-text-primary'}`}
              >
                Sign & Text
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-y-auto pr-0.5 flex flex-col gap-3">
              {activeTab === EditTab.CROP && (
                <div className="flex flex-col gap-2.5 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Perspective Crop</span>
                    {isCropPending() && (
                      <span className="px-1.5 py-0.5 text-[9px] font-bold bg-accent/15 text-accent rounded-full border border-accent/30 animate-pulse">
                        Pending Crop
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-text-secondary leading-snug">
                    Drag the 4 corner handles to frame document edges, or click Auto crop.
                  </p>

                  {/* Quick Preset Buttons: Full Image & Auto Crop with Loader */}
                  <div className="flex gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 justify-center py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                      onClick={() => {
                        setCropBox({
                          tl: { x: 0, y: 0 },
                          tr: { x: 100, y: 0 },
                          bl: { x: 0, y: 100 },
                          br: { x: 100, y: 100 }
                        });
                        rawDetectedBoxRef.current = null;
                        toast.success('Crop area set to entire image');
                      }}
                      title="Reset selection box to entire image (100%)"
                    >
                      <Maximize2 size={13} className="mr-1 text-text-muted" />
                      Full (100%)
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isAutoDetecting || isProcessing}
                      className="flex-1 justify-center py-1.5 text-xs font-semibold text-accent hover:text-accent-hover relative overflow-hidden transition-all shadow-sm"
                      onClick={() => handleAutoCrop(cropMargin, false)}
                      title="Automatically detect ID, document, or subject boundaries with margin"
                    >
                      {isAutoDetecting ? (
                        <>
                          <Loader2 size={13} className="mr-1.5 animate-spin text-accent" />
                          <span>Detecting...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles size={13} className="mr-1.5 text-accent animate-pulse" />
                          <span>Auto-Detect Subject</span>
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Subject Safety Margin Selector */}
                  <div className="flex items-center justify-between text-[11px] bg-bg-sunken border border-border/80 px-2.5 py-1.5 rounded-lg shadow-2xs">
                    <span className="font-semibold text-text-muted text-[10px] uppercase tracking-wider">
                      Subject Margin:
                    </span>
                    <div className="flex gap-1">
                      {[
                        { label: '0%', val: 0 },
                        { label: '1.5%', val: 1.5 },
                        { label: '3%', val: 3 },
                        { label: '5%', val: 5 },
                      ].map((m) => (
                        <button
                          key={m.label}
                          type="button"
                          onClick={() => {
                            setCropMargin(m.val);
                            applySubjectWithMargin(m.val);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                            cropMargin === m.val
                              ? 'bg-accent text-white shadow-xs'
                              : 'bg-bg-surface hover:bg-accent/15 text-text-secondary hover:text-accent border border-border'
                          }`}
                          title={`Set subject crop box with ${m.val}% safety margin`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Aspect Ratio / Presets bar */}
                  <div className="border border-border/80 rounded-lg p-2 bg-bg-sunken space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Presets & Size</span>
                      <button
                        type="button"
                        onClick={() => setCustomCropEnabled(!customCropEnabled)}
                        className="text-[10px] text-accent hover:underline font-semibold"
                      >
                        {customCropEnabled ? 'Hide Custom' : 'Custom Size'}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {[
                        { label: 'Passport', w: '3.5', h: '4.5', unit: 'cm' as const },
                        { label: 'Stamp', w: '2', h: '2.5', unit: 'cm' as const },
                        { label: 'A4', w: '210', h: '297', unit: 'mm' as const },
                        { label: '4×6"', w: '4', h: '6', unit: 'in' as const },
                        { label: '1:1', w: '500', h: '500', unit: 'px' as const },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            setCustomCropWidth(preset.w);
                            setCustomCropHeight(preset.h);
                            setCustomCropUnit(preset.unit);
                            applyCustomCropDimensions(preset.w, preset.h, preset.unit);
                          }}
                          className="px-2 py-0.5 text-[10px] bg-bg-surface hover:bg-accent/15 border border-border hover:border-accent/40 rounded text-text-secondary hover:text-accent transition-colors font-medium"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    {customCropEnabled && (
                      <div className="pt-2 border-t border-border/60 space-y-2 animate-fade-in">
                        <div className="grid grid-cols-3 gap-1.5 items-center">
                          <div>
                            <label className="text-[9px] font-semibold text-text-secondary block mb-0.5">Width</label>
                            <input
                              type="number"
                              placeholder="W"
                              value={customCropWidth}
                              onChange={(e) => setCustomCropWidth(e.target.value)}
                              className="w-full px-2 py-1 text-xs border border-border rounded bg-bg-surface text-text-primary focus:outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-semibold text-text-secondary block mb-0.5">Height</label>
                            <input
                              type="number"
                              placeholder="H"
                              value={customCropHeight}
                              onChange={(e) => setCustomCropHeight(e.target.value)}
                              className="w-full px-2 py-1 text-xs border border-border rounded bg-bg-surface text-text-primary focus:outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] font-semibold text-text-secondary block mb-0.5">Unit</label>
                            <select
                              value={customCropUnit}
                              onChange={(e) => setCustomCropUnit(e.target.value as any)}
                              className="w-full px-1.5 py-1 text-xs border border-border rounded bg-bg-surface text-text-primary focus:outline-none focus:border-accent"
                            >
                              <option value="px">px</option>
                              <option value="mm">mm</option>
                              <option value="cm">cm</option>
                              <option value="in">in</option>
                            </select>
                          </div>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full justify-center py-1 text-xs font-semibold"
                          onClick={() => applyCustomCropDimensions()}
                        >
                          Apply Preset Size
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Compact Zoom Loupe Preview */}
                  <div className="border border-border rounded-lg bg-bg-sunken p-2 flex flex-col items-center justify-center gap-1">
                    <div className="flex justify-between w-full items-center">
                      <span className="text-[9px] font-semibold text-text-muted uppercase">
                        Corner Inspector {activeHandle && ['tl', 'tr', 'bl', 'br'].includes(activeHandle) ? `(${activeHandle.toUpperCase()})` : ''}
                      </span>
                      <span className="text-[9px] text-text-muted">
                        {dragType ? 'Inspecting' : 'Hover / drag corner to inspect'}
                      </span>
                    </div>
                    <div className="w-[130px] h-[130px] rounded border border-border bg-[#0f172a] overflow-hidden relative flex justify-center items-center shadow-inner">
                      <canvas
                        ref={loupeCanvasRef}
                        width={130}
                        height={130}
                        className="w-full h-full"
                      />
                    </div>
                  </div>

                  {/* Rotation Controls */}
                  <div className="flex gap-1.5">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 justify-center py-1.5 text-xs text-text-secondary hover:text-text-primary"
                      onClick={() => handleRotate(false)}
                      title="Rotate counter-clockwise 90°"
                    >
                      <RotateCcw size={13} className="mr-1" />
                      Rotate CCW
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 justify-center py-1.5 text-xs text-text-secondary hover:text-text-primary"
                      onClick={() => handleRotate(true)}
                      title="Rotate clockwise 90°"
                    >
                      <RotateCw size={13} className="mr-1" />
                      Rotate CW
                    </Button>
                  </div>

                  {/* Apply Crop & Revert */}
                  <Button
                    variant={isCropPending() ? "primary" : "secondary"}
                    className={`w-full justify-center py-2 text-xs font-bold transition-all ${
                      isCropPending()
                        ? 'shadow-sm shadow-accent/20'
                        : 'opacity-80'
                    }`}
                    onClick={() => executeCrop(true)}
                    disabled={!isCropPending()}
                    title={isCropPending() ? "Execute perspective warp crop now" : "Crop box is set to full image (no pending crop)"}
                  >
                    <Check size={15} className="mr-1.5" />
                    {isCropPending() ? 'Apply Perspective Crop' : 'Crop Applied (100%)'}
                  </Button>

                  <Button
                    variant="ghost"
                    className="w-full justify-center text-xs py-1 text-text-muted hover:text-text-secondary"
                    onClick={handleResetCrop}
                    title="Revert all crops and rotations back to original image"
                  >
                    <RotateCcw size={13} className="mr-1.5" />
                    Revert to Original Image
                  </Button>
                </div>
              )}

              {activeTab === EditTab.FILTERS && (
                <div className="flex flex-col gap-2.5 animate-fade-in">
                  <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Image Enhancements</span>
                  <Button
                    variant="secondary"
                    className="w-full justify-start text-xs py-2"
                    onClick={() => applyFilter('clean')}
                  >
                    <Sparkles size={15} className="mr-2 text-accent" />
                    Clean & De-noise
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full justify-start text-xs py-2"
                    onClick={() => applyFilter('grayscale')}
                  >
                    <Sliders size={15} className="mr-2 text-text-secondary" />
                    Convert to Grayscale
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full justify-start text-xs py-2"
                    onClick={() => applyFilter('binarize')}
                  >
                    <ShieldAlert size={15} className="mr-2 text-text-secondary" />
                    Crisp Black & White
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-xs py-1.5"
                    onClick={handleResetFilters}
                  >
                    <RotateCcw size={15} className="mr-2" />
                    Reset Filters
                  </Button>
                </div>
              )}

              {activeTab === EditTab.SIGNATURE && (
                <div className="flex flex-col gap-4 animate-fade-in">
                  {/* Signature Section */}
                  <div>
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">Signature Library</span>
                    <Button
                      variant="primary"
                      className="w-full justify-center py-2 text-xs font-semibold"
                      onClick={() => setIsSignatureModalOpen(true)}
                    >
                      <Plus size={14} className="mr-1.5" />
                      Create New Signature
                    </Button>
                  </div>

                  {sessionSignatures.length > 0 ? (
                    <div className="space-y-2">
                      <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Your Signature Library</span>
                      <div className="grid grid-cols-2 gap-2 bg-bg-sunken border border-border p-2 rounded-lg max-h-[160px] overflow-y-auto">
                        {sessionSignatures.map((sigSrc, index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => {
                              const newSig: PlacedSignature = {
                                id: Math.random().toString(36).substring(2, 9),
                                x: 35,
                                y: 35,
                                width: 30,
                                height: 15,
                                imgSrc: sigSrc,
                                page: pageNumber
                              };
                              setPlacedSignatures((prev) => [...prev, newSig]);
                              toast.success(`Signature placed on page ${pageNumber}`);
                            }}
                            className="relative aspect-[2/1] border border-border hover:border-accent hover:bg-accent-light/20 bg-white rounded flex items-center justify-center p-1 group transition-all duration-normal shadow-sm cursor-pointer"
                            title="Click to place signature"
                          >
                            <img
                              src={sigSrc}
                              alt={`Signature ${index + 1}`}
                              className="max-w-full max-h-full object-contain pointer-events-none"
                            />
                            <span className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow">
                              {index + 1}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-muted italic bg-bg-sunken border border-border/60 rounded p-2.5 text-center leading-relaxed">
                      No signatures created yet. Click above to draw or type one!
                    </p>
                  )}

                  {/* Text Annotations Section */}
                  <div className="border-t border-border pt-3 space-y-3">
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block">Text Annotations</span>
                    <Button
                      variant="secondary"
                      className="w-full justify-center py-2 text-xs font-semibold"
                      onClick={() => {
                        const newText: PlacedText = {
                          id: Math.random().toString(36).substring(2, 9),
                          x: 35,
                          y: 35,
                          width: 30,
                          height: 8,
                          text: 'Double click to edit text',
                          fontSize: 16,
                          color: '#000000',
                          page: pageNumber
                        };
                        setPlacedTexts((prev) => [...prev, newText]);
                        setSelectedTextId(newText.id);
                        toast.success('Text box placed! Double click text box to type inline.');
                      }}
                    >
                      <Plus size={14} className="mr-1.5" />
                      Add Text Box
                    </Button>

                    {/* Selected Text Formatting Properties */}
                    {selectedTextId && placedTexts.some(t => t.id === selectedTextId) && (() => {
                      const activeTxt = placedTexts.find(t => t.id === selectedTextId)!;
                      return (
                        <div className="p-3 bg-bg-sunken border border-border rounded-lg space-y-3 animate-fade-in">
                          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">Edit Selected Text</span>
                          
                          <div>
                            <label className="block text-[10px] font-medium text-text-secondary mb-1">Text Content</label>
                            <textarea
                              value={activeTxt.text}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPlacedTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, text: val } : t));
                              }}
                              className="w-full px-2.5 py-1.5 text-xs border border-border rounded bg-white text-text-primary focus:outline-none focus:border-accent font-sans"
                              rows={2}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-medium text-text-secondary mb-1">Font Size ({activeTxt.fontSize}px)</label>
                              <input
                                type="range"
                                min={10}
                                max={48}
                                value={activeTxt.fontSize}
                                onChange={(e) => {
                                  const size = parseInt(e.target.value);
                                  setPlacedTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, fontSize: size } : t));
                                }}
                                className="w-full accent-accent cursor-pointer"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-text-secondary mb-1">Text Color</label>
                              <div className="flex gap-1.5 items-center">
                                <input
                                  type="color"
                                  value={activeTxt.color}
                                  onChange={(e) => {
                                    const col = e.target.value;
                                    setPlacedTexts(prev => prev.map(t => t.id === selectedTextId ? { ...t, color: col } : t));
                                  }}
                                  className="w-8 h-6 border border-border rounded cursor-pointer p-0"
                                />
                                <span className="text-[10px] text-text-secondary font-mono uppercase">{activeTxt.color}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {placedSignatures.length > 0 || placedTexts.length > 0 ? (
                    <div className="border-t border-border pt-3">
                      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                        Active Overlays ({placedSignatures.length} sig, {placedTexts.length} text)
                      </span>
                      <p className="text-[10px] text-text-muted leading-relaxed">
                        Drag and resize elements on the canvas. Double click text boxes to edit text. Click &apos;X&apos; to remove.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Bottom Actions for Saving and Discarding */}
            <div className="border-t border-border pt-2.5 flex flex-col gap-1.5 flex-shrink-0">
              <Button
                variant="primary"
                className="w-full justify-center py-2 bg-[#16A34A] hover:bg-[#15803D] text-white border-none font-semibold text-xs shadow-sm"
                onClick={() => handleSaveEdit()}
                disabled={isProcessing || isAutoDetecting}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                    Saving Edits...
                  </>
                ) : (
                  'Save & Overwrite'
                )}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-center py-1.5 text-xs text-text-secondary hover:text-text-primary"
                onClick={handleDiscardEdit}
                disabled={isProcessing}
              >
                Discard Changes
              </Button>
            </div>
          </div>
        )}
      </div>
      {renderSignatureModal()}
    </div>
  );
}

export default PreviewScreen;
