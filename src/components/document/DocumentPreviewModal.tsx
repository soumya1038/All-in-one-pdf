import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import { ModalType } from '../../types/UI.types';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { 
  Printer, Crop, ShieldAlert, Sparkles, 
  RotateCcw, Sliders, Check, X
} from 'lucide-react';
import { toast } from 'react-hot-toast';

enum EditTab {
  FILTERS = 'FILTERS',
  CROP = 'CROP',
  SIGNATURE = 'SIGNATURE',
}

interface Point {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
}

interface QuadCrop {
  tl: Point;
  tr: Point;
  bl: Point;
  br: Point;
}

// Solve A * X = B using Gaussian elimination
function solveLinearSystem(A: number[][], B: number[]): number[] {
  const n = B.length;
  for (let i = 0; i < n; i++) {
    let maxEl = Math.abs(A[i][i]);
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > maxEl) {
        maxEl = Math.abs(A[k][i]);
        maxRow = k;
      }
    }
    for (let k = i; k < n; k++) {
      const tmp = A[maxRow][k];
      A[maxRow][k] = A[i][k];
      A[i][k] = tmp;
    }
    const tmp = B[maxRow];
    B[maxRow] = B[i];
    B[i] = tmp;

    if (Math.abs(A[i][i]) < 1e-10) {
      return new Array(n).fill(0);
    }

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

  const X = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    X[i] = B[i] / A[i][i];
    for (let k = i - 1; k >= 0; k--) {
      B[k] -= A[k][i] * X[i];
    }
  }
  return X;
}

