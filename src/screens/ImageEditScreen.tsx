import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Upload,
  Check,
  Download,
  Loader2,
  Camera,
  Scissors,
  Paintbrush,
  Grid,
  RefreshCw,
  Plus,
  Minus,
  Droplet,
  Eraser,
  Undo2,
  Sparkles
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { OutputFormat } from '../types/Output.types';
import Button from '../components/ui/Button';
import { PDFDocument } from 'pdf-lib';
import { removeBackground } from '@imgly/background-removal';

/* ─── Types ─── */
type EditorStep = 'CROP' | 'BG_REMOVE' | 'LAYOUT';

interface PhotoSizeOption {
  id: string;
  name: string;
  desc: string;
  wMm: number;
  hMm: number;
}

/* ─── Constants ─── */
const SIZE_OPTIONS: PhotoSizeOption[] = [
  { id: 'indian', name: 'Indian Passport', desc: '3.5 × 4.5 cm (35 × 45 mm)', wMm: 35, hMm: 45 },
  { id: 'us', name: 'US Passport / Visa', desc: '2 × 2 inches (51 × 51 mm)', wMm: 51, hMm: 51 },
  { id: 'canadian', name: 'Canadian Passport', desc: '5.0 × 7.0 cm (50 × 70 mm)', wMm: 50, hMm: 70 },
  { id: 'custom', name: 'Custom Size', desc: 'Set your own width × height', wMm: 35, hMm: 45 },
];

const PRESET_BG_COLORS = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Light Blue', hex: '#ADD8E6' },
  { name: 'Royal Blue', hex: '#4169E1' },
  { name: 'Light Grey', hex: '#D3D3D3' },
  { name: 'Red', hex: '#FF0000' },
];

// A4 at 300 DPI
const A4_W = 2480;
const A4_H = 3508;

/* ─── Helper: mm → 300 DPI pixels ─── */
const mmToPx = (mm: number) => Math.round((mm / 25.4) * 300);

