import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Printer, Crop, Sparkles,
  RotateCcw, RotateCw, Sliders, Check, ShieldAlert, X,
  AlertCircle, Upload, XCircle, ChevronLeft, ChevronRight,
  Trash2, Plus, FilePlus
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { PlacedSignature } from '../types/Document.types';
import Button from '../components/ui/Button';

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
  const [activeTab, setActiveTab] = useState<EditTab>(EditTab.FILTERS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<number>(Date.now());
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [showAddPageMenu, setShowAddPageMenu] = useState(false);
  const [pageThumbnails, setPageThumbnails] = useState<Record<number, string>>({});

  // Canvas Refs for editing
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const editedImageRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);

  const [activeFilter, setActiveFilter] = useState<'grayscale' | 'binarize' | 'clean' | null>(null);

  // 4 Corner Perspective Crop State
  const [cropBox, setCropBox] = useState<QuadCrop>({
    tl: { x: 10, y: 10 },
    tr: { x: 90, y: 10 },
    bl: { x: 10, y: 90 },
    br: { x: 90, y: 90 }
  });

  // Signature states
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);
  const [placedSignatures, setPlacedSignatures] = useState<PlacedSignature[]>([]);
  const [showSigInstructions, setShowSigInstructions] = useState(false);

  // Typed signature states
  const [signatureMode, setSignatureMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [sigTypeName, setSigTypeName] = useState('');
  const [sigTypeInitials, setSigTypeInitials] = useState('');
  const [sigTypeFontIndex, setSigTypeFontIndex] = useState(0);
  const [sigInitialsFontIndex, setSigInitialsFontIndex] = useState(0);
  const [isChangingSigStyle, setIsChangingSigStyle] = useState(false);
  const [isChangingInitialsStyle, setIsChangingInitialsStyle] = useState(false);

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragType, setDragType] = useState<string | null>(null); // 'tl', 'tr', 'bl', 'br', 'sigMove-id', 'sigResize-id', 'edge-top', etc.

  const doc = documents.find((d) => d.id === selectedDocumentId);

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

  const loadAllPageThumbnails = async () => {
    if (!doc || doc.type !== 'PDF') return;
    const thumbs: Record<number, string> = {};
    for (let i = 1; i <= doc.pageCount; i++) {
      try {
        const res = await window.electron.renderPdfPageThumbnail(doc.id, i);
        if (res.success) {
          thumbs[i] = res.data;
        }
      } catch (e) {
        console.error(`Failed to load thumbnail for page ${i}`, e);
      }
    }
    setPageThumbnails(thumbs);
  };

  useEffect(() => {
    if (doc && doc.type === 'PDF') {
      loadAllPageThumbnails();
    }
  }, [selectedDocumentId, doc?.pageCount, doc?.tempPath]);

  const handleDeletePage = async () => {
    if (!doc) return;
    const confirmed = await useAppStore.getState().showConfirm(
      `Are you sure you want to delete Page ${pageNumber} of "${doc.filename}"? This action cannot be undone.`,
      'Delete Page'
    );
    if (!confirmed) return;

    setIsProcessing(true);
    try {
      const result = await window.electron.deletePage(doc.id, pageNumber);
      if (result.success) {
        updateDocument(doc.id, result.data);
        toast.success(`Page ${pageNumber} deleted successfully`);
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
      resetCanvas();
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
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0);
    }
    setCropBox({
      tl: { x: 10, y: 10 },
      tr: { x: 90, y: 10 },
      bl: { x: 10, y: 90 },
      br: { x: 90, y: 90 }
    });
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
  const executeCrop = () => {
    const canvas = canvasRef.current;
    const img = editedImageRef.current || originalImageRef.current;
    if (!canvas || !img) return;

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
    if (!tempCtx) return;
    tempCtx.drawImage(img, 0, 0);

    // Create cropped canvas for destination
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = dstWidth;
    croppedCanvas.height = dstHeight;

    // Solve homography
    const matrix = getHomography(srcPoints, dstPoints);
    if (matrix.length === 0) {
      toast.error('Failed to compute perspective matrix. Verify shape.');
      return;
    }

    // Resize canvas and project pixels projectively
    warpPerspective(tempCanvas, croppedCanvas, matrix, dstWidth, dstHeight);

    // Save the cropped version
    editedImageRef.current = croppedCanvas;

    // Reset selection handles
    setCropBox({
      tl: { x: 5, y: 5 },
      tr: { x: 95, y: 5 },
      bl: { x: 5, y: 95 },
      br: { x: 95, y: 95 }
    });

    // Redraw canvas and apply active filter if present
    redrawCanvas();

    toast.success('Perspective crop applied');
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

    // Reset crop handles to fit the new aspect ratio / rotated image
    setCropBox({
      tl: { x: 10, y: 10 },
      tr: { x: 90, y: 10 },
      bl: { x: 10, y: 90 },
      br: { x: 90, y: 90 }
    });

    // Redraw canvas
    redrawCanvas();

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
    setCropBox({
      tl: { x: 10, y: 10 },
      tr: { x: 90, y: 10 },
      bl: { x: 10, y: 90 },
      br: { x: 90, y: 90 }
    });

    setPlacedSignatures((doc?.signatures || []).filter((sig) => (sig.page || 1) === pageNumber));
    redrawCanvas();
    toast.success('Crop and rotation reset');
  };

  // Draw real-time magnifying loupe zoom
  const drawLoupe = (pctX: number, pctY: number) => {
    const loupeCanvas = loupeCanvasRef.current;
    const canvas = canvasRef.current;
    if (!loupeCanvas || !canvas) return;

    const ctx = loupeCanvas.getContext('2d');
    if (!ctx) return;

    // Clear loupe (now 140x140)
    ctx.clearRect(0, 0, 140, 140);

    // Map handle percentages to canvas coordinates
    const px = (pctX / 100) * canvas.width;
    const py = (pctY / 100) * canvas.height;

    // Magnified zoom parameters: crop a 46x46 square around handle and stretch to 140x140 loupe (~3x zoom)
    const srcSize = 46;
    const destSize = 140;

    // Draw the zoomed image onto the loupe canvas
    ctx.drawImage(
      canvas,
      px - srcSize / 2,
      py - srcSize / 2,
      srcSize,
      srcSize,
      0,
      0,
      destSize,
      destSize
    );

    // Draw 90-degree crossing target lines (crosshairs) crossing the center (70, 70)
    ctx.strokeStyle = '#EF4444'; // Solid Red crosshair lines
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Vertical line
    ctx.moveTo(70, 0);
    ctx.lineTo(70, 140);
    // Horizontal line
    ctx.moveTo(0, 70);
    ctx.lineTo(140, 70);
    ctx.stroke();
  };

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

  const handleUploadSignature = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
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
      toast.success('Signature uploaded! Drag and resize it on the document.');
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input
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
  const handleSaveEdit = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;

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
            flatCtx.drawImage(img, destX, destY, destW, destH);
            resolve();
          };
          img.onerror = () => reject(new Error('Failed to load signature image'));
          img.src = sig.imgSrc;
        });
      });

      await Promise.all(loadPromises);

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
        loadPreviewImage();
      } else {
        toast.error(result.error.message);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to save document edits');
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
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragType(type);

    if (['tl', 'tr', 'bl', 'br'].includes(type)) {
      const handle = type as keyof QuadCrop;
      // Draw zoomed magnifier loupe immediately on mousedown
      setTimeout(() => {
        drawLoupe(cropBox[handle].x, cropBox[handle].y);
      }, 0);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart || !dragType || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const deltaX = ((e.clientX - dragStart.x) / containerRect.width) * 100;
    const deltaY = ((e.clientY - dragStart.y) / containerRect.height) * 100;

    if (dragType.startsWith('sigMove-')) {
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
    } else if (['tl', 'tr', 'bl', 'br'].includes(dragType)) {
      const newX = Math.max(0, Math.min(100, ((e.clientX - containerRect.left) / containerRect.width) * 100));
      const newY = Math.max(0, Math.min(100, ((e.clientY - containerRect.top) / containerRect.height) * 100));

      setCropBox((prev) => {
        const updated = {
          ...prev,
          [dragType]: { x: newX, y: newY }
        };
        // Redraw loupe with new real-time coordinates
        drawLoupe(newX, newY);
        return updated;
      });
    } else if (['edge-top', 'edge-right', 'edge-bottom', 'edge-left'].includes(dragType)) {
      setCropBox((prev) => {
        const updated = { ...prev };
        if (dragType === 'edge-top') {
          updated.tl = { x: Math.max(0, Math.min(100, prev.tl.x + deltaX)), y: Math.max(0, Math.min(100, prev.tl.y + deltaY)) };
          updated.tr = { x: Math.max(0, Math.min(100, prev.tr.x + deltaX)), y: Math.max(0, Math.min(100, prev.tr.y + deltaY)) };
        } else if (dragType === 'edge-right') {
          updated.tr = { x: Math.max(0, Math.min(100, prev.tr.x + deltaX)), y: Math.max(0, Math.min(100, prev.tr.y + deltaY)) };
          updated.br = { x: Math.max(0, Math.min(100, prev.br.x + deltaX)), y: Math.max(0, Math.min(100, prev.br.y + deltaY)) };
        } else if (dragType === 'edge-bottom') {
          updated.bl = { x: Math.max(0, Math.min(100, prev.bl.x + deltaX)), y: Math.max(0, Math.min(100, prev.bl.y + deltaY)) };
          updated.br = { x: Math.max(0, Math.min(100, prev.br.x + deltaX)), y: Math.max(0, Math.min(100, prev.br.y + deltaY)) };
        } else if (dragType === 'edge-left') {
          updated.tl = { x: Math.max(0, Math.min(100, prev.tl.x + deltaX)), y: Math.max(0, Math.min(100, prev.tl.y + deltaY)) };
          updated.bl = { x: Math.max(0, Math.min(100, prev.bl.x + deltaX)), y: Math.max(0, Math.min(100, prev.bl.y + deltaY)) };
        }
        return updated;
      });
    }

    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setDragStart(null);
    setDragType(null);
  };

  const handleBack = () => {
    if (isEditing) {
      setIsEditing(false);
      setPlacedSignatures((doc?.signatures || []).filter((sig) => (sig.page || 1) === pageNumber));
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  disabled={isProcessing || isPrinting}
                >
                  <Crop size={16} className="mr-1.5" />
                  {doc.type === 'PDF' ? 'Edit Page' : 'Edit Document'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handlePrint}
                  disabled={isProcessing || isPrinting}
                >
                  <Printer size={16} className="mr-1.5" />
                  {isPrinting ? 'Printing...' : 'Print'}
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
        {!isEditing && doc && doc.type === 'PDF' && (
          <div className="w-48 border-r border-border bg-bg-surface flex flex-col h-full select-none animate-slide-in">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary uppercase tracking-wider">Pages</span>
              <span className="text-[10px] font-medium bg-bg-sunken px-2 py-0.5 rounded text-text-secondary">
                Total: {doc.pageCount}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
              {Array.from({ length: doc.pageCount }, (_, i) => i + 1).map((p) => {
                const isSelected = pageNumber === p;
                const thumbPath = pageThumbnails[p];
                return (
                  <button
                    key={p}
                    onClick={() => setPageNumber(p)}
                    className={`group flex flex-col items-center p-2 rounded-lg border transition-fast text-center relative ${
                      isSelected
                        ? 'border-accent bg-accent/5 shadow-sm'
                        : 'border-border hover:border-text-secondary hover:bg-bg-sunken'
                    }`}
                  >
                    <div className="w-full aspect-[3/4] bg-bg-sunken rounded border border-border/50 overflow-hidden relative flex items-center justify-center mb-1.5 shadow-inner">
                      {thumbPath ? (
                        <img
                          src={`docuflow:///${thumbPath.replace(/\\/g, '/')}?t=${timestamp}`}
                          alt={`Page ${p}`}
                          className="w-full h-full object-contain select-none bg-white p-1"
                        />
                      ) : (
                        <div className="animate-pulse bg-bg-sunken w-full h-full flex items-center justify-center text-[10px] text-text-muted">
                          Loading...
                        </div>
                      )}
                    </div>
                    <span className={`text-xs font-medium ${isSelected ? 'text-accent font-semibold' : 'text-text-secondary'}`}>
                      Page {p}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Center/Viewer Side: Viewer or Editor Canvas */}
        <div className="flex-1 p-6 flex flex-col justify-between items-center overflow-hidden gap-4">
          <div className="w-full flex-1 bg-bg-surface border border-border rounded-lg shadow-md overflow-hidden relative flex justify-center items-center p-4">
            {!isEditing ? (
              // Standard View Mode (Displays image for BOTH images and pre-rendered PDFs to bypass Chromium PDF blocking)
              isProcessing ? (
                <div className="text-center p-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto mb-2"></div>
                  <p className="text-xs text-text-secondary">Generating preview...</p>
                </div>
              ) : previewImagePath ? (
                <div className="w-full h-full flex justify-center items-center overflow-auto animate-fade-in">
                  <img
                    src={`docuflow:///${previewImagePath.replace(/\\/g, '/')}?t=${timestamp}`}
                    alt={doc.filename}
                    className="max-w-full max-h-full rounded shadow-sm object-contain select-none bg-white p-2"
                  />
                </div>
              ) : (
                <p className="text-sm text-text-secondary">Preview not available</p>
              )
            ) : (
              // Active Editor Workspace
              <div
                className="relative max-w-full max-h-[90%] flex items-center justify-center border border-border bg-bg-sunken p-2 rounded"
              >
                <div
                  ref={containerRef}
                  className="relative select-none"
                >
                  <canvas
                    ref={canvasRef}
                    className="max-w-full max-h-[500px] object-contain rounded shadow-md bg-white"
                  />

                  {/* Perspective Crop Handles */}
                  {activeTab === EditTab.CROP && (
                    <div className="absolute inset-0 w-full h-full">
                      {/* SVG Connector lines (Using viewBox for perfect pixel percentage scaling) */}
                      <svg
                        className="absolute inset-0 w-full h-full z-10"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        style={{ pointerEvents: 'none' }}
                      >
                        <polygon
                          points={`${cropBox.tl.x},${cropBox.tl.y} ${cropBox.tr.x},${cropBox.tr.y} ${cropBox.br.x},${cropBox.br.y} ${cropBox.bl.x},${cropBox.bl.y}`}
                          className="stroke-accent stroke-[0.4] fill-accent/10 pointer-events-none"
                        />
                        {/* Top Edge (tl to tr) */}
                        <line
                          x1={cropBox.tl.x}
                          y1={cropBox.tl.y}
                          x2={cropBox.tr.x}
                          y2={cropBox.tr.y}
                          className="stroke-accent/0 hover:stroke-accent/40 cursor-move transition-colors duration-normal"
                          strokeWidth="3"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleMouseDown(e, 'edge-top')}
                        />
                        {/* Right Edge (tr to br) */}
                        <line
                          x1={cropBox.tr.x}
                          y1={cropBox.tr.y}
                          x2={cropBox.br.x}
                          y2={cropBox.br.y}
                          className="stroke-accent/0 hover:stroke-accent/40 cursor-move transition-colors duration-normal"
                          strokeWidth="3"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleMouseDown(e, 'edge-right')}
                        />
                        {/* Bottom Edge (bl to br) */}
                        <line
                          x1={cropBox.bl.x}
                          y1={cropBox.bl.y}
                          x2={cropBox.br.x}
                          y2={cropBox.br.y}
                          className="stroke-accent/0 hover:stroke-accent/40 cursor-move transition-colors duration-normal"
                          strokeWidth="3"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleMouseDown(e, 'edge-bottom')}
                        />
                        {/* Left Edge (tl to bl) */}
                        <line
                          x1={cropBox.tl.x}
                          y1={cropBox.tl.y}
                          x2={cropBox.bl.x}
                          y2={cropBox.bl.y}
                          className="stroke-accent/0 hover:stroke-accent/40 cursor-move transition-colors duration-normal"
                          strokeWidth="3"
                          style={{ pointerEvents: 'auto' }}
                          onMouseDown={(e) => handleMouseDown(e, 'edge-left')}
                        />
                      </svg>

                      {/* Draggable Corner Handles */}
                      <div
                        className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${cropBox.tl.x}%`, top: `${cropBox.tl.y}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'tl')}
                      />
                      <div
                        className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${cropBox.tr.x}%`, top: `${cropBox.tr.y}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'tr')}
                      />
                      <div
                        className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${cropBox.bl.x}%`, top: `${cropBox.bl.y}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'bl')}
                      />
                      <div
                        className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20 shadow"
                        style={{ left: `${cropBox.br.x}%`, top: `${cropBox.br.y}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'br')}
                      />
                    </div>
                  )}

                  {/* Active Placed Signatures Overlays */}
                  {activeTab === EditTab.SIGNATURE && placedSignatures.map((sig) => (
                    <div
                      key={sig.id}
                      className="absolute border border-dashed border-accent bg-accent/5 cursor-move z-10"
                      style={{
                        left: `${sig.x}%`,
                        top: `${sig.y}%`,
                        width: `${sig.width}%`,
                        height: `${sig.height}%`,
                      }}
                      onMouseDown={(e) => handleMouseDown(e, `sigMove-${sig.id}`)}
                    >
                      <img
                        src={sig.imgSrc}
                        alt="Placed signature"
                        className="w-full h-full object-contain pointer-events-none"
                      />
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
                </div>
              </div>
            )}
          </div>

          {/* Page Navigation controls (only for PDF files with pageCount > 1) */}
          {!isEditing && doc && doc.type === 'PDF' && doc.pageCount > 1 && (
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
          <div className="w-80 border-l border-border bg-bg-surface p-6 flex flex-col gap-6 select-none z-10 animate-slide-in">
            {/* Tabs Selector */}
            <div className="flex border border-border bg-bg-sunken p-1 rounded-lg flex-shrink-0">
              <button
                onClick={() => setActiveTab(EditTab.FILTERS)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.FILTERS ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary'}`}
              >
                Filters
              </button>
              <button
                onClick={() => setActiveTab(EditTab.CROP)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.CROP ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary'}`}
              >
                Crop Box
              </button>
              <button
                onClick={() => setActiveTab(EditTab.SIGNATURE)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.SIGNATURE ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary'}`}
              >
                Signature
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 overflow-auto flex flex-col gap-4">
              {activeTab === EditTab.FILTERS && (
                <div className="flex flex-col gap-3 animate-fade-in">
                  <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Image Enhancements</span>
                  <Button
                    variant="secondary"
                    className="w-full justify-start text-sm py-2.5"
                    onClick={() => applyFilter('clean')}
                  >
                    <Sparkles size={16} className="mr-2 text-accent" />
                    Clean & De-noise
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full justify-start text-sm py-2.5"
                    onClick={() => applyFilter('grayscale')}
                  >
                    <Sliders size={16} className="mr-2 text-text-secondary" />
                    Convert to Grayscale
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full justify-start text-sm py-2.5"
                    onClick={() => applyFilter('binarize')}
                  >
                    <ShieldAlert size={16} className="mr-2 text-text-secondary" />
                    Crisp Black & White
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-sm py-2"
                    onClick={handleResetFilters}
                  >
                    <RotateCcw size={16} className="mr-2" />
                    Reset Filters
                  </Button>
                </div>
              )}

              {activeTab === EditTab.CROP && (
                <div className="flex flex-col gap-4 animate-fade-in">
                  <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Perspective Crop</span>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    Drag the 4 corner handles individually to trace the borders of any paper.
                    Applying the crop will deskew the shape into a clean, flat 90-degree rectangle.
                  </p>

                  {/* Zoom Loupe Preview Container inside control panel */}
                  <div className="border border-border rounded-lg bg-bg-sunken p-3 flex flex-col items-center justify-center gap-2">
                    <span className="text-[10px] font-semibold text-text-muted uppercase self-start">Zoom Loupe</span>
                    <div className="w-[140px] h-[140px] rounded-lg border border-border bg-white overflow-hidden relative flex justify-center items-center shadow-inner">
                      {dragType && ['tl', 'tr', 'bl', 'br'].includes(dragType) ? (
                        <canvas
                          ref={loupeCanvasRef}
                          width={140}
                          height={140}
                          className="w-full h-full"
                        />
                      ) : (
                        <span className="text-xs text-text-muted italic text-center p-4">
                          Drag a handle to see zoom preview
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1 justify-center py-2 text-xs"
                      onClick={() => handleRotate(false)}
                    >
                      <RotateCcw size={14} className="mr-1.5" />
                      Rotate CCW
                    </Button>
                    <Button
                      variant="secondary"
                      className="flex-1 justify-center py-2 text-xs"
                      onClick={() => handleRotate(true)}
                    >
                      <RotateCw size={14} className="mr-1.5" />
                      Rotate CW
                    </Button>
                  </div>

                  <Button
                    variant="primary"
                    className="w-full justify-center py-2.5"
                    onClick={executeCrop}
                  >
                    <Check size={16} className="mr-2" />
                    Apply Crop
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-sm"
                    onClick={handleResetCrop}
                  >
                    <RotateCcw size={16} className="mr-2" />
                    Reset Crop & Rotation
                  </Button>
                </div>
              )}

              {activeTab === EditTab.SIGNATURE && (
                <div className="flex flex-col gap-4 animate-fade-in">
                  {/* Mode Selector Buttons */}
                  <div className="flex border border-border bg-bg-sunken p-1 rounded-lg flex-shrink-0">
                    <button
                      onClick={() => setSignatureMode('draw')}
                      className={`flex-1 py-1 text-[11px] font-semibold rounded-md transition-fast ${signatureMode === 'draw' ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary'}`}
                    >
                      Draw
                    </button>
                    <button
                      onClick={() => setSignatureMode('type')}
                      className={`flex-1 py-1 text-[11px] font-semibold rounded-md transition-fast ${signatureMode === 'type' ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary'}`}
                    >
                      Type
                    </button>
                    <button
                      onClick={() => setSignatureMode('upload')}
                      className={`flex-1 py-1 text-[11px] font-semibold rounded-md transition-fast ${signatureMode === 'upload' ? 'bg-bg-surface text-accent shadow-sm border border-border/50' : 'text-text-secondary'}`}
                    >
                      Upload
                    </button>
                  </div>

                  {signatureMode === 'draw' && (
                    <div className="flex flex-col gap-3 animate-fade-in">
                      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Hand-drawn Signature</span>
                      <canvas
                        ref={sigCanvasRef}
                        width={270}
                        height={120}
                        className="border border-border bg-white rounded-lg signature-pad-canvas touch-none shadow-inner"
                        onMouseDown={startSigDrawing}
                        onMouseMove={drawSigLine}
                        onMouseUp={endSigDrawing}
                        onMouseLeave={endSigDrawing}
                        onTouchStart={startSigDrawingTouch}
                        onTouchMove={drawSigLineTouch}
                        onTouchEnd={endSigDrawing}
                      />
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={clearSigPad} className="flex-1 text-xs py-2">
                          Clear Pad
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleAddSignature} className="flex-1 text-xs py-2">
                          Add Signature
                        </Button>
                      </div>
                    </div>
                  )}

                  {signatureMode === 'type' && (
                    <div className="flex flex-col gap-4 animate-fade-in relative">
                      {isChangingSigStyle ? (
                        // Signature Style Selector View
                        <div className="space-y-3 animate-fade-in">
                          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">Select Signature Style</span>
                          <div className="flex flex-col gap-2">
                            {SIGNATURE_FONTS.map((font, idx) => (
                              <button
                                key={font}
                                onClick={() => {
                                  setSigTypeFontIndex(idx);
                                  setIsChangingSigStyle(false);
                                }}
                                className={`w-full p-4 border rounded-lg bg-white text-center hover:border-accent hover:bg-accent-light/10 transition-all shadow-sm ${sigTypeFontIndex === idx ? 'border-accent ring-2 ring-accent/20' : 'border-border'}`}
                                style={{ fontFamily: `"${font}", cursive`, fontSize: '24px' }}
                              >
                                {sigTypeName || 'Signature'}
                              </button>
                            ))}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs justify-center"
                            onClick={() => setIsChangingSigStyle(false)}
                          >
                            Back to Typing
                          </Button>
                        </div>
                      ) : isChangingInitialsStyle ? (
                        // Initials Style Selector View
                        <div className="space-y-3 animate-fade-in">
                          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block">Select Initials Style</span>
                          <div className="flex flex-col gap-2">
                            {SIGNATURE_FONTS.map((font, idx) => (
                              <button
                                key={font}
                                onClick={() => {
                                  setSigInitialsFontIndex(idx);
                                  setIsChangingInitialsStyle(false);
                                }}
                                className={`w-full p-4 border rounded-lg bg-white text-center hover:border-accent hover:bg-accent-light/10 transition-all shadow-sm ${sigInitialsFontIndex === idx ? 'border-accent ring-2 ring-accent/20' : 'border-border'}`}
                                style={{ fontFamily: `"${font}", cursive`, fontSize: '24px' }}
                              >
                                {sigTypeInitials || 'Initials'}
                              </button>
                            ))}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs justify-center"
                            onClick={() => setIsChangingInitialsStyle(false)}
                          >
                            Back to Typing
                          </Button>
                        </div>
                      ) : (
                        // Main Inputs View
                        <div className="space-y-4 animate-fade-in">
                          <div className="flex gap-2">
                            <div className="flex-1 min-w-0">
                              <label className="text-[10px] font-semibold text-text-muted uppercase block mb-1">Full Name</label>
                              <input
                                type="text"
                                value={sigTypeName}
                                onChange={(e) => {
                                  setSigTypeName(e.target.value);
                                  if (e.target.value && !sigTypeInitials) {
                                    setSigTypeInitials(e.target.value.charAt(0).toUpperCase());
                                  }
                                }}
                                placeholder="Type name..."
                                className="w-full px-2.5 py-1.5 text-xs border border-border rounded bg-white text-text-primary focus:outline-none focus:border-accent animate-fade-in"
                              />
                            </div>
                            <div className="w-20 flex-shrink-0">
                              <label className="text-[10px] font-semibold text-text-muted uppercase block mb-1">Initials</label>
                              <input
                                type="text"
                                value={sigTypeInitials}
                                onChange={(e) => setSigTypeInitials(e.target.value.toUpperCase())}
                                placeholder="Initials"
                                className="w-full px-2.5 py-1.5 text-xs border border-border rounded bg-white text-text-primary text-center focus:outline-none focus:border-accent animate-fade-in"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            {/* Full Name Preview Card */}
                            <div className="space-y-1">
                              <div className="border border-border rounded-lg bg-bg-sunken p-3 flex flex-col justify-center items-center h-20 shadow-inner relative overflow-hidden select-none">
                                {sigTypeName ? (
                                  <span
                                    className="text-text-primary truncate max-w-full text-center"
                                    style={{ fontFamily: `"${SIGNATURE_FONTS[sigTypeFontIndex]}", cursive`, fontSize: '22px' }}
                                  >
                                    {sigTypeName}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-text-muted italic animate-fade-in">Preview</span>
                                )}
                              </div>
                              <button
                                onClick={() => setIsChangingSigStyle(true)}
                                className="text-[10px] text-accent hover:underline font-semibold block text-center w-full"
                              >
                                Change style
                              </button>
                            </div>

                            {/* Initials Preview Card */}
                            <div className="space-y-1">
                              <div className="border border-border rounded-lg bg-bg-sunken p-3 flex flex-col justify-center items-center h-20 shadow-inner relative overflow-hidden select-none">
                                {sigTypeInitials ? (
                                  <span
                                    className="text-text-primary truncate max-w-full text-center"
                                    style={{ fontFamily: `"${SIGNATURE_FONTS[sigInitialsFontIndex]}", cursive`, fontSize: '22px' }}
                                  >
                                    {sigTypeInitials}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-text-muted italic animate-fade-in">Preview</span>
                                )}
                              </div>
                              <button
                                onClick={() => setIsChangingInitialsStyle(true)}
                                className="text-[10px] text-accent hover:underline font-semibold block text-center w-full"
                              >
                                Change style
                              </button>
                            </div>
                          </div>

                          <div className="flex gap-2 pt-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="flex-1 text-xs py-2 justify-center"
                              onClick={handleAddTypedInitials}
                              disabled={!sigTypeInitials.trim()}
                            >
                              Add Initials
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              className="flex-1 text-xs py-2 justify-center"
                              onClick={handleAddTypedSignature}
                              disabled={!sigTypeName.trim()}
                            >
                              Add Signature
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {signatureMode === 'upload' && (
                    <div className="flex flex-col gap-3 animate-fade-in">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Upload Signature</span>
                        <button
                          onClick={() => setShowSigInstructions(!showSigInstructions)}
                          className="text-text-muted hover:text-accent transition-colors p-0.5"
                          title="Signature requirements"
                        >
                          <AlertCircle size={16} />
                        </button>
                      </div>

                      {showSigInstructions && (
                        <div className="p-3 bg-bg-sunken border border-border rounded-lg text-xs text-text-secondary space-y-1.5 animate-slide-in">
                          <p className="font-semibold text-accent flex items-center gap-1">
                            <AlertCircle size={12} /> Instructions:
                          </p>
                          <ul className="list-disc pl-4 space-y-1">
                            <li>It should be clean (written on plain white paper).</li>
                            <li>Have a clean upload (e.g. use a background remover before uploading).</li>
                            <li>After that, upload the signature file (PNG, JPG, WebP).</li>
                          </ul>
                        </div>
                      )}

                      <div className="relative">
                        <input
                          type="file"
                          accept="image/png, image/jpeg, image/jpg, image/webp"
                          onChange={handleUploadSignature}
                          className="hidden"
                          id="sig-file-upload"
                        />
                        <label
                          htmlFor="sig-file-upload"
                          className="flex items-center justify-center gap-2 border border-dashed border-border hover:border-accent hover:bg-accent-light/30 rounded-lg p-3 cursor-pointer text-xs font-medium text-text-secondary hover:text-accent transition-all duration-normal"
                        >
                          <Upload size={14} />
                          Upload Signature File
                        </label>
                      </div>
                    </div>
                  )}

                  {sessionSignatures.length > 0 && (
                    <div className="border-t border-border pt-4 animate-fade-in">
                      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">Quick-Access Signatures</span>
                      <div className="grid grid-cols-3 gap-2 bg-bg-sunken border border-border p-2 rounded-lg max-h-[140px] overflow-y-auto">
                        {sessionSignatures.map((sigSrc, index) => (
                          <button
                            key={index}
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
                              toast.success(`Signature #${index + 1} added to Page ${pageNumber}!`);
                            }}
                            className="relative aspect-[2/1] border border-border hover:border-accent hover:bg-accent-light/20 bg-white rounded flex items-center justify-center p-1 group transition-all duration-normal shadow-sm cursor-pointer"
                            title={`Click to place Signature #${index + 1}`}
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
                  )}

                  {placedSignatures.length > 0 && (
                    <div className="border-t border-border pt-4">
                      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">Placed Signatures ({placedSignatures.length})</span>
                      <p className="text-[10px] text-text-muted leading-relaxed">
                        Drag and resize the boxes on the document. Click the X button on the top-right of any signature box to remove it.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom Actions for Saving and Overwriting */}
            <div className="border-t border-border pt-4 flex flex-col gap-2 flex-shrink-0">
              <Button
                variant="primary"
                className="w-full justify-center py-3 bg-[#16A34A] hover:bg-[#15803D] text-white border-none font-semibold shadow-sm"
                onClick={handleSaveEdit}
                disabled={isProcessing}
              >
                {isProcessing ? 'Saving Edits...' : 'Save & Overwrite'}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-center py-2"
                onClick={() => {
                  setIsEditing(false);
                  setPlacedSignatures((doc?.signatures || []).filter((sig) => (sig.page || 1) === pageNumber));
                  toast.error('Changes discarded');
                }}
                disabled={isProcessing}
              >
                Cancel Edit
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-center py-2 text-text-secondary hover:text-text-primary"
                onClick={() => {
                  setIsEditing(false);
                  setPlacedSignatures((doc?.signatures || []).filter((sig) => (sig.page || 1) === pageNumber));
                }}
                disabled={isProcessing}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PreviewScreen;