// Compute perspective transform matrix mapping source quad to destination rectangle
function getPerspectiveTransform(
  src: Point[],
  dst: Point[]
): number[] {
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

function DocumentPreviewModal() {
  const modal = useAppStore((state) => state.ui.modal);
  const closeModal = useAppStore((state) => state.closeModal);
  const updateDocument = useAppStore((state) => state.updateDocument);
  const documents = useAppStore((state) => state.documents);

  const documentId = modal.type === ModalType.DOCUMENT_PREVIEW ? (modal.data as string) : null;
  const doc = documents.find((d) => d.id === documentId);

  const isOpen = modal.type === ModalType.DOCUMENT_PREVIEW && !!doc;

  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<EditTab>(EditTab.FILTERS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);

  // Canvas Refs for editing
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);

  // 4 Corner Perspective Crop State
  const [cropBox, setCropBox] = useState<QuadCrop>({
    tl: { x: 10, y: 10 },
    tr: { x: 90, y: 10 },
    bl: { x: 10, y: 90 },
    br: { x: 90, y: 90 }
  });

  // Signature pad states
  const sigCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawingSig, setIsDrawingSig] = useState(false);
  const [signatureImage, setSignatureImage] = useState<HTMLImageElement | null>(null);
  const [sigPosition, setSigPosition] = useState({ x: 30, y: 30, width: 40, height: 20 }); // percentage

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragType, setDragType] = useState<string | null>(null); // 'tl', 'tr', 'bl', 'br', 'sigMove', 'sigResize'

  // Image load & setup
  useEffect(() => {
    if (isOpen && isEditing && doc) {
      const img = new Image();
      img.src = `docuflow:///${doc.tempPath.replace(/\\/g, '/')}`;
      img.onload = () => {
        originalImageRef.current = img;
        resetCanvas();
      };
    }
  }, [isOpen, isEditing, doc]);

  const resetCanvas = () => {
    const canvas = canvasRef.current;
    const img = originalImageRef.current;
    if (!canvas || !img) return;

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
    setSignatureImage(null);
  };

  // Filter application
  const applyFilter = (filterType: 'grayscale' | 'binarize' | 'clean') => {
    const canvas = canvasRef.current;
    const img = originalImageRef.current;
    if (!canvas || !img) return;

    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (filterType === 'grayscale') {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      } else if (filterType === 'binarize') {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const threshold = 127;
        const bin = gray > threshold ? 255 : 0;
        data[i] = bin;
        data[i + 1] = bin;
        data[i + 2] = bin;
      } else if (filterType === 'clean') {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        let newVal = gray;
        if (gray > 165) {
          newVal = 255;
        } else if (gray < 85) {
          newVal = 0;
        } else {
          newVal = ((gray - 85) / (165 - 85)) * 255;
        }
        data[i] = newVal;
        data[i + 1] = newVal;
        data[i + 2] = newVal;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    toast.success(`${filterType.charAt(0).toUpperCase() + filterType.slice(1)} filter applied`);
  };

  // Perform 4-corner perspective warp crop
  const executeCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Convert crop corner percentages to pixel coordinates
    const pTL = { x: (cropBox.tl.x / 100) * canvas.width, y: (cropBox.tl.y / 100) * canvas.height };
    const pTR = { x: (cropBox.tr.x / 100) * canvas.width, y: (cropBox.tr.y / 100) * canvas.height };
    const pBL = { x: (cropBox.bl.x / 100) * canvas.width, y: (cropBox.bl.y / 100) * canvas.height };
    const pBR = { x: (cropBox.br.x / 100) * canvas.width, y: (cropBox.br.y / 100) * canvas.height };

    // Calculate dimensions of destination flat rectangle (average width and height of selected quad)
    const w1 = Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y);
    const w2 = Math.hypot(pBR.x - pBL.x, pBR.y - pBL.y);
    const h1 = Math.hypot(pBL.x - pTL.x, pBL.y - pTL.y);
    const h2 = Math.hypot(pBR.x - pTR.x, pBR.y - pTR.y);

    const dstWidth = Math.round(Math.max(w1, w2));
    const dstHeight = Math.round(Math.max(h1, h2));

    if (dstWidth < 10 || dstHeight < 10) {
      toast.error('Selected crop region is too small.');
      return;
    }

    // Create an offscreen temporary canvas to hold original image data
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    tempCtx.drawImage(canvas, 0, 0);

    // Points
    const srcPoints = [pTL, pTR, pBL, pBR];
    const dstPoints = [
      { x: 0, y: 0 },
      { x: dstWidth, y: 0 },
      { x: 0, y: dstHeight },
      { x: dstWidth, y: dstHeight }
    ];

    // Get transform matrix
    const matrix = getPerspectiveTransform(srcPoints, dstPoints);

    // Resize main canvas
    canvas.width = dstWidth;
    canvas.height = dstHeight;

    // Warp perspective
    warpPerspective(tempCanvas, canvas, matrix, dstWidth, dstHeight);

    // Reset crop handles to standard quad box
    setCropBox({
      tl: { x: 10, y: 10 },
      tr: { x: 90, y: 10 },
      bl: { x: 10, y: 90 },
      br: { x: 90, y: 90 }
    });

    toast.success('Perspective crop applied');
  };

  // Signature Pad Handlers
  const startSigDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1C1917';
    setIsDrawingSig(true);
  };

  const drawSigLine = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const startSigDrawingTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas || e.touches.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const y = e.touches[0].clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1C1917';
    setIsDrawingSig(true);
  };

  const drawSigLineTouch = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig || e.touches.length === 0) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const y = e.touches[0].clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endSigDrawing = () => {
    setIsDrawingSig(false);
  };

  const clearSigPad = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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

    const img = new Image();
    img.src = sigCanvas.toDataURL();
    img.onload = () => {
      setSignatureImage(img);
      setSigPosition({ x: 30, y: 30, width: 40, height: 20 });
      toast.success('Signature added! Position it on the document.');
    };
  };

  const handleApplySignature = () => {
    const canvas = canvasRef.current;
    if (!canvas || !signatureImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const destX = (sigPosition.x / 100) * canvas.width;
    const destY = (sigPosition.y / 100) * canvas.height;
    const destW = (sigPosition.width / 100) * canvas.width;
    const destH = (sigPosition.height / 100) * canvas.height;

    ctx.drawImage(signatureImage, destX, destY, destW, destH);
    setSignatureImage(null);
    toast.success('Signature applied');
  };

  // Save changes to backend
  const handleSaveEdit = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !documentId) return;

    setIsProcessing(true);

    try {
      const base64Data = canvas.toDataURL('image/jpeg', 0.9);
      const result = await window.electron.applyDocumentEdit(documentId, base64Data);

      if (result.success) {
        updateDocument(documentId, result.data);
        toast.success('Document updated successfully');
        setIsEditing(false);
      } else {
        toast.error(result.error.message);
      }
    } catch (error) {
      toast.error('Failed to save document edits');
    } finally {
      setIsProcessing(false);
    }
  };

  // Trigger print
  const handlePrint = async () => {
    if (!documentId) return;
    setIsPrinting(true);
    try {
      const result = await window.electron.printDocument(documentId);
      if (!result.success) {
        toast.error(result.error.message);
      }
    } catch (error) {
      toast.error('Print failed');
    } finally {
      setIsPrinting(false);
    }
  };

  // Drag / Resize corner point handlers
  const handleMouseDown = (e: React.MouseEvent, type: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragStart({ x: e.clientX, y: e.clientY });
    setDragType(type);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart || !dragType || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const deltaX = ((e.clientX - dragStart.x) / containerRect.width) * 100;
    const deltaY = ((e.clientY - dragStart.y) / containerRect.height) * 100;

    if (dragType === 'sigMove') {
      setSigPosition((prev) => ({
        ...prev,
        x: Math.max(0, Math.min(100 - prev.width, prev.x + deltaX)),
        y: Math.max(0, Math.min(100 - prev.height, prev.y + deltaY))
      }));
    } else if (dragType === 'sigResize') {
      setSigPosition((prev) => ({
        ...prev,
        width: Math.max(5, Math.min(100 - prev.x, prev.width + deltaX)),
        height: Math.max(3, Math.min(100 - prev.y, prev.height + deltaY))
      }));
    } else if (['tl', 'tr', 'bl', 'br'].includes(dragType)) {
      const newX = Math.max(0, Math.min(100, ((e.clientX - containerRect.left) / containerRect.width) * 100));
      const newY = Math.max(0, Math.min(100, ((e.clientY - containerRect.top) / containerRect.height) * 100));
      setCropBox((prev) => ({
        ...prev,
        [dragType]: { x: newX, y: newY }
      }));
    }

    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setDragStart(null);
    setDragType(null);
  };

  if (!isOpen || !doc) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title={isEditing ? `Edit: ${doc.filename}` : doc.filename}
      size="lg"
      showCloseButton={!isProcessing}
    >
      <div 
        className="flex flex-col gap-6"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Main Workspace */}
        <div className="flex flex-col md:flex-row gap-6 items-stretch">
          
          {/* Document Content View / Canvas Editor */}
          <div className="flex-1 flex justify-center items-center bg-bg-sunken rounded-xl p-4 min-h-[380px] max-h-[500px] border border-border relative overflow-hidden select-none">
            {!isEditing ? (
              doc.type === 'PDF' ? (
                // PDF native viewer iframe using docuflow custom protocol
                <iframe
                  src={`docuflow:///${doc.tempPath.replace(/\\/g, '/')}`}
                  title={doc.filename}
                  className="w-full h-full min-h-[440px] border-none rounded-lg bg-white"
                />
              ) : (
                // Image View using docuflow protocol
                <img
                  src={`docuflow:///${doc.tempPath.replace(/\\/g, '/')}`}
                  alt={doc.filename}
                  className="max-w-full max-h-[460px] rounded-lg shadow-sm object-contain"
                />
              )
            ) : (
              // Edit Mode Canvas + Overlays
              <div 
                ref={containerRef}
                className="relative max-w-full max-h-[460px] flex items-center justify-center"
              >
                <canvas 
                  ref={canvasRef} 
                  className="max-w-full max-h-[460px] object-contain rounded-lg shadow-md bg-white"
                />
                
                {/* Perspective Crop Overlay */}
                {activeTab === EditTab.CROP && (
                  <div className="absolute inset-0 w-full h-full">
                    {/* SVG Connector lines */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
                      <polygon
                        points={`${cropBox.tl.x}%,${cropBox.tl.y}% ${cropBox.tr.x}%,${cropBox.tr.y}% ${cropBox.br.x}%,${cropBox.br.y}% ${cropBox.bl.x}%,${cropBox.bl.y}%`}
                        className="stroke-accent stroke-2 fill-accent/10"
                      />
                    </svg>
                    
                    {/* Corner Handles */}
                    <div 
                      className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20"
                      style={{ left: `${cropBox.tl.x}%`, top: `${cropBox.tl.y}%` }}
                      onMouseDown={(e) => handleMouseDown(e, 'tl')}
                    />
                    <div 
                      className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20"
                      style={{ left: `${cropBox.tr.x}%`, top: `${cropBox.tr.y}%` }}
                      onMouseDown={(e) => handleMouseDown(e, 'tr')}
                    />
                    <div 
                      className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20"
                      style={{ left: `${cropBox.bl.x}%`, top: `${cropBox.bl.y}%` }}
                      onMouseDown={(e) => handleMouseDown(e, 'bl')}
                    />
                    <div 
                      className="absolute w-5 h-5 bg-accent border-2 border-white rounded-full cursor-pointer -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform z-20"
                      style={{ left: `${cropBox.br.x}%`, top: `${cropBox.br.y}%` }}
                      onMouseDown={(e) => handleMouseDown(e, 'br')}
                    />
                  </div>
                )}

                {/* Floating Resizable Signature Overlay */}
                {activeTab === EditTab.SIGNATURE && signatureImage && (
                  <div
                    className="absolute border border-dashed border-accent bg-accent/5 cursor-move z-10"
                    style={{
                      left: `${sigPosition.x}%`,
                      top: `${sigPosition.y}%`,
                      width: `${sigPosition.width}%`,
                      height: `${sigPosition.height}%`,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'sigMove')}
                  >
                    <img
                      src={signatureImage.src}
                      alt="Signature overlay"
                      className="w-full h-full object-contain pointer-events-none"
                    />
                    {/* Delete signature item */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSignatureImage(null);
                      }}
                      className="absolute -top-2 -right-2 bg-error text-white rounded-full p-0.5 hover:bg-error-dark shadow z-20"
                      title="Remove Signature"
                    >
                      <X size={12} />
                    </button>
                    {/* Resize handle */}
                    <div
                      className="absolute -bottom-1 -right-1 w-3 h-3 bg-accent border border-white cursor-se-resize z-20"
                      onMouseDown={(e) => handleMouseDown(e, 'sigResize')}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
 
          {/* Sidebar / Tools Control */}
          <div className="w-full md:w-60 flex flex-col gap-4">
            {!isEditing ? (
              /* View Mode Controls */
              <div className="flex flex-col gap-3 justify-center h-full">
                <div className="p-4 bg-bg-surface rounded-xl border border-border flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase text-text-muted">Properties</span>
                  <div className="flex justify-between text-sm font-mono"><span className="text-text-secondary">Type:</span> <span>{doc.type}</span></div>
                  <div className="flex justify-between text-sm font-mono"><span className="text-text-secondary">Pages:</span> <span>{doc.pageCount}</span></div>
                  <div className="flex justify-between text-sm font-mono"><span className="text-text-secondary">Size:</span> <span>{(doc.size / 1024 / 1024).toFixed(2)} MB</span></div>
                </div>
 
                <Button 
                  variant="primary" 
                  className="w-full justify-center py-3"
                  onClick={handlePrint}
                  disabled={isPrinting}
                >
                  <Printer size={18} className="mr-2" />
                  {isPrinting ? 'Preparing Print...' : 'Print Document'}
                </Button>
 
                {doc.type === 'IMAGE' && (
                  <Button 
                    variant="secondary" 
                    className="w-full justify-center py-3"
                    onClick={() => setIsEditing(true)}
                  >
                    <Crop size={18} className="mr-2" />
                    Edit Document
                  </Button>
                )}
 
                <Button 
                  variant="ghost" 
                  className="w-full justify-center"
                  onClick={closeModal}
                >
                  Close Preview
                </Button>
              </div>
            ) : (
              /* Edit Mode Controls */
              <div className="flex flex-col gap-4 h-full">
                {/* Tabs */}
                <div className="flex border-b border-border bg-bg-sunken p-1 rounded-lg">
                  <button
                    onClick={() => setActiveTab(EditTab.FILTERS)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.FILTERS ? 'bg-bg-surface text-accent shadow-sm' : 'text-text-secondary'}`}
                  >
                    Filters
                  </button>
                  <button
                    onClick={() => setActiveTab(EditTab.CROP)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.CROP ? 'bg-bg-surface text-accent shadow-sm' : 'text-text-secondary'}`}
                  >
                    Crop Box
                  </button>
                  <button
                    onClick={() => setActiveTab(EditTab.SIGNATURE)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-fast ${activeTab === EditTab.SIGNATURE ? 'bg-bg-surface text-accent shadow-sm' : 'text-text-secondary'}`}
                  >
                    Signature
                  </button>
                </div>
 
                {/* Tab Content */}
                <div className="flex-1 flex flex-col gap-3 justify-start">
                  {activeTab === EditTab.FILTERS && (
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-semibold text-text-muted uppercase">Image Enhancements</span>
                      <Button 
                        variant="secondary" 
                        className="w-full justify-start text-sm"
                        onClick={() => applyFilter('clean')}
                      >
                        <Sparkles size={16} className="mr-2 text-accent" />
                        Clean & De-noise
                      </Button>
                      <Button 
                        variant="secondary" 
                        className="w-full justify-start text-sm"
                        onClick={() => applyFilter('grayscale')}
                      >
                        <Sliders size={16} className="mr-2" />
                        Convert to Grayscale
                      </Button>
                      <Button 
                        variant="secondary" 
                        className="w-full justify-start text-sm"
                        onClick={() => applyFilter('binarize')}
                      >
                        <ShieldAlert size={16} className="mr-2" />
                        Crisp Black & White
                      </Button>
                      <Button 
                        variant="ghost" 
                        className="w-full justify-start text-sm"
                        onClick={resetCanvas}
                      >
                        <RotateCcw size={16} className="mr-2" />
                        Reset Filters
                      </Button>
                    </div>
                  )}

                  {activeTab === EditTab.CROP && (
                    <div className="flex flex-col gap-3">
                      <span className="text-xs font-semibold text-text-muted uppercase">Perspective Crop</span>
                      <p className="text-xs text-text-secondary">Drag the 4 corner handles individually to select any shape. After crop, the selected area will flatten into a 90-degree rectangle.</p>
                      
                      <Button 
                        variant="primary" 
                        className="w-full justify-center"
                        onClick={executeCrop}
                      >
                        <Check size={16} className="mr-2" />
                        Apply Crop
                      </Button>
                      <Button 
                        variant="ghost" 
                        className="w-full justify-start text-sm"
                        onClick={resetCanvas}
                      >
                        <RotateCcw size={16} className="mr-2" />
                        Reset Crop
                      </Button>
                    </div>
                  )}

                  {activeTab === EditTab.SIGNATURE && (
                    <div className="flex flex-col gap-3">
                      <span className="text-xs font-semibold text-text-muted uppercase">Draw Signature</span>
                      {!signatureImage ? (
                        <div className="space-y-2">
                          <canvas
                            ref={sigCanvasRef}
                            width={220}
                            height={120}
                            className="border border-border bg-white rounded-md cursor-crosshair touch-none"
                            onMouseDown={startSigDrawing}
                            onMouseMove={drawSigLine}
                            onMouseUp={endSigDrawing}
                            onMouseLeave={endSigDrawing}
                            onTouchStart={startSigDrawingTouch}
                            onTouchMove={drawSigLineTouch}
                            onTouchEnd={endSigDrawing}
                          />
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={clearSigPad} className="flex-1 text-xs">
                              Clear
                            </Button>
                            <Button variant="primary" size="sm" onClick={handleAddSignature} className="flex-1 text-xs">
                              Add to Doc
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-text-secondary">Drag and resize the signature box on the document.</p>
                          <Button 
                            variant="primary" 
                            className="w-full justify-center"
                            onClick={handleApplySignature}
                          >
                            <Check size={16} className="mr-2" />
                            Apply Signature
                          </Button>
                          <Button 
                            variant="ghost" 
                            className="w-full justify-center"
                            onClick={() => setSignatureImage(null)}
                          >
                            Redraw
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
 
                {/* Bottom Save Actions */}
                <div className="border-t border-border pt-4 flex flex-col gap-2">
                  <Button 
                    variant="primary" 
                    className="w-full justify-center py-2.5 bg-success hover:bg-success-dark text-white border-none"
                    onClick={handleSaveEdit}
                    disabled={isProcessing}
                  >
                    {isProcessing ? 'Saving Edits...' : 'Save & Overwrite'}
                  </Button>
                  <Button 
                    variant="ghost" 
                    className="w-full justify-center"
                    onClick={() => {
                      setIsEditing(false);
                      setSignatureImage(null);
                      toast.error('Changes discarded');
                    }}
                    disabled={isProcessing}
                  >
                    Cancel Edit
                  </Button>
                </div>
              </div>
            )}
          </div>
 
        </div>
      </div>
    </Modal>
  );
}

export default DocumentPreviewModal;