export default function ImageEditScreen() {
  const setView = useAppStore((s) => s.setView);

  /* ── Workflow step ── */
  const [step, setStep] = useState<EditorStep>('CROP');

  /* ── Source image (base64 data-url or docuflow:// url) ── */
  const [sourceImgSrc, setSourceImgSrc] = useState<string | null>(() => {
    const state = useAppStore.getState();
    const docs = state.documents;
    const selId = state.ui.selectedDocumentId;
    let doc = docs.find((d) => d.id === selId && d.type === 'IMAGE');
    if (!doc) {
      doc = docs.find((d) => d.type === 'IMAGE');
    }
    return doc ? `docuflow:///${doc.tempPath.replace(/\\/g, '/')}` : null;
  });

  const handleCancel = async () => {
    if (sourceImgSrc) {
      const confirmed = await useAppStore.getState().showConfirm(
        'Are you sure you want to exit Passport Photo Maker? Any unsaved edits will be lost.',
        'Exit Passport Photo'
      );
      if (!confirmed) return;
    }
    setView(AppView.HOME);
  };

  /* ── Step 1 – Crop ── */
  const [selectedSizeId, setSelectedSizeId] = useState('indian');
  const [customWidth, setCustomWidth] = useState(35);
  const [customHeight, setCustomHeight] = useState(45);

  // The crop rectangle stored as pixel offsets relative to the *displayed* image element.
  // We track these in "image-natural-pixel" space so that the overlay is always accurate
  // regardless of CSS scaling.
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const [dragMode, setDragMode] = useState<string | null>(null);
  const [dragAnchor, setDragAnchor] = useState<{ mx: number; my: number; rect: typeof cropRect } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const cropWrapRef = useRef<HTMLDivElement>(null);

  /* ── Step 2 – Background removal ── */
  const [croppedBase64, setCroppedBase64] = useState<string | null>(null);
  const [bgTolerance, setBgTolerance] = useState(30);
  const [bgFeather, setBgFeather] = useState(2);
  const [targetBg, setTargetBg] = useState('#FFFFFF');
  const [brushMode, setBrushMode] = useState<'auto' | 'eyedropper' | 'erase' | 'restore' | 'ai'>('auto');
  const [brushSize, setBrushSize] = useState(20);
  const [isPainting, setIsPainting] = useState(false);
  const [aiProgress, setAiProgress] = useState<string | null>(null);

  const srcCanvasRef = useRef<HTMLCanvasElement>(null);   // original cropped pixels (never mutated)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);   // alpha mask: white=keep, transparent=remove
  const compCanvasRef = useRef<HTMLCanvasElement>(null);   // final composited preview

  /* ── Step 3 – Layout & export ── */
  const [compositedBase64, setCompositedBase64] = useState('');
  const [layoutMode, setLayoutMode] = useState<'individual' | 'a4' | '3by4' | 'custom'>('3by4');
  const [customCols, setCustomCols] = useState(4);
  const [customRows, setCustomRows] = useState(4);
  const [exporting, setExporting] = useState(false);
  const [filename, setFilename] = useState('passport_photos');
  const [layoutPreviewUrl, setLayoutPreviewUrl] = useState('');

  /* ═══════════════════════════════════════════
   *  Derived values
   * ═══════════════════════════════════════════ */
  const getActiveSize = useCallback(() => {
    const found = SIZE_OPTIONS.find((s) => s.id === selectedSizeId);
    if (!found) return { wMm: 35, hMm: 45 };
    if (found.id === 'custom') return { wMm: customWidth, hMm: customHeight };
    return { wMm: found.wMm, hMm: found.hMm };
  }, [selectedSizeId, customWidth, customHeight]);

  const getAspect = useCallback(() => {
    const sz = getActiveSize();
    return sz.wMm / sz.hMm;
  }, [getActiveSize]);

  /* ═══════════════════════════════════════════
   *  Step 1 – Image upload
   * ═══════════════════════════════════════════ */
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setSourceImgSrc(ev.target.result as string);
          setStep('CROP');
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleBrowseImage = async () => {
    try {
      const result = await window.electron.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
      });
      if (result.success && result.data && result.data.length > 0) {
        const filePath = result.data[0];
        const validation = await window.electron.validateFile(filePath);
        if (validation.success && validation.data.type === 'IMAGE') {
          setSourceImgSrc(`docuflow:///${filePath.replace(/\\/g, '/')}`);
          setStep('CROP');
        } else {
          toast.error('Selected file is not a valid image');
        }
      }
    } catch {
      toast.error('Failed to select file');
    }
  };

  /* ═══════════════════════════════════════════
   *  Step 1 – Crop frame logic
   *
   *  The crop rectangle is stored in "natural image pixel" coordinates.
   *  The overlay <div> is positioned using percentage offsets relative
   *  to the <img> element's rendered size, which guarantees a pixel-
   *  perfect match regardless of how CSS scales the image on screen.
   * ═══════════════════════════════════════════ */

  // Whenever the source image loads (or size option changes), reset the crop box
  // to a centered rectangle with the correct aspect ratio.
  const resetCropToCenter = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;

    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    const aspect = getAspect();

    // Try to fill 70% of the image height, then compute width from aspect
    let ch = natH * 0.7;
    let cw = ch * aspect;

    // If it's wider than the image, fit by width instead
    if (cw > natW * 0.9) {
      cw = natW * 0.9;
      ch = cw / aspect;
    }

    const cx = (natW - cw) / 2;
    const cy = (natH - ch) / 2;
    setCropRect({ x: cx, y: cy, w: cw, h: ch });
  }, [getAspect]);

  // When the selected size changes, re-center crop
  useEffect(() => {
    if (sourceImgSrc && step === 'CROP') {
      // Delay slightly so the image element has loaded
      const timer = setTimeout(resetCropToCenter, 100);
      return () => clearTimeout(timer);
    }
  }, [selectedSizeId, customWidth, customHeight, sourceImgSrc, step, resetCropToCenter]);

  // Called when the <img> element finishes loading
  const handleImgLoad = () => {
    resetCropToCenter();
  };


  const handleCropMouseDown = (e: React.MouseEvent, mode: string) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDraggingCrop(true);
    setDragMode(mode);
    setDragAnchor({ mx: e.clientX, my: e.clientY, rect: { ...cropRect } });
  };

  useEffect(() => {
    if (!isDraggingCrop) return;

    const onMove = (e: MouseEvent) => {
      if (!dragAnchor || !imgRef.current) return;
      const img = imgRef.current;
      const natW = img.naturalWidth;
      const natH = img.naturalHeight;
      const r = img.getBoundingClientRect();
      const sx = natW / r.width;
      const sy = natH / r.height;

      const dxNat = (e.clientX - dragAnchor.mx) * sx;
      const dyNat = (e.clientY - dragAnchor.my) * sy;
      const prev = dragAnchor.rect;
      const aspect = getAspect();

      const next = { ...prev };

      if (dragMode === 'move') {
        next.x = Math.max(0, Math.min(natW - prev.w, prev.x + dxNat));
        next.y = Math.max(0, Math.min(natH - prev.h, prev.y + dyNat));
      } else {
        // For corner drags, determine the dominant axis of movement and resize
        // while preserving aspect ratio. The "anchored" opposite corner stays fixed.
        const absDx = Math.abs(dxNat);
        const absDy = Math.abs(dyNat);
        // Convert dy to equivalent width change for comparison
        const dyAsW = absDy * aspect;
        const useDx = absDx >= dyAsW;

        if (dragMode === 'br') {
          let nw = useDx ? prev.w + dxNat : prev.w + dyNat * aspect;
          nw = Math.max(40, Math.min(natW - prev.x, nw));
          let nh = nw / aspect;
          if (prev.y + nh > natH) { nh = natH - prev.y; nw = nh * aspect; }
          next.w = nw; next.h = nh;
        } else if (dragMode === 'bl') {
          let nw = useDx ? prev.w - dxNat : prev.w + dyNat * aspect;
          const right = prev.x + prev.w;
          nw = Math.max(40, Math.min(right, nw));
          let nh = nw / aspect;
          if (prev.y + nh > natH) { nh = natH - prev.y; nw = nh * aspect; }
          next.x = right - nw; next.w = nw; next.h = nh;
        } else if (dragMode === 'tr') {
          let nw = useDx ? prev.w + dxNat : prev.w - dyNat * aspect;
          nw = Math.max(40, Math.min(natW - prev.x, nw));
          let nh = nw / aspect;
          const bottom = prev.y + prev.h;
          if (bottom - nh < 0) { nh = bottom; nw = nh * aspect; }
          next.y = bottom - nh; next.w = nw; next.h = nh;
        } else if (dragMode === 'tl') {
          let nw = useDx ? prev.w - dxNat : prev.w - dyNat * aspect;
          const right = prev.x + prev.w;
          const bottom = prev.y + prev.h;
          nw = Math.max(40, Math.min(right, nw));
          let nh = nw / aspect;
          if (bottom - nh < 0) { nh = bottom; nw = nh * aspect; }
          next.x = right - nw; next.y = bottom - nh; next.w = nw; next.h = nh;
        }
      }

      setCropRect(next);
    };

    const onUp = () => {
      setIsDraggingCrop(false);
      setDragMode(null);
      setDragAnchor(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDraggingCrop, dragAnchor, dragMode, getAspect]);

  // Convert crop rect (natural pixels) → CSS percentage for overlay positioning
  const cropOverlayStyle = (): React.CSSProperties => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return { display: 'none' };
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    return {
      left: `${(cropRect.x / natW) * 100}%`,
      top: `${(cropRect.y / natH) * 100}%`,
      width: `${(cropRect.w / natW) * 100}%`,
      height: `${(cropRect.h / natH) * 100}%`,
    };
  };

  /* ═══════════════════════════════════════════
   *  Step 1 → Step 2 transition: perform the crop
   * ═══════════════════════════════════════════ */
  const handleNextToBgRemove = () => {
    if (!sourceImgSrc) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = sourceImgSrc;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clamp crop to image bounds
      const cx = Math.max(0, Math.round(cropRect.x));
      const cy = Math.max(0, Math.round(cropRect.y));
      const cw = Math.round(Math.min(cropRect.w, img.naturalWidth - cx));
      const ch = Math.round(Math.min(cropRect.h, img.naturalHeight - cy));

      canvas.width = cw;
      canvas.height = ch;
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);

      setCroppedBase64(canvas.toDataURL('image/png'));
      setStep('BG_REMOVE');
      setBrushMode('auto');
    };
  };

  /* ═══════════════════════════════════════════
   *  Step 2 – Background removal engine
   *
   *  Architecture:
   *    srcCanvas  – immutable copy of the cropped photo pixels
   *    maskCanvas – RGBA canvas where alpha=255 means "keep" and alpha=0 means "remove"
   *    compCanvas – final composite: target background colour + masked photo
   *
   *  The mask stores keepness in the ALPHA channel. White opaque = keep.
   *  Transparent = remove. This allows `destination-in` compositing to work
   *  correctly when building the composite.
   * ═══════════════════════════════════════════ */

  // Initialize canvases when entering Step 2
  useEffect(() => {
    if (step !== 'BG_REMOVE' || !croppedBase64) return;

    const img = new Image();
    img.src = croppedBase64;
    img.onload = () => {
      const w = img.width;
      const h = img.height;

      const srcC = srcCanvasRef.current;
      const maskC = maskCanvasRef.current;
      const compC = compCanvasRef.current;
      if (!srcC || !maskC || !compC) return;

      srcC.width = w; srcC.height = h;
      maskC.width = w; maskC.height = h;
      compC.width = w; compC.height = h;

      // Draw source image (immutable reference)
      const srcCtx = srcC.getContext('2d');
      if (srcCtx) srcCtx.drawImage(img, 0, 0);

      // Initialize mask to fully opaque white (keep everything)
      const maskCtx = maskC.getContext('2d');
      if (maskCtx) {
        maskCtx.fillStyle = 'rgba(255,255,255,1)';
        maskCtx.fillRect(0, 0, w, h);
      }

      // Run the auto keyer
      runAutoBackground();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, croppedBase64]);

  /* ── Composite builder ── */
  const redrawComposite = useCallback(() => {
    const srcC = srcCanvasRef.current;
    const maskC = maskCanvasRef.current;
    const compC = compCanvasRef.current;
    if (!srcC || !maskC || !compC) return;

    const w = srcC.width;
    const h = srcC.height;
    if (w === 0 || h === 0) return;

    const ctx = compC.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    // 1. Fill with target background colour
    ctx.fillStyle = targetBg;
    ctx.fillRect(0, 0, w, h);

    // 2. Build masked foreground on a temp canvas
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tCtx = tmp.getContext('2d');
    if (!tCtx) return;

    tCtx.drawImage(srcC, 0, 0);

    // Apply the mask via destination-in
    tCtx.globalCompositeOperation = 'destination-in';
    if (bgFeather > 0) {
      tCtx.filter = `blur(${bgFeather}px)`;
    }
    tCtx.drawImage(maskC, 0, 0);
    tCtx.filter = 'none';
    tCtx.globalCompositeOperation = 'source-over';

    // 3. Draw masked foreground on top of background
    ctx.drawImage(tmp, 0, 0);
  }, [targetBg, bgFeather]);

  /* ── Auto background removal: BFS flood from image borders ── */
  const runAutoBackground = useCallback(() => {
    const srcC = srcCanvasRef.current;
    const maskC = maskCanvasRef.current;
    if (!srcC || !maskC) return;

    const w = srcC.width;
    const h = srcC.height;
    if (w === 0 || h === 0) return;

    const srcCtx = srcC.getContext('2d');
    const maskCtx = maskC.getContext('2d');
    if (!srcCtx || !maskCtx) return;

    const srcData = srcCtx.getImageData(0, 0, w, h);
    const px = srcData.data;

    // Reset mask to fully opaque (keep all)
    maskCtx.fillStyle = 'rgba(255,255,255,1)';
    maskCtx.fillRect(0, 0, w, h);
    const maskImg = maskCtx.getImageData(0, 0, w, h);
    const mask = maskImg.data;

    // Sample average background colour from the image borders
    let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
    const samplePixel = (idx: number) => {
      rSum += px[idx]; gSum += px[idx + 1]; bSum += px[idx + 2]; cnt++;
    };
    for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 80))) {
      samplePixel(x * 4);                         // top row
      samplePixel(((h - 1) * w + x) * 4);         // bottom row
    }
    for (let y = 1; y < h - 1; y += Math.max(1, Math.floor(h / 80))) {
      samplePixel((y * w) * 4);                    // left column
      samplePixel((y * w + w - 1) * 4);            // right column
    }
    const bgR = rSum / cnt;
    const bgG = gSum / cnt;
    const bgB = bSum / cnt;

    // BFS flood-fill from every border pixel
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;

    const enqueue = (pos: number) => {
      if (!visited[pos]) { visited[pos] = 1; queue[tail++] = pos; }
    };

    // Seed all 4 borders
    for (let x = 0; x < w; x++) { enqueue(x); enqueue((h - 1) * w + x); }
    for (let y = 1; y < h - 1; y++) { enqueue(y * w); enqueue(y * w + w - 1); }

    const tol = bgTolerance;

    while (head < tail) {
      const pos = queue[head++];
      const i = pos * 4;
      const dr = px[i] - bgR;
      const dg = px[i + 1] - bgG;
      const db = px[i + 2] - bgB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dist <= tol) {
        // Mark as transparent (remove)
        mask[i + 3] = 0;

        const cx = pos % w;
        const cy = (pos - cx) / w;
        if (cx > 0)     enqueue(pos - 1);
        if (cx < w - 1) enqueue(pos + 1);
        if (cy > 0)     enqueue(pos - w);
        if (cy < h - 1) enqueue(pos + w);
      }
    }

    maskCtx.putImageData(maskImg, 0, 0);
    redrawComposite();
  }, [bgTolerance, redrawComposite]);

  /* ── AI background removal using WASM-based RMBG local model ── */
  const runAiBackgroundRemoval = useCallback(async () => {
    if (!croppedBase64) return;
    setAiProgress('Initializing AI...');
    setBrushMode('ai');
    try {
      const blob = await removeBackground(croppedBase64, {
        progress: (key, current, total) => {
          const pct = total > 0 ? ` (${Math.round((current / total) * 100)}%)` : '';
          let modeText = key.split(':')[0];
          modeText = modeText.charAt(0).toUpperCase() + modeText.slice(1);
          setAiProgress(`${modeText}${pct}`);
        },
        model: 'isnet_quint8',
      });

      const img = new Image();
      img.src = URL.createObjectURL(blob);
      img.onload = () => {
        const srcC = srcCanvasRef.current;
        const maskC = maskCanvasRef.current;
        if (!srcC || !maskC) return;
        const w = srcC.width;
        const h = srcC.height;

        const maskCtx = maskC.getContext('2d');
        if (!maskCtx) return;

        // Clear mask and draw transparent AI result
        maskCtx.clearRect(0, 0, w, h);
        maskCtx.drawImage(img, 0, 0, w, h);

        URL.revokeObjectURL(img.src);
        redrawComposite();
        toast.success('AI background cutout completed!');
        setAiProgress(null);
        setBrushMode('auto');
      };
    } catch (error) {
      console.error(error);
      toast.error('AI background removal failed. Falling back to Auto Keyer.');
      setAiProgress(null);
      setBrushMode('auto');
      runAutoBackground();
    }
  }, [croppedBase64, runAutoBackground, redrawComposite]);

  // Re-run auto BG removal when tolerance changes while in auto mode
  useEffect(() => {
    if (step !== 'BG_REMOVE') return;
    if (brushMode === 'auto') {
      runAutoBackground();
    } else {
      redrawComposite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgTolerance, bgFeather, targetBg, brushMode]);

  /* ── Eyedropper: flood-fill from the clicked pixel ── */
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (brushMode !== 'eyedropper') return;

    const srcC = srcCanvasRef.current;
    const maskC = maskCanvasRef.current;
    const compC = compCanvasRef.current;
    if (!srcC || !maskC || !compC) return;

    const r = compC.getBoundingClientRect();
    const clickX = Math.floor(((e.clientX - r.left) / r.width) * srcC.width);
    const clickY = Math.floor(((e.clientY - r.top) / r.height) * srcC.height);

    const w = srcC.width;
    const h = srcC.height;

    const srcCtx = srcC.getContext('2d');
    const maskCtx = maskC.getContext('2d');
    if (!srcCtx || !maskCtx) return;

    const srcData = srcCtx.getImageData(0, 0, w, h);
    const px = srcData.data;
    const maskImg = maskCtx.getImageData(0, 0, w, h);
    const mask = maskImg.data;

    // Get clicked pixel colour
    const clickIdx = (clickY * w + clickX) * 4;
    const tR = px[clickIdx];
    const tG = px[clickIdx + 1];
    const tB = px[clickIdx + 2];

    // Flood-fill from the clicked position (not from borders)
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let head2 = 0, tail2 = 0;

    const startPos = clickY * w + clickX;
    visited[startPos] = 1;
    queue[tail2++] = startPos;

    const tol = bgTolerance;

    while (head2 < tail2) {
      const pos = queue[head2++];
      const i = pos * 4;
      const dr = px[i] - tR;
      const dg = px[i + 1] - tG;
      const db = px[i + 2] - tB;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);

      if (dist <= tol) {
        mask[i + 3] = 0; // transparent

        const cx2 = pos % w;
        const cy2 = (pos - cx2) / w;
        if (cx2 > 0     && !visited[pos - 1]) { visited[pos - 1] = 1; queue[tail2++] = pos - 1; }
        if (cx2 < w - 1 && !visited[pos + 1]) { visited[pos + 1] = 1; queue[tail2++] = pos + 1; }
        if (cy2 > 0     && !visited[pos - w]) { visited[pos - w] = 1; queue[tail2++] = pos - w; }
        if (cy2 < h - 1 && !visited[pos + w]) { visited[pos + w] = 1; queue[tail2++] = pos + w; }
      }
    }

    maskCtx.putImageData(maskImg, 0, 0);
    redrawComposite();
    toast.success('Colour keyed from click point');
  };

  /* ── Manual brush: erase / restore ── */
  const handlePaintStart = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (brushMode !== 'erase' && brushMode !== 'restore') return;
    setIsPainting(true);
    doPaint(e);
  };

  const handlePaintMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPainting) return;
    doPaint(e);
  };

  const handlePaintEnd = () => setIsPainting(false);

  const doPaint = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const maskC = maskCanvasRef.current;
    const compC = compCanvasRef.current;
    if (!maskC || !compC) return;

    const r = compC.getBoundingClientRect();
    const scaleX = maskC.width / r.width;
    const scaleY = maskC.height / r.height;
    const px = (e.clientX - r.left) * scaleX;
    const py = (e.clientY - r.top) * scaleY;

    const ctx = maskC.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, (brushSize * scaleX) / 2, 0, Math.PI * 2);

    if (brushMode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255,255,255,1)';
    }
    ctx.fill();
    ctx.restore();

    redrawComposite();
  };

  /* ── Reset mask ── */
  const handleResetMask = () => {
    const maskC = maskCanvasRef.current;
    if (!maskC) return;
    const ctx = maskC.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(0, 0, maskC.width, maskC.height);
    if (brushMode === 'auto') {
      runAutoBackground();
    } else {
      redrawComposite();
    }
    toast.success('Mask reset');
  };

  /* ═══════════════════════════════════════════
   *  Step 2 → Step 3 transition
   * ═══════════════════════════════════════════ */
  const handleNextToLayout = () => {
    const compC = compCanvasRef.current;
    if (!compC) return;
    setCompositedBase64(compC.toDataURL('image/png'));
    setStep('LAYOUT');
  };

  /* ═══════════════════════════════════════════
   *  Step 3 – Layout grid compilation
   * ═══════════════════════════════════════════ */
  const getPhotoPxSize = useCallback(() => {
    const sz = getActiveSize();
    return { pw: mmToPx(sz.wMm), ph: mmToPx(sz.hMm) };
  }, [getActiveSize]);

  const compileGrid = useCallback(
    (targetW: number, targetH: number, photoImg: HTMLImageElement): HTMLCanvasElement => {
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);

      const scale = targetW / A4_W;
      const { pw, ph } = getPhotoPxSize();
      const spw = pw * scale;
      const sph = ph * scale;
      const gapX = 40 * scale;
      const gapY = 40 * scale;

      if (layoutMode === 'individual') {
        ctx.drawImage(photoImg, (targetW - spw) / 2, (targetH - sph) / 2, spw, sph);
      } else {
        let cols: number, rows: number;
        if (layoutMode === '3by4') {
          // 3 by A4: 2 rows × 6 columns = 12 photos
          cols = 6; rows = 2;
        } else if (layoutMode === 'a4') {
          // Auto-fill A4
          cols = Math.max(1, Math.floor((targetW - gapX) / (spw + gapX)));
          rows = Math.max(1, Math.floor((targetH - gapY) / (sph + gapY)));
        } else {
          cols = customCols;
          rows = customRows;
        }

        const gridW = cols * spw + (cols - 1) * gapX;
        const gridH = rows * sph + (rows - 1) * gapY;
        const ox = (targetW - gridW) / 2;
        const oy = (targetH - gridH) / 2;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.drawImage(photoImg, ox + c * (spw + gapX), oy + r * (sph + gapY), spw, sph);
          }
        }
      }

      return canvas;
    },
    [getPhotoPxSize, layoutMode, customCols, customRows]
  );

  // Generate preview whenever layout options change
  useEffect(() => {
    if (step !== 'LAYOUT' || !compositedBase64) return;
    const img = new Image();
    img.src = compositedBase64;
    img.onload = () => {
      const preview = compileGrid(420, 594, img); // scaled A4 preview
      setLayoutPreviewUrl(preview.toDataURL('image/png'));
    };
  }, [step, compositedBase64, layoutMode, customCols, customRows, compileGrid]);

  /* ── Export helpers ── */
  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const img = new Image();
      img.src = compositedBase64;
      await new Promise<void>((res) => { img.onload = () => res(); });

      const gridCanvas = compileGrid(A4_W, A4_H, img);
      const pngBase64 = gridCanvas.toDataURL('image/png').split(',')[1];
      const imageBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));

      const doc = await PDFDocument.create();
      const page = doc.addPage([595.28, 841.89]);
      const embedded = await doc.embedPng(imageBytes);
      page.drawImage(embedded, { x: 0, y: 0, width: 595.28, height: 841.89 });

      const pdfBytes = await doc.save();
      const b64 = btoa(new Uint8Array(pdfBytes).reduce((s, b) => s + String.fromCharCode(b), ''));

      const cleanName = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
      const result = await window.electron.saveFileFromBase64(
        `data:application/pdf;base64,${b64}`,
        cleanName,
        [{ name: 'PDF Documents', extensions: ['pdf'] }]
      );
      if (result.success) {
        toast.success(`PDF saved: ${result.data.split(/[\\/]/).pop()}`);
        const statsResult = await window.electron.validateFile(result.data);
        const savedSize = statsResult.success ? statsResult.data.size : 0;

        useAppStore.getState().updateOutputOptions({
          filename: cleanName.split('.')[0],
          format: OutputFormat.PDF
        });
        useAppStore.getState().setProcessingStatus({
          outputPath: result.data,
          outputSize: savedSize,
          status: 'completed',
          progress: 100
        });
        setView(AppView.SUCCESS);
      } else if (result.error?.message !== 'Save cancelled by user') {
        toast.error(result.error?.message || 'Export failed');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to export PDF');
    } finally {
      setExporting(false);
    }
  };

  const handleExportImage = async (format: 'png' | 'jpeg') => {
    setExporting(true);
    try {
      let dataUrl = '';
      if (layoutMode === 'individual') {
        dataUrl = compositedBase64;
      } else {
        const img = new Image();
        img.src = compositedBase64;
        await new Promise<void>((res) => { img.onload = () => res(); });
        dataUrl = compileGrid(A4_W, A4_H, img).toDataURL(`image/${format}`);
      }

      const defaultName = `passport_photo${layoutMode !== 'individual' ? '_sheet' : ''}.${format}`;
      const result = await window.electron.saveFileFromBase64(
        dataUrl,
        defaultName,
        [{ name: `${format.toUpperCase()} Image`, extensions: [format] }]
      );
      if (result.success) {
        toast.success(`Image saved: ${result.data.split(/[\\/]/).pop()}`);
        const statsResult = await window.electron.validateFile(result.data);
        const savedSize = statsResult.success ? statsResult.data.size : 0;

        useAppStore.getState().updateOutputOptions({
          filename: defaultName.split('.')[0],
          format: format === 'png' ? OutputFormat.PNG : OutputFormat.JPEG
        });
        useAppStore.getState().setProcessingStatus({
          outputPath: result.data,
          outputSize: savedSize,
          status: 'completed',
          progress: 100
        });
        setView(AppView.SUCCESS);
      } else if (result.error?.message !== 'Save cancelled by user') {
        toast.error(result.error?.message || 'Export failed');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to save image');
    } finally {
      setExporting(false);
    }
  };

  /* ═══════════════════════════════════════════
   *  JSX Rendering
   * ═══════════════════════════════════════════ */
  const activeSz = getActiveSize();
  const cropDims = (() => {
    const w = Math.round(cropRect.w);
    const h = Math.round(cropRect.h);
    return `${w} × ${h} px`;
  })();

  return (
    <div className="h-full flex flex-col bg-bg-base select-none">
      {/* ── Header ── */}
      <div className="bg-bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              if (step === 'BG_REMOVE') setStep('CROP');
              else if (step === 'LAYOUT') setStep('BG_REMOVE');
              else {
                await handleCancel();
              }
            }}
            className="p-1.5 hover:bg-bg-sunken rounded text-text-secondary hover:text-text-primary transition-fast"
            title="Go Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-base font-bold text-text-primary">Passport Photo Maker</h1>
            <p className="text-xs text-text-secondary">Crop, clean background, and generate print sheets</p>
          </div>
        </div>

        {sourceImgSrc && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {(['CROP', 'BG_REMOVE', 'LAYOUT'] as const).map((s, i) => (
                <span key={s} className="flex items-center gap-1">
                  {i > 0 && <span className="text-text-muted text-xs">→</span>}
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition-fast ${
                      step === s ? 'bg-accent text-white' : 'bg-bg-sunken text-text-secondary'
                    }`}
                  >
                    {i + 1}. {s === 'CROP' ? 'Crop' : s === 'BG_REMOVE' ? 'Background' : 'Layout'}
                  </span>
                </span>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* ── Upload screen ── */}
      {!sourceImgSrc ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="bg-bg-surface p-10 rounded-xl border border-border shadow-md max-w-md w-full text-center flex flex-col items-center animate-scale-in">
            <div className="w-16 h-16 bg-accent/5 rounded-full flex items-center justify-center text-accent mb-6">
              <Camera size={32} />
            </div>
            <h2 className="text-lg font-bold text-text-primary mb-2">Upload Portrait Image</h2>
            <p className="text-sm text-text-secondary mb-6 max-w-[280px]">
              Upload a front-facing selfie or portrait photo to create passport-sized photos.
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" size="lg" onClick={handleBrowseImage}>
                Browse Files
              </Button>
              <label className="flex items-center justify-center px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-md shadow-sm transition-fast cursor-pointer text-sm">
                <Upload size={16} className="mr-2" /> Upload Image
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              <Button variant="ghost" size="lg" onClick={() => setView(AppView.HOME)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden animate-fade-in">

          {/* ════════════════ STEP 1: CROP ════════════════ */}
          {step === 'CROP' && (
            <>
              {/* Left: size options */}
              <div className="w-80 border-r border-border bg-bg-surface flex flex-col p-6 overflow-y-auto scrollbar-thin">
                <h2 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-1.5">
                  <Scissors size={16} className="text-accent" /> Select Photo Size
                </h2>

                <div className="flex flex-col gap-3 mb-6">
                  {SIZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedSizeId(opt.id)}
                      className={`p-3 border rounded-lg text-left transition-fast ${
                        selectedSizeId === opt.id
                          ? 'border-accent bg-accent/5 shadow-sm'
                          : 'border-border hover:border-text-secondary hover:bg-bg-sunken'
                      }`}
                    >
                      <p className={`text-sm font-bold ${selectedSizeId === opt.id ? 'text-accent' : 'text-text-primary'}`}>
                        {opt.name}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                {selectedSizeId === 'custom' && (
                  <div className="border border-border/80 rounded-lg p-3 bg-bg-base/40 flex flex-col gap-3 mb-6 animate-fade-in">
                    <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                      Custom Size (mm)
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-text-secondary block mb-1">Width (mm)</label>
                        <input
                          type="number"
                          value={customWidth}
                          onChange={(e) => setCustomWidth(Math.max(10, parseInt(e.target.value) || 10))}
                          className="w-full px-2 py-1.5 border border-border rounded text-sm bg-white focus:outline-none focus:border-accent text-text-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-text-secondary block mb-1">Height (mm)</label>
                        <input
                          type="number"
                          value={customHeight}
                          onChange={(e) => setCustomHeight(Math.max(10, parseInt(e.target.value) || 10))}
                          className="w-full px-2 py-1.5 border border-border rounded text-sm bg-white focus:outline-none focus:border-accent text-text-primary"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Info card */}
                <div className="bg-bg-base/50 border border-border rounded-lg p-3 mb-6">
                  <p className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-1">Active Dimensions</p>
                  <p className="text-sm font-semibold text-text-primary">
                    {activeSz.wMm} × {activeSz.hMm} mm
                  </p>
                  <p className="text-[10px] text-text-secondary mt-0.5">
                    Aspect ratio: {(activeSz.wMm / activeSz.hMm).toFixed(3)} &bull; Crop: {cropDims}
                  </p>
                </div>

                <div className="mt-auto">
                  <Button variant="primary" size="lg" className="w-full" onClick={handleNextToBgRemove}>
                    Next: Clean Background
                  </Button>
                </div>
              </div>

              {/* Center: cropper */}
              <div className="flex-1 flex flex-col p-6 items-center justify-center bg-bg-base">
                <span className="text-xs font-semibold text-text-secondary mb-1">
                  Drag the frame or corners to adjust
                </span>
                <h2 className="text-sm font-bold text-text-primary mb-6">Crop Frame</h2>

                <div className="relative bg-bg-surface p-3 rounded-lg border border-border shadow-md flex items-center justify-center overflow-hidden">
                  <div
                    ref={cropWrapRef}
                    className="relative select-none"
                    style={{ display: 'inline-block' }}
                  >
                    <img
                      ref={imgRef}
                      src={sourceImgSrc}
                      alt="Source"
                      className="max-h-[55vh] max-w-full object-contain pointer-events-none block"
                      onLoad={handleImgLoad}
                    />

                    {/* Dark overlay outside crop area */}
                    <div className="absolute inset-0 pointer-events-none"
                      style={{
                        background: `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45))`,
                        clipPath: `polygon(
                          0% 0%, 100% 0%, 100% 100%, 0% 100%,
                          0% 0%,
                          ${(cropRect.x / (imgRef.current?.naturalWidth || 1)) * 100}% ${(cropRect.y / (imgRef.current?.naturalHeight || 1)) * 100}%,
                          ${(cropRect.x / (imgRef.current?.naturalWidth || 1)) * 100}% ${((cropRect.y + cropRect.h) / (imgRef.current?.naturalHeight || 1)) * 100}%,
                          ${((cropRect.x + cropRect.w) / (imgRef.current?.naturalWidth || 1)) * 100}% ${((cropRect.y + cropRect.h) / (imgRef.current?.naturalHeight || 1)) * 100}%,
                          ${((cropRect.x + cropRect.w) / (imgRef.current?.naturalWidth || 1)) * 100}% ${(cropRect.y / (imgRef.current?.naturalHeight || 1)) * 100}%,
                          ${(cropRect.x / (imgRef.current?.naturalWidth || 1)) * 100}% ${(cropRect.y / (imgRef.current?.naturalHeight || 1)) * 100}%
                        )`,
                      }}
                    />

                    {/* Crop overlay */}
                    <div
                      className="absolute border-2 border-white/80 cursor-move shadow-lg"
                      style={cropOverlayStyle()}
                      onMouseDown={(e) => handleCropMouseDown(e, 'move')}
                    >
                      {/* Rule of thirds */}
                      <div className="absolute top-1/3 left-0 right-0 border-t border-white/25 pointer-events-none" />
                      <div className="absolute top-2/3 left-0 right-0 border-t border-white/25 pointer-events-none" />
                      <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/25 pointer-events-none" />
                      <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/25 pointer-events-none" />

                      {/* Corner handles */}
                      <div className="absolute w-4 h-4 bg-white border-2 border-accent -top-2 -left-2 rounded-full cursor-nwse-resize shadow-md" onMouseDown={(e) => handleCropMouseDown(e, 'tl')} />
                      <div className="absolute w-4 h-4 bg-white border-2 border-accent -top-2 -right-2 rounded-full cursor-nesw-resize shadow-md" onMouseDown={(e) => handleCropMouseDown(e, 'tr')} />
                      <div className="absolute w-4 h-4 bg-white border-2 border-accent -bottom-2 -left-2 rounded-full cursor-nesw-resize shadow-md" onMouseDown={(e) => handleCropMouseDown(e, 'bl')} />
                      <div className="absolute w-4 h-4 bg-white border-2 border-accent -bottom-2 -right-2 rounded-full cursor-nwse-resize shadow-md" onMouseDown={(e) => handleCropMouseDown(e, 'br')} />

                      {/* Dimension label */}
                      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/70 text-white text-[9px] px-2 py-0.5 rounded whitespace-nowrap font-mono pointer-events-none">
                        {activeSz.wMm}×{activeSz.hMm} mm
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSourceImgSrc(null)}
                  className="mt-6 text-xs text-text-secondary hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Upload different image
                </button>
              </div>
            </>
          )}
          {/* ════════════════ STEP 2: BACKGROUND REMOVAL ════════════════ */}
          {step === 'BG_REMOVE' && (
            <>
              <div className="w-80 border-r border-border bg-bg-surface flex flex-col p-6 overflow-y-auto scrollbar-thin">
                <h2 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-1.5">
                  <Paintbrush size={16} className="text-accent" /> Background Tools
                </h2>

                {/* AI Background Cutout Section */}
                <div className="flex flex-col gap-2 mb-6">
                  <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1">
                    <Sparkles size={12} className="text-accent animate-pulse" /> AI Smart Cutout
                  </span>
                  <button
                    onClick={runAiBackgroundRemoval}
                    disabled={brushMode === 'ai'}
                    className={`w-full py-2.5 px-4 bg-gradient-to-r from-accent to-purple-600 hover:from-accent-hover hover:to-purple-700 text-white font-semibold rounded-lg shadow-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:scale-100`}
                  >
                    <Sparkles size={16} className={brushMode === 'ai' ? "animate-spin" : "animate-pulse"} />
                    AI Smart Remove
                  </button>
                  <span className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                    Uses AI to detect portrait subject and remove background locally. Downloads model (~70MB) on first run.
                  </span>
                </div>

                {/* Mode selector */}
                <div className="flex flex-col gap-2 mb-6">
                  <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Manual Fine-Tuning</span>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { mode: 'auto' as const, label: 'Auto Keyer', icon: <RefreshCw size={12} /> },
                      { mode: 'eyedropper' as const, label: 'Eye-Dropper', icon: <Droplet size={12} /> },
                      { mode: 'erase' as const, label: 'Erase Brush', icon: <Eraser size={12} /> },
                      { mode: 'restore' as const, label: 'Restore Brush', icon: <Undo2 size={12} /> },
                    ]).map((item) => (
                      <button
                        key={item.mode}
                        onClick={() => setBrushMode(item.mode)}
                        className={`py-2 text-xs border rounded-md font-semibold transition-fast flex items-center justify-center gap-1.5 ${
                          brushMode === item.mode
                            ? 'border-accent bg-accent/5 text-accent'
                            : 'border-border hover:bg-bg-sunken text-text-secondary bg-bg-surface'
                        }`}
                      >
                        {item.icon} {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sliders */}
                <div className="flex flex-col gap-4 mb-6">
                  <div>
                    <div className="flex justify-between text-xs text-text-secondary mb-1">
                      <span>Colour Tolerance</span>
                      <span className="font-mono">{bgTolerance}</span>
                    </div>
                    <input
                      type="range" min="5" max="150" value={bgTolerance}
                      onChange={(e) => setBgTolerance(parseInt(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-text-secondary mb-1">
                      <span>Edge Feathering</span>
                      <span className="font-mono">{bgFeather}px</span>
                    </div>
                    <input
                      type="range" min="0" max="15" value={bgFeather}
                      onChange={(e) => setBgFeather(parseInt(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                  </div>
                  {(brushMode === 'erase' || brushMode === 'restore') && (
                    <div className="animate-fade-in-up">
                      <div className="flex justify-between text-xs text-text-secondary mb-1">
                        <span>Brush Size</span>
                        <span className="font-mono">{brushSize}px</span>
                      </div>
                      <input
                        type="range" min="4" max="80" value={brushSize}
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                      />
                    </div>
                  )}
                </div>

                {/* Background colour */}
                <div className="flex flex-col gap-2 mb-6">
                  <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                    Background Colour
                  </span>
                  <div className="flex flex-wrap gap-2.5">
                    {PRESET_BG_COLORS.map((col) => (
                      <button
                        key={col.hex}
                        onClick={() => setTargetBg(col.hex)}
                        className="w-7 h-7 rounded-full border border-border shadow-inner relative flex items-center justify-center transition-transform hover:scale-110"
                        style={{ backgroundColor: col.hex }}
                        title={col.name}
                      >
                        {targetBg.toUpperCase() === col.hex.toUpperCase() && (
                          <div className="w-2.5 h-2.5 rounded-full bg-accent ring-1 ring-white animate-scale-in" />
                        )}
                      </button>
                    ))}
                    <div className="relative w-7 h-7 rounded-full border border-border overflow-hidden cursor-pointer">
                      <input
                        type="color" value={targetBg}
                        onChange={(e) => setTargetBg(e.target.value)}
                        className="absolute inset-0 w-12 h-12 -translate-x-2 -translate-y-2 cursor-pointer border-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-auto">
                  <Button variant="primary" size="lg" className="w-full" onClick={handleNextToLayout}>
                    Next: Layout & Save
                  </Button>
                </div>
              </div>

              {/* Center: composite preview */}
              <div className="flex-1 flex flex-col p-6 items-center justify-center bg-bg-base">
                <div className="text-xs font-semibold text-text-secondary mb-1">
                  {brushMode === 'ai' && 'AI background remover is processing...'}
                  {brushMode === 'auto' && 'Adjust tolerance to clean background automatically'}
                  {brushMode === 'eyedropper' && 'Click on any colour in the image to remove it'}
                  {brushMode === 'erase' && 'Paint over areas to erase (make transparent)'}
                  {brushMode === 'restore' && 'Paint over areas to restore (bring back)'}
                </div>
                <h2 className="text-sm font-bold text-text-primary mb-6">Composited Preview</h2>

                <div className="relative max-w-md max-h-[62vh] bg-bg-surface p-2 rounded-lg border border-border shadow-md flex items-center justify-center overflow-hidden">
                  {/* Hidden working canvases */}
                  <canvas ref={srcCanvasRef} className="hidden" />
                  <canvas ref={maskCanvasRef} className="hidden" />

                  {/* Checkerboard background to show transparency */}
                  <div className="relative">
                    <div
                      className="absolute inset-0 rounded"
                      style={{
                        backgroundImage: `repeating-conic-gradient(#e0e0e0 0% 25%, #f5f5f5 0% 50%)`,
                        backgroundSize: '16px 16px',
                      }}
                    />
                    <canvas
                      ref={compCanvasRef}
                      className="relative max-h-[54vh] max-w-full border border-border/50 shadow-inner select-none rounded"
                      style={{ cursor: brushMode === 'eyedropper' ? 'crosshair' : brushMode === 'erase' || brushMode === 'restore' ? 'cell' : 'default' }}
                      onMouseDown={handlePaintStart}
                      onMouseMove={handlePaintMove}
                      onMouseUp={handlePaintEnd}
                      onMouseLeave={handlePaintEnd}
                      onClick={handleCanvasClick}
                    />

                    {/* AI Loading Progress Overlay */}
                    {aiProgress && (
                      <div className="absolute inset-0 bg-black/75 backdrop-blur-[2px] flex flex-col items-center justify-center text-white p-4 rounded text-center">
                        <Loader2 className="animate-spin text-accent mb-3" size={32} />
                        <p className="text-sm font-bold animate-pulse">{aiProgress}</p>
                        <p className="text-[10px] text-white/60 mt-1 max-w-[200px]">
                          Downloading model on first run (~70MB). Runs offline locally afterwards.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleResetMask}
                  className="mt-5 text-xs text-text-secondary hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Reset / Clear All Edits
                </button>
              </div>
            </>
          )}

          {/* ════════════════ STEP 3: LAYOUT & SAVE ════════════════ */}
          {step === 'LAYOUT' && (
            <>
              <div className="w-80 border-r border-border bg-bg-surface flex flex-col p-6 overflow-y-auto scrollbar-thin">
                <h2 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-1.5">
                  <Grid size={16} className="text-accent" /> Print Layout
                </h2>

                <div className="flex flex-col gap-3 mb-6">
                  <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Format</span>
                  {([
                    { mode: 'individual' as const, title: 'Individual Photo', desc: 'Single passport-sized photo' },
                    { mode: '3by4' as const, title: '3 by A4 (Passport Sheet)', desc: '12 photos: 2 rows × 6 columns' },
                    { mode: 'a4' as const, title: 'Full A4 Grid', desc: 'Auto-fills the entire A4 page' },
                    { mode: 'custom' as const, title: 'Custom Grid', desc: 'Set your own rows & columns' },
                  ]).map((opt) => (
                    <button
                      key={opt.mode}
                      onClick={() => setLayoutMode(opt.mode)}
                      className={`p-3 border rounded-lg text-left transition-fast ${
                        layoutMode === opt.mode
                          ? 'border-accent bg-accent/5 shadow-sm'
                          : 'border-border hover:border-text-secondary hover:bg-bg-sunken'
                      }`}
                    >
                      <p className={`text-sm font-bold ${layoutMode === opt.mode ? 'text-accent' : 'text-text-primary'}`}>
                        {opt.title}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                {layoutMode === 'custom' && (
                  <div className="border border-border/80 rounded-lg p-3 bg-bg-base/40 flex flex-col gap-3 mb-6 animate-fade-in">
                    <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Grid Size</span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-text-secondary block mb-1">Columns</label>
                        <div className="flex items-center border border-border rounded bg-white">
                          <button onClick={() => setCustomCols((p) => Math.max(1, p - 1))} className="p-1.5 hover:bg-bg-sunken"><Minus size={10} /></button>
                          <span className="flex-1 text-center text-xs font-mono text-text-primary">{customCols}</span>
                          <button onClick={() => setCustomCols((p) => Math.min(10, p + 1))} className="p-1.5 hover:bg-bg-sunken"><Plus size={10} /></button>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-text-secondary block mb-1">Rows</label>
                        <div className="flex items-center border border-border rounded bg-white">
                          <button onClick={() => setCustomRows((p) => Math.max(1, p - 1))} className="p-1.5 hover:bg-bg-sunken"><Minus size={10} /></button>
                          <span className="flex-1 text-center text-xs font-mono text-text-primary">{customRows}</span>
                          <button onClick={() => setCustomRows((p) => Math.min(15, p + 1))} className="p-1.5 hover:bg-bg-sunken"><Plus size={10} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 mb-4">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Filename</label>
                  <input
                    type="text" value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder="Filename"
                    className="px-3 py-2 border border-border rounded-md text-sm bg-bg-surface focus:outline-none focus:border-accent text-text-primary"
                  />
                </div>

                <div className="flex flex-col gap-2 mt-auto">
                  {layoutMode !== 'individual' && (
                    <Button variant="primary" size="lg" className="w-full text-center" onClick={handleExportPDF} disabled={exporting}>
                      {exporting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Check size={16} className="mr-2" />}
                      Save Layout PDF
                    </Button>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="secondary" size="md" onClick={() => handleExportImage('png')} disabled={exporting}>
                      <Download size={14} className="mr-1.5" /> Save PNG
                    </Button>
                    <Button variant="secondary" size="md" onClick={() => handleExportImage('jpeg')} disabled={exporting}>
                      <Download size={14} className="mr-1.5" /> Save JPEG
                    </Button>
                  </div>
                </div>
              </div>

              {/* Center: layout preview */}
              <div className="flex-1 flex flex-col p-6 items-center justify-center bg-bg-base">
                <span className="text-xs font-semibold text-text-secondary mb-1">Review before saving</span>
                <h2 className="text-sm font-bold text-text-primary mb-6">Print Preview (A4)</h2>

                <div className="relative bg-bg-surface p-2 rounded-lg border border-border shadow-md flex items-center justify-center overflow-hidden">
                  {layoutPreviewUrl ? (
                    <img
                      src={layoutPreviewUrl}
                      alt="Layout Preview"
                      className="max-h-[54vh] max-w-full border border-border shadow object-contain"
                    />
                  ) : (
                    <div className="animate-pulse flex flex-col items-center gap-2 p-12">
                      <Loader2 className="animate-spin text-accent" size={24} />
                      <span className="text-xs text-text-secondary">Generating preview…</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
