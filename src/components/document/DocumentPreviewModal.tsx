import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import { ModalType } from '../../types/UI.types';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { 
  Printer, Crop, ShieldAlert, Sparkles, 
  RotateCcw, RotateCw, Sliders, Check, X
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
  const editedImageRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);

  const [activeFilter, setActiveFilter] = useState<'grayscale' | 'binarize' | 'clean' | null>(null);

  // 4 Corner Perspective Crop State
  const [cropBox, setCropBox] = useState<QuadCrop>({
    tl: { x: 10, y: 10 },
    tr: { x: 90, y: 10 },
    bl: { x: 10, y: 90 },
    br: { x: 90, y: 90 }
  });

  // OpenCV corner detection state
  const [cvStatus, setCvStatus] = useState<'unloaded' | 'loading' | 'loaded' | 'error'>('unloaded');
  const [hasAutoDetected, setHasAutoDetected] = useState(false);

  // Reset auto detect flag when editing ends
  useEffect(() => {
    if (!isEditing) {
      setHasAutoDetected(false);
    }
  }, [isEditing]);

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
        editedImageRef.current = img;
        setActiveFilter(null);
        resetCanvas();
      };
    }
  }, [isOpen, isEditing, doc]);

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
    setSignatureImage(null);
  };

  // Load OpenCV helper script
  const loadOpenCV = () => {
    console.log('[Renderer] loadOpenCV called. Current cvStatus:', cvStatus, 'window.cv:', typeof window.cv);
    
    if (window.cv) {
      if (window.cv.Mat) {
        console.log('[Renderer] OpenCV is already loaded with cv.Mat available.');
        setCvStatus('loaded');
        return;
      }
      if (window.cv instanceof Promise) {
        console.log('[Renderer] OpenCV is currently a Promise. Waiting for resolution...');
        setCvStatus('loading');
        window.cv.then((resolvedCv: any) => {
          console.log('[Renderer] OpenCV Promise resolved successfully.');
          window.cv = resolvedCv;
          setCvStatus('loaded');
        }).catch((err: any) => {
          console.error('[Renderer] OpenCV Promise rejected:', err);
          setCvStatus('error');
        });
        return;
      }
    }
    
    if (cvStatus === 'loading') return;

    setCvStatus('loading');

    window.Module = {
      onRuntimeInitialized: () => {
        console.log('[Renderer] window.Module.onRuntimeInitialized triggered successfully.');
        setCvStatus('loaded');
      }
    };

    const existingScript = document.getElementById('opencv-script');
    if (existingScript) {
      console.log('[Renderer] OpenCV script element already exists.');
      return;
    }

    const script = document.createElement('script');
    script.id = 'opencv-script';
    script.src = '/opencv.js';
    script.async = true;
    
    script.onload = () => {
      console.log('[Renderer] opencv.js script element onload triggered. window.cv:', typeof window.cv);
      
      if (window.cv) {
        if (window.cv.Mat) {
          console.log('[Renderer] Direct cv.Mat is available on script load.');
          setCvStatus('loaded');
        } else if (window.cv instanceof Promise) {
          console.log('[Renderer] window.cv is a Promise. Resolving...');
          window.cv.then((resolvedCv: any) => {
            console.log('[Renderer] window.cv Promise resolved.');
            window.cv = resolvedCv;
            setCvStatus('loaded');
          }).catch((err: any) => {
            console.error('[Renderer] window.cv Promise failed to resolve:', err);
            setCvStatus('error');
          });
        } else if (typeof window.cv === 'function') {
          console.log('[Renderer] window.cv is a constructor function. Executing...');
          try {
            window.cv().then((resolvedCv: any) => {
              console.log('[Renderer] window.cv constructor promise resolved.');
              window.cv = resolvedCv;
              setCvStatus('loaded');
            }).catch((err: any) => {
              console.error('[Renderer] window.cv constructor promise failed:', err);
            });
          } catch (e) {
            console.log('[Renderer] window.cv constructor execution failed directly, waiting for Module.onRuntimeInitialized');
          }
        }
      }
    };
    
    script.onerror = (e) => {
      console.error('[Renderer] Failed to load OpenCV script element:', e);
      setCvStatus('error');
      toast.error('Failed to load OpenCV helper for auto-crop');
    };
    
    document.body.appendChild(script);
  };

  // Run OpenCV Canny Edge & Contour detection to find document corners
  const detectDocumentCorners = () => {
    console.log('[Renderer] detectDocumentCorners initiated. window.cv:', typeof window.cv);
    const canvas = canvasRef.current;
    if (!canvas) {
      console.warn('[Renderer] Canvas ref is empty in detectDocumentCorners');
      return;
    }
    if (!window.cv) {
      console.warn('[Renderer] window.cv is empty in detectDocumentCorners');
      return;
    }

    const cv = window.cv;
    console.log('[Renderer] Canvas dimensions:', canvas.width, 'x', canvas.height);

    let src;
    try {
      src = cv.imread(canvas);
      console.log('[Renderer] cv.imread successful. Shape:', src.rows, 'x', src.cols);
    } catch (readErr) {
      console.error('[Renderer] Error reading canvas via cv.imread:', readErr);
      toast.error('Error reading image for detection.');
      return;
    }

    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let edged = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
      // 1. Convert to grayscale
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

      // 2. Blur to filter noise
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

      // 3. Detect edges
      cv.Canny(blurred, edged, 75, 200, 3);

      // 4. Find contours
      cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      console.log('[Renderer] Number of contours detected:', contours.size());

      const totalArea = canvas.width * canvas.height;
      let maxArea = 0;
      let approx = new cv.Mat();
      let foundQuad = false;
      let finalPoints: { x: number; y: number }[] = [];

      // Pass 1: Try to find a perfect 4-sided polygon (quadrilateral)
      for (let i = 0; i < contours.size(); ++i) {
        let cnt = contours.get(i);
        let area = cv.contourArea(cnt);

        // Ignore contours that are basically the entire canvas border (>98% area)
        if (area > 1000 && area < totalArea * 0.98 && area > maxArea) {
          let peri = cv.arcLength(cnt, true);
          let tempApprox = new cv.Mat();
          cv.approxPolyDP(cnt, tempApprox, 0.02 * peri, true);

          // Check if approximated polygon has 4 vertices (quadrilateral)
          if (tempApprox.rows === 4) {
            maxArea = area;
            if (approx) approx.delete();
            approx = tempApprox;
            foundQuad = true;
          } else {
            tempApprox.delete();
          }
        }
      }
      console.log('[Renderer] Pass 1: foundQuad =', foundQuad, 'maxArea =', maxArea);

      // Pass 2: Fallback - if no perfect 4-sided polygon found, find the largest contour and use its bounding box
      if (!foundQuad) {
        let largestContourIdx = -1;
        let largestArea = 0;
        for (let i = 0; i < contours.size(); ++i) {
          let cnt = contours.get(i);
          let area = cv.contourArea(cnt);
          if (area > 1000 && area < totalArea * 0.98 && area > largestArea) {
            largestArea = area;
            largestContourIdx = i;
          }
        }
        console.log('[Renderer] Pass 2: largestContourIdx =', largestContourIdx, 'largestArea =', largestArea);

        if (largestContourIdx !== -1) {
          let cnt = contours.get(largestContourIdx);
          let rect = cv.boundingRect(cnt);
          finalPoints = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.width, y: rect.y },
            { x: rect.x, y: rect.y + rect.height },
            { x: rect.x + rect.width, y: rect.y + rect.height }
          ];
          foundQuad = true;
          console.log('[Renderer] Pass 2: using bounding box of largest contour:', rect.x, rect.y, rect.width, rect.height);
        }
      } else if (approx && approx.rows === 4) {
        for (let i = 0; i < 4; i++) {
          const x = approx.data32S[i * 2];
          const y = approx.data32S[i * 2 + 1];
          finalPoints.push({ x, y });
        }
      }

      if (foundQuad && finalPoints.length === 4) {
        // Sort points: tl, tr, bl, br
        const points = [...finalPoints];
        const sums = points.map(p => p.x + p.y);
        const diffs = points.map(p => p.x - p.y);

        const tlIndex = sums.indexOf(Math.min(...sums));
        const brIndex = sums.indexOf(Math.max(...sums));

        const remainingIndices = [0, 1, 2, 3].filter(idx => idx !== tlIndex && idx !== brIndex);
        let trIndex = remainingIndices[0];
        let blIndex = remainingIndices[1];

        if (diffs[trIndex] < diffs[blIndex]) {
          const temp = trIndex;
          trIndex = blIndex;
          blIndex = temp;
        }

        const tl = points[tlIndex];
        const tr = points[trIndex];
        const bl = points[blIndex];
        const br = points[brIndex];

        // Convert coordinates to percentages of canvas size
        const clamp = (val: number) => Math.max(0, Math.min(100, val));
        const newBox = {
          tl: { x: clamp((tl.x / canvas.width) * 100), y: clamp((tl.y / canvas.height) * 100) },
          tr: { x: clamp((tr.x / canvas.width) * 100), y: clamp((tr.y / canvas.height) * 100) },
          bl: { x: clamp((bl.x / canvas.width) * 100), y: clamp((bl.y / canvas.height) * 100) },
          br: { x: clamp((br.x / canvas.width) * 100), y: clamp((br.y / canvas.height) * 100) }
        };
        console.log('[Renderer] Setting crop handles:', newBox);
        setCropBox(newBox);

        toast.success('Document detected automatically!');
      } else {
        console.log('[Renderer] No valid document shape or fallback bounding box was found.');
        toast.error('Could not clearly detect document. Try manual adjustments.');
      }

      if (approx) approx.delete();
    } catch (err) {
      console.error('[Renderer] OpenCV error during corner detection:', err);
      toast.error('Error during auto-corner detection.');
    } finally {
      src.delete();
      gray.delete();
      blurred.delete();
      edged.delete();
      contours.delete();
      hierarchy.delete();
    }
  };

  // Trigger OpenCV load when crop tab is selected and automatically run corner detection once loaded
  useEffect(() => {
    if (isOpen && isEditing && activeTab === EditTab.CROP) {
      loadOpenCV();
      if (cvStatus === 'loaded' && !hasAutoDetected) {
        console.log('[Renderer] OpenCV loaded. Scheduling auto-detect corners in 100ms...');
        const timer = setTimeout(() => {
          detectDocumentCorners();
          setHasAutoDetected(true);
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, isEditing, activeTab, cvStatus, hasAutoDetected]);

  const applyFilterPixels = (canvas: HTMLCanvasElement, filterType: 'grayscale' | 'binarize' | 'clean') => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
    toast.success(`${filterType.charAt(0).toUpperCase() + filterType.slice(1)} filter applied`);
  };

  // Perform 4-corner perspective warp crop
  const executeCrop = () => {
    const canvas = canvasRef.current;
    const img = editedImageRef.current || originalImageRef.current;
    if (!canvas || !img) return;

    // Convert crop corner percentages to pixel coordinates based on img width/height
    const pTL = { x: (cropBox.tl.x / 100) * img.width, y: (cropBox.tl.y / 100) * img.height };
    const pTR = { x: (cropBox.tr.x / 100) * img.width, y: (cropBox.tr.y / 100) * img.height };
    const pBL = { x: (cropBox.bl.x / 100) * img.width, y: (cropBox.bl.y / 100) * img.height };
    const pBR = { x: (cropBox.br.x / 100) * img.width, y: (cropBox.br.y / 100) * img.height };

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
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    tempCtx.drawImage(img, 0, 0);

    // Create cropped canvas for destination
    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = dstWidth;
    croppedCanvas.height = dstHeight;

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

    // Warp perspective
    warpPerspective(tempCanvas, croppedCanvas, matrix, dstWidth, dstHeight);

    // Save the cropped version
    editedImageRef.current = croppedCanvas;

    // Reset crop handles to standard quad box
    setCropBox({
      tl: { x: 10, y: 10 },
      tr: { x: 90, y: 10 },
      bl: { x: 10, y: 90 },
      br: { x: 90, y: 90 }
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

    // Rotate signature if present
    if (signatureImage) {
      const rotatedSigImgSrc = await rotateBase64Image(signatureImage.src, clockwise);
      const newSigImg = new Image();
      newSigImg.src = rotatedSigImgSrc;
      newSigImg.onload = () => {
        setSignatureImage(newSigImg);
      };

      const newX = clockwise ? 100 - sigPosition.y - sigPosition.height : sigPosition.y;
      const newY = clockwise ? sigPosition.x : 100 - sigPosition.x - sigPosition.width;
      setSigPosition({
        x: newX,
        y: newY,
        width: sigPosition.height,
        height: sigPosition.width
      });
    }

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

    setSignatureImage(null);
    redrawCanvas();
    toast.success('Crop and rotation reset');
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
                        onClick={handleResetFilters}
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
                      
                      {cvStatus === 'loaded' ? (
                        <Button 
                          variant="secondary" 
                          className="w-full justify-center text-sm border-accent text-accent hover:bg-accent/5"
                          onClick={detectDocumentCorners}
                        >
                          <Sparkles size={16} className="mr-2" />
                          Auto Detect Corners
                        </Button>
                      ) : cvStatus === 'loading' ? (
                        <div className="flex items-center justify-center gap-2 p-2 bg-bg-sunken border border-border rounded-md text-xs text-text-secondary">
                          <span className="animate-spin h-3.5 w-3.5 border-2 border-accent border-t-transparent rounded-full" />
                          Loading Auto-Crop helper...
                        </div>
                      ) : (
                        <Button 
                          variant="secondary" 
                          className="w-full justify-center text-sm border-dashed text-text-secondary hover:bg-bg-sunken"
                          onClick={loadOpenCV}
                        >
                          Enable Auto-Detect
                        </Button>
                      )}

                      <div className="border-t border-border my-1" />
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
                        className="w-full justify-center"
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
