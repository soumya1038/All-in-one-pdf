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
  Sparkles,
  Printer,
  ZoomIn,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { OutputFormat, ProcessingStep } from '../types/Output.types';
import Button from '../components/ui/Button';
import { PDFDocument } from 'pdf-lib';
import { removeBackground } from '@imgly/background-removal';
import { DocumentItem, DocumentType } from '../types/Document.types';
import DocumentSelectorBar from '../components/document/DocumentSelectorBar';
import { registerUploadedFile } from '../utils/fileUploadHelper';

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
  const documents = useAppStore((s) => s.documents);
  const selectedDocumentId = useAppStore((s) => s.ui.selectedDocumentId);
  const setSelectedDocument = useAppStore((s) => s.setSelectedDocument);

  /* ── Workflow step ── */
  const [step, setStep] = useState<EditorStep>('CROP');

  /* ── Source image (base64 data-url or docuflow:// url) ── */
  const [sourceImgSrc, setSourceImgSrc] = useState<string | null>(null);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);

  const loadDocumentIntoEditor = useCallback(async (doc: DocumentItem) => {
    try {
      setCurrentDocId(doc.id);
      setSelectedDocument(doc.id);
      let dataUrl = '';
      if (window.electron?.readImageAsDataUrl) {
        const res = await window.electron.readImageAsDataUrl(doc.tempPath);
        if (res.success && res.data) {
          dataUrl = res.data;
        }
      }
      if (!dataUrl) {
        dataUrl = `docuflow:///${doc.tempPath.replace(/\\/g, '/')}`;
      }
      setSourceImgSrc(dataUrl);
      setStep('CROP');
      setImageScale(1.0);
      setImagePan({ x: 0, y: 0 });
    } catch (err) {
      console.error('Failed to load document into passport photo maker:', err);
      toast.error('Failed to load image');
    }
  }, [setSelectedDocument]);

  // Auto-load document from shared session on mount or when selected document changes
  useEffect(() => {
    if (documents.length > 0) {
      const activeDoc = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId && d.type === DocumentType.IMAGE))
        || (!sourceImgSrc ? documents.find(d => d.type === DocumentType.IMAGE) : null);

      if (activeDoc && activeDoc.id !== currentDocId) {
        loadDocumentIntoEditor(activeDoc);
      }
    }
  }, [documents, selectedDocumentId, currentDocId, sourceImgSrc, loadDocumentIntoEditor]);

  const handleCancel = async () => {
    if (sourceImgSrc) {
      const confirmed = await useAppStore.getState().showConfirm(
        'Are you sure you want to exit Passport Photo Maker? Any unsaved edits will be lost.',
        'Exit Passport Photo'
      );
      if (!confirmed) return;
    }
    const hasDocs = useAppStore.getState().documents.length > 0;
    setView(hasDocs ? AppView.DOCUMENT_LIST : AppView.HOME);
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

  // Stage canvas for rendering scaled image on white background
  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const [imageScale, setImageScale] = useState(1.0); // 1.0 = 100% (1:1 uniform aspect scaling)
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 }); // offset in stage pixels

  /* ── Step 2 – Background removal ── */
  const [croppedBase64, setCroppedBase64] = useState<string | null>(null);
  const [bgTolerance, setBgTolerance] = useState(30);
  const [bgFeather, setBgFeather] = useState(2);
  const [targetBg, setTargetBg] = useState('#FFFFFF');
  // Default brushMode is 'none' so background is NOT automatically deleted
  const [brushMode, setBrushMode] = useState<'none' | 'auto' | 'eyedropper' | 'erase' | 'restore' | 'ai'>('none');
  const [brushSize, setBrushSize] = useState(20);
  const [isPainting, setIsPainting] = useState(false);
  const [aiProgress, setAiProgress] = useState<string | null>(null);

  const srcCanvasRef = useRef<HTMLCanvasElement>(null);   // original cropped pixels (never mutated)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);   // alpha mask: white=keep, transparent=remove
  const compCanvasRef = useRef<HTMLCanvasElement>(null);   // final composited preview

  /* ── Step 3 – Layout & export ── */
  const [compositedBase64, setCompositedBase64] = useState('');
  const [layoutMode, setLayoutMode] = useState<'individual' | '3by4' | '4by4' | '4x6' | 'a4' | 'custom'>('3by4');
  const [paperSize, setPaperSize] = useState<'A4' | '4x6'>('A4');
  const [showCuttingBorders, setShowCuttingBorders] = useState(true);
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
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const registered = await registerUploadedFile(file);
      if (registered) {
        toast.success(`Photo loaded: ${registered.filename}`);
        loadDocumentIntoEditor(registered);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ev.target?.result) {
            setSourceImgSrc(ev.target.result as string);
            setStep('CROP');
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDropFile = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const registered = await registerUploadedFile(file);
      if (registered) {
        toast.success(`Photo loaded: ${registered.filename}`);
        loadDocumentIntoEditor(registered);
        return;
      }

      if (!file.type.startsWith('image/')) {
        toast.error('Please drop an image file (JPG, PNG, WebP)');
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setSourceImgSrc(ev.target.result as string);
          setStep('CROP');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBrowseImage = async () => {
    try {
      const result = await window.electron.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'] }],
      });
      if (result.success && result.data && result.data.length > 0) {
        const filePath = result.data[0];
        const registered = await registerUploadedFile(filePath);
        if (registered) {
          toast.success(`Photo loaded: ${registered.filename}`);
          loadDocumentIntoEditor(registered);
        } else {
          const dataRes = await window.electron.readImageAsDataUrl(filePath);
          if (dataRes.success && dataRes.data) {
            setSourceImgSrc(dataRes.data);
          } else {
            setSourceImgSrc(`docuflow:///${filePath.replace(/\\/g, '/')}`);
          }
          setStep('CROP');
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

  // Render the white background stage with the scaled and panned image
  const renderStage = useCallback(() => {
    const stage = stageCanvasRef.current;
    const img = imgRef.current;
    if (!stage || !img || !img.naturalWidth || !img.naturalHeight) return;

    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    stage.width = natW;
    stage.height = natH;

    const ctx = stage.getContext('2d');
    if (!ctx) return;

    // 1. Fill stage with crisp white background by default
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, natW, natH);

    // 2. Compute 1:1 aspect scaled image dimensions
    const sw = natW * imageScale;
    const sh = natH * imageScale;

    // 3. Center image + user pan offset
    const dx = (natW - sw) / 2 + imagePan.x;
    const dy = (natH - sh) / 2 + imagePan.y;

    ctx.drawImage(img, dx, dy, sw, sh);
  }, [imageScale, imagePan]);

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

  // When the selected size changes, re-center crop and re-render stage
  useEffect(() => {
    if (sourceImgSrc && step === 'CROP') {
      const timer = setTimeout(() => {
        resetCropToCenter();
        renderStage();
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [selectedSizeId, customWidth, customHeight, sourceImgSrc, step, resetCropToCenter, renderStage]);

  // Re-render stage whenever scale or pan changes
  useEffect(() => {
    if (sourceImgSrc && step === 'CROP') {
      renderStage();
    }
  }, [sourceImgSrc, step, imageScale, imagePan, renderStage]);

  // Called when the <img> element finishes loading
  const handleImgLoad = () => {
    resetCropToCenter();
    renderStage();
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
      if (!dragAnchor) return;
      const stage = stageCanvasRef.current;
      const img = imgRef.current;
      if (!stage || !img) return;
      const natW = stage.width || img.naturalWidth;
      const natH = stage.height || img.naturalHeight;
      const r = stage.getBoundingClientRect();
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
        const absDx = Math.abs(dxNat);
        const absDy = Math.abs(dyNat);
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
    const stage = stageCanvasRef.current;
    const img = imgRef.current;
    const natW = stage?.width || img?.naturalWidth;
    const natH = stage?.height || img?.naturalHeight;
    if (!natW || !natH) return { display: 'none' };
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
    const stage = stageCanvasRef.current;
    if (!stage) return;

    // Clamp crop to stage bounds
    const cx = Math.max(0, Math.round(cropRect.x));
    const cy = Math.max(0, Math.round(cropRect.y));
    const cw = Math.round(Math.min(cropRect.w, stage.width - cx));
    const ch = Math.round(Math.min(cropRect.h, stage.height - cy));
    if (cw <= 0 || ch <= 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill background with white space by default
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(stage, cx, cy, cw, ch, 0, 0, cw, ch);

    setCroppedBase64(canvas.toDataURL('image/png'));
    setStep('BG_REMOVE');
    setBrushMode('none'); // Default: DO NOT auto clean! Preserve original background intact.
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

      // Initialize mask to fully opaque white (keep 100% of photo - DO NOT auto delete!)
      const maskCtx = maskC.getContext('2d');
      if (maskCtx) {
        maskCtx.fillStyle = 'rgba(255,255,255,1)';
        maskCtx.fillRect(0, 0, w, h);
      }

      // Redraw composite with original background intact
      redrawComposite();
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
        setBrushMode('none');
      };
    } catch (error) {
      console.error(error);
      toast.error('AI background removal failed.');
      setAiProgress(null);
      setBrushMode('none');
      redrawComposite();
    }
  }, [croppedBase64, redrawComposite]);

  // Re-run auto BG removal only when tolerance changes while in auto mode
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

      const is4x6 = paperSize === '4x6' || layoutMode === '4x6';
      const baseSheetW = is4x6 ? 1800 : A4_W;
      const scale = targetW / baseSheetW;
      const { pw, ph } = getPhotoPxSize();
      const spw = pw * scale;
      const sph = ph * scale;
      const gapX = 35 * scale;
      const gapY = 35 * scale;

      if (layoutMode === 'individual') {
        const x = (targetW - spw) / 2;
        const y = (targetH - sph) / 2;
        ctx.drawImage(photoImg, x, y, spw, sph);
        if (showCuttingBorders) {
          ctx.strokeStyle = '#D1D5DB';
          ctx.lineWidth = Math.max(1, Math.round(scale * 2));
          ctx.strokeRect(x, y, spw, sph);
        }
      } else {
        let cols = 3;
        let rows = 4;
        if (layoutMode === '3by4') {
          // Standard 3 cols × 4 rows = 12 photos
          cols = 3;
          rows = 4;
        } else if (layoutMode === '4by4') {
          // Full 4 cols × 4 rows = 16 photos
          cols = 4;
          rows = 4;
        } else if (layoutMode === '4x6') {
          // Standard 4×6" photo paper: 4 cols × 2 rows = 8 photos
          cols = 4;
          rows = 2;
        } else if (layoutMode === 'a4') {
          cols = Math.max(1, Math.floor((targetW - gapX * 2) / (spw + gapX)));
          rows = Math.max(1, Math.floor((targetH - gapY * 2) / (sph + gapY)));
        } else if (layoutMode === 'custom') {
          cols = customCols;
          rows = customRows;
        }

        const gridW = cols * spw + (cols - 1) * gapX;
        const gridH = rows * sph + (rows - 1) * gapY;
        const ox = (targetW - gridW) / 2;
        const oy = (targetH - gridH) / 2;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const px = ox + c * (spw + gapX);
            const py = oy + r * (sph + gapY);
            ctx.drawImage(photoImg, px, py, spw, sph);
            if (showCuttingBorders) {
              ctx.strokeStyle = '#D1D5DB';
              ctx.lineWidth = Math.max(1, Math.round(scale * 2));
              ctx.strokeRect(px, py, spw, sph);
            }
          }
        }
      }

      return canvas;
    },
    [getPhotoPxSize, layoutMode, paperSize, customCols, customRows, showCuttingBorders]
  );

  // Generate preview whenever layout options change
  useEffect(() => {
    if (step !== 'LAYOUT' || !compositedBase64) return;
    const img = new Image();
    img.src = compositedBase64;
    img.onload = () => {
      const is4x6 = paperSize === '4x6' || layoutMode === '4x6';
      const targetW = layoutMode === 'individual' ? 380 : is4x6 ? 480 : 420;
      const targetH = layoutMode === 'individual' ? 490 : is4x6 ? 320 : 594;
      const preview = compileGrid(targetW, targetH, img);
      setLayoutPreviewUrl(preview.toDataURL('image/png'));
    };
  }, [step, compositedBase64, layoutMode, paperSize, customCols, customRows, showCuttingBorders, compileGrid]);

  /* ── Export helpers ── */
  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const img = new Image();
      img.src = compositedBase64;
      await new Promise<void>((res) => { img.onload = () => res(); });

      const is4x6 = paperSize === '4x6' || layoutMode === '4x6';
      const sheetW = is4x6 ? 1800 : A4_W;
      const sheetH = is4x6 ? 1200 : A4_H;
      const gridCanvas = compileGrid(sheetW, sheetH, img);
      const pngBase64 = gridCanvas.toDataURL('image/png').split(',')[1];
      const imageBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));

      const doc = await PDFDocument.create();
      // 4x6 inch is 432 x 288 pt landscape; A4 is 595.28 x 841.89 pt portrait
      const pageW = is4x6 ? 432 : 595.28;
      const pageH = is4x6 ? 288 : 841.89;
      const page = doc.addPage([pageW, pageH]);
      const embedded = await doc.embedPng(imageBytes);
      page.drawImage(embedded, { x: 0, y: 0, width: pageW, height: pageH });

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
          step: ProcessingStep.COMPLETE,
          progress: 100,
          totalFiles: 1,
          processedFiles: 1
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
      const img = new Image();
      img.src = compositedBase64;
      await new Promise<void>((res) => { img.onload = () => res(); });

      if (layoutMode === 'individual') {
        const { pw, ph } = getPhotoPxSize();
        const singleCanvas = document.createElement('canvas');
        singleCanvas.width = pw;
        singleCanvas.height = ph;
        const sCtx = singleCanvas.getContext('2d')!;
        sCtx.fillStyle = '#FFFFFF';
        sCtx.fillRect(0, 0, pw, ph);
        sCtx.drawImage(img, 0, 0, pw, ph);
        if (showCuttingBorders) {
          sCtx.strokeStyle = '#D1D5DB';
          sCtx.lineWidth = 2;
          sCtx.strokeRect(0, 0, pw, ph);
        }
        dataUrl = singleCanvas.toDataURL(`image/${format}`);
      } else {
        const is4x6 = paperSize === '4x6' || layoutMode === '4x6';
        const sheetW = is4x6 ? 1800 : A4_W;
        const sheetH = is4x6 ? 1200 : A4_H;
        dataUrl = compileGrid(sheetW, sheetH, img).toDataURL(`image/${format}`);
      }

      const defaultName = `passport_${layoutMode === 'individual' ? 'photo' : layoutMode === '3by4' ? 'sheet_3x4' : layoutMode === '4by4' ? 'sheet_4x4' : 'sheet'}.${format}`;
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
          step: ProcessingStep.COMPLETE,
          progress: 100,
          totalFiles: 1,
          processedFiles: 1
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

  const handlePrint = async () => {
    if (!compositedBase64) return;
    const img = new Image();
    img.src = compositedBase64;
    await new Promise<void>((res) => { img.onload = () => res(); });

    const is4x6 = paperSize === '4x6' || layoutMode === '4x6';
    const sheetW = is4x6 ? 1800 : A4_W;
    const sheetH = is4x6 ? 1200 : A4_H;
    const printCanvas = compileGrid(sheetW, sheetH, img);
    const dataUrl = printCanvas.toDataURL('image/png');

    const printWin = window.open('', '_blank');
    if (printWin) {
      printWin.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Print Passport Photos</title>
            <style>
              @page { size: ${is4x6 ? '6in 4in landscape' : 'A4 portrait'}; margin: 0; }
              body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #fff; }
              img { max-width: 100%; max-height: 100%; object-fit: contain; }
            </style>
          </head>
          <body>
            <img src="${dataUrl}" onload="window.print();" />
          </body>
        </html>
      `);
      printWin.document.close();
    } else {
      toast.error('Could not open print window. Please save as PDF to print.');
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
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-text-primary">Passport Photo Maker</h1>
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-[11px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Active
              </span>
            </div>
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

      {/* ── Document Switcher Bar ── */}
      <DocumentSelectorBar
        activeDocumentId={currentDocId || undefined}
        onSelectDocument={(doc) => loadDocumentIntoEditor(doc)}
        acceptedTypes={[DocumentType.IMAGE]}
        title="Passport Photo"
      />
      {!sourceImgSrc ? (
        <div 
          className="flex-1 flex flex-col items-center justify-center p-8"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={handleDropFile}
        >
          <div className="bg-bg-surface p-10 rounded-xl border-2 border-dashed border-border hover:border-accent shadow-md max-w-md w-full text-center flex flex-col items-center animate-scale-in transition-colors">
            <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center text-accent mb-6">
              <Camera size={32} />
            </div>
            <h2 className="text-lg font-bold text-text-primary mb-2">Upload Portrait Image</h2>
            <p className="text-sm text-text-secondary mb-6 max-w-[280px]">
              Drag and drop an image here, or upload a front-facing selfie to create passport photos.
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
              {/* Left: size options & scaling */}
              <div className="w-80 border-r border-border bg-bg-surface flex flex-col p-6 overflow-y-auto scrollbar-thin">
                <h2 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-1.5">
                  <Scissors size={16} className="text-accent" /> Select Photo Size
                </h2>

                <div className="flex flex-col gap-2 mb-4">
                  {SIZE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedSizeId(opt.id)}
                      className={`p-2.5 border rounded-lg text-left transition-fast ${
                        selectedSizeId === opt.id
                          ? 'border-accent bg-accent/5 shadow-sm'
                          : 'border-border hover:border-text-secondary hover:bg-bg-sunken'
                      }`}
                    >
                      <p className={`text-xs font-bold ${selectedSizeId === opt.id ? 'text-accent' : 'text-text-primary'}`}>
                        {opt.name}
                      </p>
                      <p className="text-[11px] text-text-secondary mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>

                {selectedSizeId === 'custom' && (
                  <div className="border border-border/80 rounded-lg p-3 bg-bg-base/40 flex flex-col gap-3 mb-4 animate-fade-in">
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

                {/* ── Image Scaling (1:1 Ratio) & Framing ── */}
                <div className="border border-border rounded-xl p-3.5 bg-bg-base/60 flex flex-col gap-2.5 mb-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                      <ZoomIn size={13} className="text-accent" /> Image Scale (1:1 Ratio)
                    </span>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-bg-surface border border-border text-accent">
                      {Math.round(imageScale * 100)}%
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setImageScale((s) => Math.max(0.2, parseFloat((s - 0.05).toFixed(2))))}
                      className="p-1.5 rounded-lg border border-border hover:bg-bg-sunken text-text-secondary hover:text-text-primary transition-colors"
                      title="Shrink image"
                    >
                      <Minus size={13} />
                    </button>
                    <input
                      type="range"
                      min="20"
                      max="250"
                      step="5"
                      value={Math.round(imageScale * 100)}
                      onChange={(e) => setImageScale(parseFloat((parseInt(e.target.value) / 100).toFixed(2)))}
                      className="flex-1 h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                    <button
                      onClick={() => setImageScale((s) => Math.min(3.0, parseFloat((s + 0.05).toFixed(2))))}
                      className="p-1.5 rounded-lg border border-border hover:bg-bg-sunken text-text-secondary hover:text-text-primary transition-colors"
                      title="Enlarge image"
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      onClick={() => { setImageScale(1.0); setImagePan({ x: 0, y: 0 }); }}
                      className="px-2 py-1 text-[11px] font-semibold rounded border border-border hover:bg-bg-sunken text-text-secondary transition-colors"
                      title="Reset to 100%"
                    >
                      Reset
                    </button>
                  </div>

                  {/* Panning Position Controls */}
                  <div className="pt-2 border-t border-border/70 flex items-center justify-between">
                    <span className="text-[10px] text-text-secondary font-medium">Position Image:</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setImagePan((p) => ({ ...p, x: p.x - 20 }))}
                        className="w-6 h-6 flex items-center justify-center rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary text-xs"
                        title="Move Left"
                      >
                        ←
                      </button>
                      <button
                        onClick={() => setImagePan((p) => ({ ...p, y: p.y - 20 }))}
                        className="w-6 h-6 flex items-center justify-center rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary text-xs"
                        title="Move Up"
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => setImagePan((p) => ({ ...p, y: p.y + 20 }))}
                        className="w-6 h-6 flex items-center justify-center rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary text-xs"
                        title="Move Down"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => setImagePan((p) => ({ ...p, x: p.x + 20 }))}
                        className="w-6 h-6 flex items-center justify-center rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary text-xs"
                        title="Move Right"
                      >
                        →
                      </button>
                      <button
                        onClick={() => setImagePan({ x: 0, y: 0 })}
                        className="px-1.5 py-0.5 text-[10px] rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary ml-1"
                        title="Center Image"
                      >
                        Center
                      </button>
                    </div>
                  </div>

                  <p className="text-[10px] text-text-muted leading-relaxed">
                    Shrinking fills the background with pure white. You can also scroll the mouse wheel over the photo to zoom in or shrink.
                  </p>
                </div>

                {/* Info card */}
                <div className="bg-bg-base/50 border border-border rounded-lg p-2.5 mb-4">
                  <p className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-0.5">Active Dimensions</p>
                  <p className="text-xs font-semibold text-text-primary">
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
                  Drag the frame or corners to adjust &bull; Scroll to resize photo
                </span>
                <h2 className="text-sm font-bold text-text-primary mb-6">Crop Frame</h2>

                <div className="relative bg-bg-surface p-3 rounded-lg border border-border shadow-md flex items-center justify-center overflow-hidden">
                  <div
                    ref={cropWrapRef}
                    className="relative select-none"
                    style={{ display: 'inline-block' }}
                  >
                    {/* Hidden reference img */}
                    <img
                      ref={imgRef}
                      src={sourceImgSrc}
                      alt="Source"
                      className="hidden"
                      onLoad={handleImgLoad}
                    />

                    {/* Stage Canvas with White Background + Scaled/Panned Photo */}
                    <canvas
                      ref={stageCanvasRef}
                      className="max-h-[55vh] max-w-full object-contain block shadow-sm border border-border/40 rounded bg-white select-none cursor-default"
                      onWheel={(e) => {
                        e.preventDefault();
                        const delta = e.deltaY < 0 ? 0.05 : -0.05;
                        setImageScale((prev) => Math.max(0.2, Math.min(3.0, parseFloat((prev + delta).toFixed(2)))));
                      }}
                    />

                    {/* Dark overlay outside crop area */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5))`,
                        clipPath: `polygon(
                          0% 0%, 100% 0%, 100% 100%, 0% 100%,
                          0% 0%,
                          ${(cropRect.x / (stageCanvasRef.current?.width || 1)) * 100}% ${(cropRect.y / (stageCanvasRef.current?.height || 1)) * 100}%,
                          ${(cropRect.x / (stageCanvasRef.current?.width || 1)) * 100}% ${((cropRect.y + cropRect.h) / (stageCanvasRef.current?.height || 1)) * 100}%,
                          ${((cropRect.x + cropRect.w) / (stageCanvasRef.current?.width || 1)) * 100}% ${((cropRect.y + cropRect.h) / (stageCanvasRef.current?.height || 1)) * 100}%,
                          ${((cropRect.x + cropRect.w) / (stageCanvasRef.current?.width || 1)) * 100}% ${(cropRect.y / (stageCanvasRef.current?.height || 1)) * 100}%,
                          ${(cropRect.x / (stageCanvasRef.current?.width || 1)) * 100}% ${(cropRect.y / (stageCanvasRef.current?.height || 1)) * 100}%
                        )`,
                      }}
                    />

                    {/* Crop overlay */}
                    <div
                      className="absolute border-2 border-white/90 cursor-move shadow-lg"
                      style={cropOverlayStyle()}
                      onMouseDown={(e) => handleCropMouseDown(e, 'move')}
                    >
                      {/* Rule of thirds */}
                      <div className="absolute top-1/3 left-0 right-0 border-t border-white/30 pointer-events-none" />
                      <div className="absolute top-2/3 left-0 right-0 border-t border-white/30 pointer-events-none" />
                      <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/30 pointer-events-none" />
                      <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/30 pointer-events-none" />

                      {/* Corner handles */}
                      <div className="absolute w-4 h-4 bg-white border-2 border-accent -top-2 -left-2 rounded-full cursor-nwse-resize shadow-md" onMouseDown={(e) => handleCropMouseDown(e, 'tl')} />
                      <div className="absolute w-4 h-4 bg-white border-2 border-accent -top-2 -right-2 rounded-full cursor-nesw-resize shadow-md" onMouseDown={(e) => handleCropMouseDown(e, 'tr')} />
                      <div className="absolute w-4 h-4 bg-white border-2 border-accent -bottom-2 -left-2 rounded-full cursor-nesw-resize shadow-md" onMouseDown={(e) => handleCropMouseDown(e, 'bl')} />
                      <div className="absolute w-4 h-4 bg-white border-2 border-accent -bottom-2 -right-2 rounded-full cursor-nwse-resize shadow-md" onMouseDown={(e) => handleCropMouseDown(e, 'br')} />

                      {/* Dimension label */}
                      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/75 text-white text-[9px] px-2 py-0.5 rounded whitespace-nowrap font-mono pointer-events-none">
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
                <div className="flex flex-col gap-2 mb-4">
                  <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Background Options</span>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { mode: 'none' as const, label: 'Keep Original', icon: <Check size={12} /> },
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

                {/* When Keep Original is selected */}
                {brushMode === 'none' && (
                  <div className="p-3 bg-bg-base/60 border border-border rounded-lg text-[11px] text-text-secondary leading-relaxed mb-4">
                    <span className="font-semibold text-text-primary block mb-0.5">Original Background Preserved</span>
                    Your photo background has not been altered. If your photo already has an acceptable background, proceed directly to Layout & Save. To remove or recolor it, select a tool above.
                  </div>
                )}

                {/* When Auto Keyer is selected, show run button */}
                {brushMode === 'auto' && (
                  <div className="mb-4">
                    <Button variant="secondary" size="sm" className="w-full text-xs font-semibold justify-center py-2" onClick={runAutoBackground}>
                      <RefreshCw size={13} className="mr-1.5" /> Clean Background Now
                    </Button>
                  </div>
                )}

                {/* Sliders */}
                {brushMode !== 'none' && (
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
                )}

                {/* Background colour */}
                <div className="flex flex-col gap-2 mb-6">
                  <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
                    Replacement Background Colour
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
                  {brushMode === 'none' && 'Original photo background preserved'}
                  {brushMode === 'ai' && 'AI background remover is processing...'}
                  {brushMode === 'auto' && 'Adjust tolerance or click "Clean Background Now" to remove background'}
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
                  <RefreshCw size={12} /> Reset / Revert to Original
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

                <div className="flex flex-col gap-2.5 mb-4">
                  <span className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Format</span>
                  {([
                    { mode: 'individual' as const, title: 'Individual Photo', desc: `Single photo (${activeSz.wMm} × ${activeSz.hMm} mm)`, badge: '1 Photo' },
                    { mode: '3by4' as const, title: '3 × 4 Passport Sheet', desc: '12 photos: 3 columns × 4 rows', badge: '12 Photos' },
                    { mode: '4by4' as const, title: 'Full 4 × 4 Grid', desc: '16 photos: 4 columns × 4 rows', badge: '16 Photos' },
                    { mode: '4x6' as const, title: '4 × 6" Photo Paper', desc: '8 photos on 10 × 15 cm paper', badge: '8 Photos' },
                    { mode: 'a4' as const, title: 'Full A4 Auto-Fill', desc: 'Maximum photo yield on A4 page', badge: 'Auto Yield' },
                    { mode: 'custom' as const, title: 'Custom Grid', desc: 'Configure custom rows & columns', badge: `${customCols * customRows} Photos` },
                  ]).map((opt) => (
                    <button
                      key={opt.mode}
                      onClick={() => setLayoutMode(opt.mode)}
                      className={`p-2.5 border rounded-lg text-left transition-fast flex items-center justify-between ${
                        layoutMode === opt.mode
                          ? 'border-accent bg-accent/5 shadow-sm'
                          : 'border-border hover:border-text-secondary hover:bg-bg-sunken'
                      }`}
                    >
                      <div>
                        <p className={`text-xs font-bold ${layoutMode === opt.mode ? 'text-accent' : 'text-text-primary'}`}>
                          {opt.title}
                        </p>
                        <p className="text-[11px] text-text-secondary mt-0.5">{opt.desc}</p>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-bg-surface border border-border text-text-secondary font-semibold shrink-0">
                        {opt.badge}
                      </span>
                    </button>
                  ))}
                </div>

                {layoutMode === 'custom' && (
                  <div className="border border-border/80 rounded-lg p-3 bg-bg-base/40 flex flex-col gap-3 mb-4 animate-fade-in">
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

                {/* Paper Size & Guides */}
                <div className="flex flex-col gap-3 mb-4 p-3 bg-bg-base/60 border border-border rounded-xl">
                  <div>
                    <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider block mb-1.5">
                      Paper Size
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setPaperSize('A4')}
                        className={`py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                          paperSize === 'A4'
                            ? 'bg-accent text-white border-accent'
                            : 'bg-bg-surface border-border text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        A4 (210×297 mm)
                      </button>
                      <button
                        onClick={() => setPaperSize('4x6')}
                        className={`py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                          paperSize === '4x6'
                            ? 'bg-accent text-white border-accent'
                            : 'bg-bg-surface border-border text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        4 × 6&quot; Photo Paper
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-text-secondary hover:text-text-primary pt-2 border-t border-border/60">
                    <input
                      type="checkbox"
                      checked={showCuttingBorders}
                      onChange={(e) => setShowCuttingBorders(e.target.checked)}
                      className="accent-accent rounded cursor-pointer w-3.5 h-3.5"
                    />
                    <span>Show thin cutting borders</span>
                  </label>
                </div>

                <div className="flex flex-col gap-2 mb-4">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Filename</label>
                  <input
                    type="text" value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    placeholder="Filename"
                    className="px-3 py-2 border border-border rounded-md text-sm bg-bg-surface focus:outline-none focus:border-accent text-text-primary"
                  />
                </div>

                <div className="flex flex-col gap-2 mt-auto">
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full text-center font-bold"
                    onClick={handleExportPDF}
                    disabled={exporting}
                  >
                    {exporting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Download size={16} className="mr-2" />}
                    Save Layout PDF
                  </Button>

                  <Button
                    variant="secondary"
                    size="md"
                    className="w-full text-center font-semibold"
                    onClick={handlePrint}
                    disabled={exporting}
                  >
                    <Printer size={15} className="mr-1.5 text-accent" /> Print Sheet
                  </Button>

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
                <span className="text-xs font-semibold text-text-secondary mb-1">Review before saving or printing</span>
                <h2 className="text-sm font-bold text-text-primary mb-6">
                  Print Preview ({layoutMode === 'individual' ? '1 Photo' : paperSize === '4x6' ? '4 × 6" Photo Paper' : 'A4 Document'})
                </h2>

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
