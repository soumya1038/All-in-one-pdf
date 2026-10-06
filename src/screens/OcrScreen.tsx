import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { DocumentType } from '../types/Document.types';
import Button from '../components/ui/Button';
import DocumentSelectorBar from '../components/document/DocumentSelectorBar';
import { registerUploadedFile } from '../utils/fileUploadHelper';
import {
  ArrowLeft,
  Copy,
  Download,
  FileText,
  Loader2,
  Sparkles,
  AlertCircle,
  Upload,
  Image as ImageIcon,
  Search,
  Replace,
  Eye,
  EyeOff,
  RotateCcw,
  RotateCw,
  SunMedium,
  Contrast,
  ChevronLeft,
  ChevronRight,
  Type,
  Table2,
  FileDown,
  Trash2,
  FolderOpen,
  CheckCircle2,
  Layers,
  Settings2,
  ChevronsUpDown,
  MousePointerSquare,
  Crop,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  FileJson,
  Wand2,
  AlignLeft,
  Columns,
  PanelLeft,
  PanelRight,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import Tesseract from 'tesseract.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/* ─── Language Registry ─── */
const LANGUAGES = [
  { code: 'eng', label: 'English', flag: '🇬🇧' },
  { code: 'hin', label: 'Hindi (हिन्दी)', flag: '🇮🇳' },
  { code: 'ben', label: 'Bengali (বাংলা)', flag: '🇧🇩' },
  { code: 'tam', label: 'Tamil (தமிழ்)', flag: '🇮🇳' },
  { code: 'tel', label: 'Telugu (తెలుగు)', flag: '🇮🇳' },
  { code: 'mar', label: 'Marathi (मराठी)', flag: '🇮🇳' },
  { code: 'kan', label: 'Kannada (ಕನ್ನಡ)', flag: '🇮🇳' },
  { code: 'guj', label: 'Gujarati (ગુજરાતી)', flag: '🇮🇳' },
  { code: 'mal', label: 'Malayalam (മലയാളം)', flag: '🇮🇳' },
  { code: 'pan', label: 'Punjabi (ਪੰਜਾਬੀ)', flag: '🇮🇳' },
  { code: 'ori', label: 'Odia (ଓଡ଼ିଆ)', flag: '🇮🇳' },
  { code: 'urd', label: 'Urdu (اردو)', flag: '🇵🇰' },
  { code: 'spa', label: 'Spanish (Español)', flag: '🇪🇸' },
  { code: 'fra', label: 'French (Français)', flag: '🇫🇷' },
  { code: 'deu', label: 'German (Deutsch)', flag: '🇩🇪' },
  { code: 'ita', label: 'Italian (Italiano)', flag: '🇮🇹' },
  { code: 'por', label: 'Portuguese (Português)', flag: '🇧🇷' },
  { code: 'rus', label: 'Russian (Русский)', flag: '🇷🇺' },
  { code: 'ara', label: 'Arabic (العربية)', flag: '🇸🇦' },
  { code: 'jpn', label: 'Japanese (日本語)', flag: '🇯🇵' },
  { code: 'kor', label: 'Korean (한국어)', flag: '🇰🇷' },
  { code: 'chi_sim', label: 'Chinese Simplified (简体)', flag: '🇨🇳' },
  { code: 'chi_tra', label: 'Chinese Traditional (繁體)', flag: '🇹🇼' },
  { code: 'tha', label: 'Thai (ภาษาไทย)', flag: '🇹🇭' },
  { code: 'vie', label: 'Vietnamese (Tiếng Việt)', flag: '🇻🇳' },
  { code: 'nep', label: 'Nepali (नेपाली)', flag: '🇳🇵' },
];

/* ─── Types ─── */
interface OcrPageResult {
  pageIndex: number;
  text: string;
  words: Tesseract.Word[];
  confidence: number;
  imageUrl: string; // data-url or docuflow url for the page preview
}

type PreprocessMode = 'none' | 'grayscale' | 'threshold' | 'highContrast' | 'invert';
type ExportFormat = 'txt' | 'pdf' | 'csv' | 'json';

/* ─── Binary & File Saving Helpers ─── */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 16384;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

async function saveExportFile(
  dataUrl: string,
  defaultFilename: string,
  filters: { name: string; extensions: string[] }[]
): Promise<boolean> {
  try {
    if (window.electron?.saveFileFromBase64) {
      const res = await window.electron.saveFileFromBase64(dataUrl, defaultFilename, filters);
      return res.success;
    } else {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = defaultFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    }
  } catch (err) {
    console.error('Save file error:', err);
    return false;
  }
}

/* ─── Preprocess Helpers ─── */
function preprocessImage(
  imageUrl: string,
  mode: PreprocessMode,
  thresholdValue: number,
  brightnessValue: number,
  contrastValue: number,
  rotation: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');

      // Handle rotation dimensions
      const rotated90 = rotation === 90 || rotation === 270;
      canvas.width = rotated90 ? img.naturalHeight : img.naturalWidth;
      canvas.height = rotated90 ? img.naturalWidth : img.naturalHeight;

      const ctx = canvas.getContext('2d')!;

      // Apply rotation
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(
        img,
        -img.naturalWidth / 2,
        -img.naturalHeight / 2,
        img.naturalWidth,
        img.naturalHeight
      );
      ctx.restore();

      // Apply brightness/contrast via CSS filter rendering
      if (brightnessValue !== 100 || contrastValue !== 100) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.filter = `brightness(${brightnessValue}%) contrast(${contrastValue}%)`;
        tempCtx.drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0);
      }

      // Apply mode transformations
      if (mode !== 'none') {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;

          if (mode === 'grayscale') {
            data[i] = gray;
            data[i + 1] = gray;
            data[i + 2] = gray;
          } else if (mode === 'threshold') {
            const val = gray >= thresholdValue ? 255 : 0;
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
          } else if (mode === 'highContrast') {
            // High contrast: boost center & darken edges
            const boosted = ((gray - 128) * 2.5 + 128);
            const clamped = Math.max(0, Math.min(255, boosted));
            data[i] = clamped;
            data[i + 1] = clamped;
            data[i + 2] = clamped;
          } else if (mode === 'invert') {
            // Invert colors (ideal for white text on dark background)
            data[i] = 255 - r;
            data[i + 1] = 255 - g;
            data[i + 2] = 255 - b;
          }
        }
        ctx.putImageData(imageData, 0, 0);
      }

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image for preprocessing'));
    img.src = imageUrl;
  });
}

/* ─── Main Component ─── */
export default function OcrScreen() {
  const setView = useAppStore((s) => s.setView);
  const documents = useAppStore((s) => s.documents);

  const selectedDocumentId = useAppStore((s) => s.ui.selectedDocumentId);
  const setSelectedDocument = useAppStore((s) => s.setSelectedDocument);

  /* ── Source selection ── */
  const [sourceMode, setSourceMode] = useState<'upload' | 'library'>(() => {
    return documents.length > 0 ? 'library' : 'upload';
  });
  const [selectedDocId, setSelectedDocId] = useState<string>(() => {
    if (selectedDocumentId && documents.some(d => d.id === selectedDocumentId)) return selectedDocumentId;
    return documents[0]?.id || '';
  });
  const [selectedPage, setSelectedPage] = useState(1);

  /* ── Uploaded standalone images ── */
  const [uploadedImages, setUploadedImages] = useState<{ name: string; dataUrl: string }[]>([]);
  const [activeUploadIdx, setActiveUploadIdx] = useState(0);

  /* ── Languages ── */
  const [languages, setLanguages] = useState<string[]>(['eng']);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [langSearch, setLangSearch] = useState('');

  /* ── Preprocessing ── */
  const [preprocessMode, setPreprocessMode] = useState<PreprocessMode>('none');
  const [thresholdVal, setThresholdVal] = useState(128);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [rotation, setRotation] = useState(0);

  /* ── Region crop selection ── */
  const [regionMode, setRegionMode] = useState(false);
  const [regionRect, setRegionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [isDrawingRegion, setIsDrawingRegion] = useState(false);
  const [regionAnchor, setRegionAnchor] = useState<{ x: number; y: number } | null>(null);
  const previewImgRef = useRef<HTMLImageElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  /* ── OCR state ── */
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState('');
  const [pageResults, setPageResults] = useState<OcrPageResult[]>([]);
  const [activeResultPage, setActiveResultPage] = useState(0);

  /* ── Text editor ── */
  const [editedTexts, setEditedTexts] = useState<Record<number, string>>({});
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matchCount, setMatchCount] = useState(0);

  /* ── Overlay & zoom ── */
  const [showWordOverlay, setShowWordOverlay] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);

  /* ── Export ── */
  const [exporting, setExporting] = useState(false);
  const [filename, setFilename] = useState('ocr_output');

  /* ── Preview path for library docs ── */
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState(Date.now());
  const [preprocessedUrl, setPreprocessedUrl] = useState<string | null>(null);

  /* ─── Resizable 3-Column Panels ─── */
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = localStorage.getItem('docuflow_ocr_left_width');
    return saved ? Math.max(220, Math.min(550, parseInt(saved, 10))) : 320;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const saved = localStorage.getItem('docuflow_ocr_right_width');
    return saved ? Math.max(260, Math.min(750, parseInt(saved, 10))) : 400;
  });
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);

  /* ─── Document Layout / PSM Mode ─── */
  const [psmMode, setPsmMode] = useState<'auto' | '3' | '6' | '11'>('auto');

  useEffect(() => {
    localStorage.setItem('docuflow_ocr_left_width', leftWidth.toString());
  }, [leftWidth]);

  useEffect(() => {
    localStorage.setItem('docuflow_ocr_right_width', rightWidth.toString());
  }, [rightWidth]);

  const handleResetLayout = () => {
    setLeftWidth(320);
    setRightWidth(400);
    setIsLeftCollapsed(false);
    setIsRightCollapsed(false);
    localStorage.removeItem('docuflow_ocr_left_width');
    localStorage.removeItem('docuflow_ocr_right_width');
    toast.success('Layout reset to default (320px / 400px)');
  };

  const handleStartDragLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
    const startX = e.clientX;
    const startW = isLeftCollapsed ? 220 : leftWidth;
    if (isLeftCollapsed) setIsLeftCollapsed(false);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newW = Math.max(220, Math.min(550, startW + delta));
      setLeftWidth(newW);
    };

    const onMouseUp = () => {
      setIsDraggingLeft(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [leftWidth, isLeftCollapsed]);

  const handleStartDragRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingRight(true);
    const startX = e.clientX;
    const startW = isRightCollapsed ? 300 : rightWidth;
    if (isRightCollapsed) setIsRightCollapsed(false);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newW = Math.max(260, Math.min(750, startW + delta));
      setRightWidth(newW);
    };

    const onMouseUp = () => {
      setIsDraggingRight(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [rightWidth, isRightCollapsed]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeDoc = documents.find((d) => d.id === selectedDocId) || null;

  /* ═══════════════════════════════════════════
   *  Auto-select first doc
   * ═══════════════════════════════════════════ */
  useEffect(() => {
    if (documents.length > 0) {
      if (!selectedDocId || !documents.some((d) => d.id === selectedDocId)) {
        const targetId = (selectedDocumentId && documents.some((d) => d.id === selectedDocumentId))
          ? selectedDocumentId
          : documents[0].id;
        setSelectedDocId(targetId);
        setSelectedPage(1);
        setSourceMode('library');
      } else if (selectedDocumentId && documents.some((d) => d.id === selectedDocumentId) && selectedDocumentId !== selectedDocId) {
        setSelectedDocId(selectedDocumentId);
        setSelectedPage(1);
        setSourceMode('library');
      }
    }
  }, [documents, selectedDocId, selectedDocumentId]);

  /* ═══════════════════════════════════════════
   *  Load preview from library doc
   * ═══════════════════════════════════════════ */
  useEffect(() => {
    if (sourceMode !== 'library' || !selectedDocId) {
      setPreviewPath(null);
      return;
    }

    const load = async () => {
      try {
        if (activeDoc?.type === DocumentType.PDF) {
          const res = await window.electron.renderPdfPage(selectedDocId, selectedPage);
          if (res.success) {
            setPreviewPath(res.data);
            setTimestamp(Date.now());
          } else {
            setPreviewPath(null);
          }
        } else if (activeDoc?.type === DocumentType.IMAGE) {
          setPreviewPath(activeDoc.tempPath);
          setTimestamp(Date.now());
        }
      } catch {
        setPreviewPath(null);
      }
    };
    load();
  }, [selectedDocId, selectedPage, activeDoc, sourceMode]);

  /* ═══════════════════════════════════════════
   *  Build preprocessed preview URL
   * ═══════════════════════════════════════════ */
  const getSourceImageUrl = useCallback((): string | null => {
    if (sourceMode === 'upload') {
      if (uploadedImages.length === 0) return null;
      return uploadedImages[activeUploadIdx]?.dataUrl || null;
    } else {
      if (!previewPath) return null;
      return `docuflow:///${previewPath.replace(/\\/g, '/')}?t=${timestamp}`;
    }
  }, [sourceMode, uploadedImages, activeUploadIdx, previewPath, timestamp]);

  useEffect(() => {
    const src = getSourceImageUrl();
    if (!src) {
      setPreprocessedUrl(null);
      return;
    }
    // Only preprocess if needed
    if (preprocessMode === 'none' && brightness === 100 && contrast === 100 && rotation === 0) {
      setPreprocessedUrl(src);
      return;
    }

    let cancelled = false;
    preprocessImage(src, preprocessMode, thresholdVal, brightness, contrast, rotation).then((url) => {
      if (!cancelled) setPreprocessedUrl(url);
    }).catch(() => {
      if (!cancelled) setPreprocessedUrl(src); // fallback
    });
    return () => { cancelled = true; };
  }, [getSourceImageUrl, preprocessMode, thresholdVal, brightness, contrast, rotation]);

  /* ═══════════════════════════════════════════
   *  File Upload Handlers (Images & PDFs)
   * ═══════════════════════════════════════════ */
  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    loadImageFiles(files);
    e.target.value = '';
  };

  const loadImageFiles = async (files: File[]) => {
    if (!files || files.length === 0) return;

    // Register into shared app session so all tools have access
    for (const file of files) {
      try {
        await registerUploadedFile(file);
      } catch (err) {
        console.warn('Failed to register file in store:', err);
      }
    }

    const newItems: { name: string; dataUrl: string }[] = [];
    let pdfCount = 0;

    for (const file of files) {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file.name);

      if (isPdf) {
        pdfCount++;
        try {
          const filePath = (file as any).path;
          let renderRes;
          if (filePath && window.electron?.renderPdfPagesForOcr) {
            renderRes = await window.electron.renderPdfPagesForOcr({ filePath });
          } else if (window.electron?.renderPdfPagesForOcr) {
            const base64Data = await readFileAsDataUrl(file);
            renderRes = await window.electron.renderPdfPagesForOcr({ base64Data });
          }

          if (renderRes?.success && renderRes.data && renderRes.data.length > 0) {
            renderRes.data.forEach((p) => {
              newItems.push({ name: p.name, dataUrl: p.dataUrl });
            });
          } else {
            toast.error(`Could not extract pages from ${file.name}`);
          }
        } catch (pdfErr: any) {
          console.error('PDF extraction error:', pdfErr);
          if (pdfErr?.message?.includes('No handler registered')) {
            toast.error('Please restart DocuFlow (restart "npm run dev") to enable PDF OCR extraction.');
          } else {
            toast.error(`Failed to process PDF ${file.name}`);
          }
        }
      } else if (isImage) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          newItems.push({ name: file.name, dataUrl });
        } catch {
          toast.error(`Failed to read image ${file.name}`);
        }
      }
    }

    if (newItems.length > 0) {
      setUploadedImages((prev) => [...prev, ...newItems]);
      if (uploadedImages.length === 0) setActiveUploadIdx(0);
      const msg = pdfCount > 0
        ? `Loaded ${newItems.length} page(s) / image(s)`
        : `Loaded ${newItems.length} image(s)`;
      toast.success(msg);
    } else if (files.length > 0) {
      toast.error('Please select valid image or PDF files (JPG, PNG, WebP, BMP, PDF)');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files) {
      loadImageFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleBrowse = async () => {
    try {
      const result = await window.electron.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Images & PDFs', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'pdf'] },
          { name: 'PDF Documents (*.pdf)', extensions: ['pdf'] },
          { name: 'Images (*.jpg, *.png, ...)', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'] },
        ],
      });
      if (result.success && result.data && result.data.length > 0) {
        const newItems: { name: string; dataUrl: string }[] = [];

        for (const filePath of result.data) {
          const isPdf = filePath.toLowerCase().endsWith('.pdf');
          if (isPdf && window.electron?.renderPdfPagesForOcr) {
            const pdfRes = await window.electron.renderPdfPagesForOcr({ filePath });
            if (pdfRes.success && pdfRes.data) {
              pdfRes.data.forEach((p) => newItems.push({ name: p.name, dataUrl: p.dataUrl }));
            }
          } else {
            const dataRes = await window.electron.readImageAsDataUrl(filePath);
            if (dataRes.success && dataRes.data) {
              const name = filePath.split(/[\\/]/).pop() || 'image';
              newItems.push({ name, dataUrl: dataRes.data });
            }
          }
        }

        if (newItems.length > 0) {
          setUploadedImages((prev) => [...prev, ...newItems]);
          if (uploadedImages.length === 0) setActiveUploadIdx(0);
          toast.success(`Loaded ${newItems.length} file/page(s)`);
        }
      }
    } catch {
      toast.error('Failed to open file dialog');
    }
  };

  const removeUploadedImage = (idx: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== idx));
    if (activeUploadIdx >= idx && activeUploadIdx > 0) {
      setActiveUploadIdx((p) => p - 1);
    }
  };

  /* ═══════════════════════════════════════════
   *  Region Selection (Crop OCR Area)
   * ═══════════════════════════════════════════ */
  const handleRegionMouseDown = (e: React.MouseEvent) => {
    if (!regionMode || !previewImgRef.current) return;
    e.preventDefault();
    const rect = previewImgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setRegionAnchor({ x, y });
    setRegionRect({ x, y, w: 0, h: 0 });
    setIsDrawingRegion(true);
  };

  const handleRegionMouseMove = (e: React.MouseEvent) => {
    if (!isDrawingRegion || !regionAnchor || !previewImgRef.current) return;
    const rect = previewImgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    setRegionRect({
      x: Math.min(regionAnchor.x, x),
      y: Math.min(regionAnchor.y, y),
      w: Math.abs(x - regionAnchor.x),
      h: Math.abs(y - regionAnchor.y),
    });
  };

  const handleRegionMouseUp = () => {
    setIsDrawingRegion(false);
    setRegionAnchor(null);
    // Discard tiny selections
    if (regionRect && (regionRect.w < 2 || regionRect.h < 2)) {
      setRegionRect(null);
    }
  };

  const cropRegionFromImage = useCallback(
    (imageUrl: string): Promise<string> => {
      if (!regionRect) return Promise.resolve(imageUrl);
      return new Promise((resolve, reject) => {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const sx = (regionRect.x / 100) * img.naturalWidth;
          const sy = (regionRect.y / 100) * img.naturalHeight;
          const sw = (regionRect.w / 100) * img.naturalWidth;
          const sh = (regionRect.h / 100) * img.naturalHeight;

          canvas.width = Math.max(1, Math.round(sw));
          canvas.height = Math.max(1, Math.round(sh));

          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('Failed to crop region'));
        img.src = imageUrl;
      });
    },
    [regionRect]
  );

  /* ═══════════════════════════════════════════
   *  Run OCR
   * ═══════════════════════════════════════════ */
  const handleRunOcr = async () => {
    const pagesToProcess: { idx: number; imageUrl: string; name: string }[] = [];

    if (sourceMode === 'upload') {
      if (uploadedImages.length === 0) {
        toast.error('Please upload at least one image first.');
        return;
      }
      uploadedImages.forEach((img, idx) => {
        pagesToProcess.push({ idx, imageUrl: img.dataUrl, name: img.name });
      });
    } else {
      if (!previewPath) {
        toast.error('No page preview available to OCR.');
        return;
      }
      const url = `docuflow:///${previewPath.replace(/\\/g, '/')}`;
      pagesToProcess.push({
        idx: 0,
        imageUrl: url,
        name: activeDoc?.filename || 'page',
      });
    }

    setIsProcessing(true);
    setOcrProgress(0);
    setOcrStatus('Preparing images...');
    setPageResults([]);
    setEditedTexts({});
    setActiveResultPage(0);

    const langString = languages.join('+');
    const results: OcrPageResult[] = [];
    const total = pagesToProcess.length;

    try {
      for (let i = 0; i < total; i++) {
        const page = pagesToProcess[i];
        setOcrStatus(`Processing page ${i + 1} of ${total}: ${page.name}`);

        // 1. Preprocess the image
        let processedUrl = page.imageUrl;
        try {
          processedUrl = await preprocessImage(
            page.imageUrl,
            preprocessMode,
            thresholdVal,
            brightness,
            contrast,
            rotation
          );
        } catch {
          // use original if preprocess fails
        }

        // 2. Crop region if selected (only for single image or first)
        if (regionRect && (total === 1 || i === activeUploadIdx)) {
          try {
            processedUrl = await cropRegionFromImage(processedUrl);
          } catch {
            // continue with full image
          }
        }

        // 3. Run Tesseract (Offline via Node Main Process when in Electron)
        let ocrText = '';
        let ocrConfidence = 0;
        let ocrWords: any[] = [];

        if (window.electron?.runOcr) {
          setOcrStatus(`Page ${i + 1}/${total}: Running offline OCR engine (${langString})...`);
          setOcrProgress(Math.round(((i + 0.3) / total) * 100));

          try {
            const ocrRes = await window.electron.runOcr({
              imageSource: processedUrl,
              languages,
              region: regionRect && (total === 1 || i === activeUploadIdx) ? regionRect : undefined,
              psm: psmMode,
              invert: preprocessMode === 'invert' ? true : undefined,
            });

            if (!ocrRes.success) {
              throw new Error(ocrRes.error?.message || 'OCR failed');
            }

            ocrText = ocrRes.data?.text || '';
            ocrConfidence = ocrRes.data?.confidence || 0;
            ocrWords = ocrRes.data?.words || [];
            setOcrProgress(Math.round(((i + 1) / total) * 100));
          } catch (ipcErr: any) {
            if (ipcErr?.message?.includes('No handler registered')) {
              throw new Error(
                'DocuFlow desktop app needs to be restarted to load the new offline OCR engine. Please restart "npm run dev".'
              );
            }
            throw ipcErr;
          }
        } else {
          // Web fallback
          const result = (await Tesseract.recognize(processedUrl, langString, {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                const pageProgress = (i / total + (m.progress || 0) / total) * 100;
                setOcrProgress(Math.round(pageProgress));
                setOcrStatus(
                  `Page ${i + 1}/${total}: Recognizing text... ${Math.round((m.progress || 0) * 100)}%`
                );
              } else {
                setOcrStatus(m.status || `Processing page ${i + 1}...`);
              }
            }
          })) as any;

          ocrText = result?.data?.text || '';
          ocrConfidence = result?.data?.confidence || 0;
          ocrWords = result?.data?.words || [];
        }

        results.push({
          pageIndex: i,
          text: ocrText,
          words: ocrWords,
          confidence: ocrConfidence,
          imageUrl: processedUrl,
        });
      }

      setPageResults(results);
      // Initialize editedTexts
      const textsMap: Record<number, string> = {};
      results.forEach((r) => {
        textsMap[r.pageIndex] = r.text;
      });
      setEditedTexts(textsMap);

      if (results.length > 0) {
        setOcrProgress(100);
        const avgConf = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
        toast.success(
          `OCR complete! ${results.length} page(s) processed. Average confidence: ${avgConf.toFixed(1)}%`
        );
      } else {
        toast.error('No text detected in any page.');
      }
    } catch (err: any) {
      console.error('OCR error:', err);
      toast.error(`OCR Failed: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
      setOcrStatus('');
    }
  };

  /* ═══════════════════════════════════════════
   *  Text Utilities
   * ═══════════════════════════════════════════ */
  const currentText = editedTexts[activeResultPage] ?? pageResults[activeResultPage]?.text ?? '';

  const updateCurrentText = (text: string) => {
    setEditedTexts((prev) => ({ ...prev, [activeResultPage]: text }));
  };

  const getAllText = () => {
    if (pageResults.length === 0) return '';
    return pageResults
      .map((r) => {
        const txt = editedTexts[r.pageIndex] ?? r.text;
        return pageResults.length > 1 ? `--- Page ${r.pageIndex + 1} ---\n${txt}` : txt;
      })
      .join('\n\n');
  };

  const handleCopy = () => {
    const text = getAllText();
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast.success('Text copied to clipboard!');
  };

  // Find & Replace
  useEffect(() => {
    if (findText) {
      const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = currentText.match(regex);
      setMatchCount(matches?.length || 0);
    } else {
      setMatchCount(0);
    }
  }, [findText, currentText]);

  const handleReplaceAll = () => {
    if (!findText) return;
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const newText = currentText.replace(regex, replaceText);
    updateCurrentText(newText);
    toast.success(`Replaced ${matchCount} occurrence(s)`);
  };

  
  /* ── Text Cleanup & Formatting Helpers ── */
  const handleRemoveLineBreaks = () => {
    if (!currentText) return;
    const formatted = currentText
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .replace(/[ \t]+/g, ' ');
    updateCurrentText(formatted);
    toast.success('Joined single line breaks into continuous text');
  };

  const handleFixOcrFormatting = () => {
    if (!currentText) return;
    let formatted = currentText
      .replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim();
    updateCurrentText(formatted);
    toast.success('Cleaned hyphens, spaces & punctuation formatting');
  };

  const handleTransformCase = (targetCase: 'upper' | 'lower' | 'title') => {
    if (!currentText) return;
    let result = currentText;
    if (targetCase === 'upper') {
      result = currentText.toUpperCase();
    } else if (targetCase === 'lower') {
      result = currentText.toLowerCase();
    } else if (targetCase === 'title') {
      result = currentText.replace(/\b\w+/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
    }
    updateCurrentText(result);
    toast.success(`Converted text to ${targetCase} case`);
  };

  const handleClearText = () => {
    if (!currentText) return;
    updateCurrentText('');
    toast.success('Text cleared');
  };

  /* ═══════════════════════════════════════════
   *  Export Handlers
   * ═══════════════════════════════════════════ */
  const handleExport = async (format: ExportFormat) => {
    const text = getAllText();
    if (!text) {
      toast.error('No text to export. Run OCR first.');
      return;
    }

    setExporting(true);

    try {
      if (format === 'txt') {
        const base64Text = btoa(unescape(encodeURIComponent(text)));
        const saved = await saveExportFile(
          `data:text/plain;base64,${base64Text}`,
          `${filename}.txt`,
          [{ name: 'Text Files', extensions: ['txt'] }]
        );
        if (saved) toast.success('Text file saved!');
      } else if (format === 'csv') {
        const lines = text.split('\n').filter((l) => l.trim());
        const csvLines = lines.map((line) => {
          const cells = line.split(/\t+|\s{2,}/);
          return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
        });
        const csvContent = csvLines.join('\n');
        const base64Csv = btoa(unescape(encodeURIComponent(csvContent)));
        const saved = await saveExportFile(
          `data:text/csv;base64,${base64Csv}`,
          `${filename}.csv`,
          [{ name: 'CSV Files', extensions: ['csv'] }]
        );
        if (saved) toast.success('CSV file saved!');
      } else if (format === 'json') {
        const jsonPayload = {
          documentName: filename,
          extractedAt: new Date().toISOString(),
          languages,
          totalPages: pageResults.length,
          pages: pageResults.map((p) => ({
            pageIndex: p.pageIndex + 1,
            confidence: p.confidence,
            text: editedTexts[p.pageIndex] ?? p.text,
            words: p.words.map((w) => ({
              text: w.text,
              confidence: w.confidence,
              bbox: w.bbox,
            })),
          })),
        };
        const jsonString = JSON.stringify(jsonPayload, null, 2);
        const base64Json = btoa(unescape(encodeURIComponent(jsonString)));
        const saved = await saveExportFile(
          `data:application/json;base64,${base64Json}`,
          `${filename}.json`,
          [{ name: 'JSON Data', extensions: ['json'] }]
        );
        if (saved) toast.success('JSON file saved!');
      } else if (format === 'pdf') {
        await exportSearchablePdf();
      }
    } catch (err: any) {
      toast.error(`Export failed: ${err?.message || err}`);
    } finally {
      setExporting(false);
    }
  };

  const exportSearchablePdf = async () => {
    if (pageResults.length === 0) return;

    setOcrStatus('Generating searchable PDF...');

    try {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

      for (const pageResult of pageResults) {
        // Fetch image
        const imgResponse = await fetch(pageResult.imageUrl);
        const imgBlob = await imgResponse.blob();
        const arrayBuffer = await imgBlob.arrayBuffer();
        const imageBytes = new Uint8Array(arrayBuffer);

        // Embed image
        let embeddedImage;
        const isPng =
          pageResult.imageUrl.includes('.png') || pageResult.imageUrl.startsWith('data:image/png');
        try {
          embeddedImage = isPng
            ? await pdfDoc.embedPng(imageBytes)
            : await pdfDoc.embedJpg(imageBytes);
        } catch {
          // Try both formats as fallback
          try {
            embeddedImage = await pdfDoc.embedPng(imageBytes);
          } catch {
            embeddedImage = await pdfDoc.embedJpg(imageBytes);
          }
        }

        const width = embeddedImage.width;
        const height = embeddedImage.height;
        const page = pdfDoc.addPage([width, height]);

        page.drawImage(embeddedImage, { x: 0, y: 0, width, height });

        // Overlay invisible text for searchability
        pageResult.words.forEach((word) => {
          if (!word.text || !word.bbox) return;
          const { x0, y0, y1 } = word.bbox;
          const wordHeight = y1 - y0;

          page.drawText(word.text, {
            x: x0,
            y: height - y1,
            size: Math.max(4, wordHeight * 0.85),
            font,
            opacity: 0,
          });
        });
      }

      const pdfBytes = await pdfDoc.save();
      const base64Pdf = uint8ArrayToBase64(new Uint8Array(pdfBytes));
      const saved = await saveExportFile(
        `data:application/pdf;base64,${base64Pdf}`,
        `${filename}_searchable.pdf`,
        [{ name: 'PDF Documents', extensions: ['pdf'] }]
      );
      if (saved) toast.success('Searchable PDF saved!');
    } catch (err: any) {
      toast.error(`PDF generation failed: ${err?.message || err}`);
    } finally {
      setOcrStatus('');
    }
  };

  const handleDownloadTxt = async () => {
    await handleExport('txt');
  };

  /* ═══════════════════════════════════════════
   *  Language picker helpers
   * ═══════════════════════════════════════════ */
  const toggleLanguage = (code: string) => {
    setLanguages((prev) => {
      if (prev.includes(code)) {
        if (prev.length === 1) return prev; // must have at least one
        return prev.filter((l) => l !== code);
      }
      return [...prev, code];
    });
  };

  const filteredLanguages = LANGUAGES.filter(
    (l) =>
      l.label.toLowerCase().includes(langSearch.toLowerCase()) ||
      l.code.toLowerCase().includes(langSearch.toLowerCase())
  );

  /* ═══════════════════════════════════════════
   *  Confidence colour helper
   * ═══════════════════════════════════════════ */
  const confColor = (conf: number) => {
    if (conf >= 80) return 'text-green-500';
    if (conf >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  const confBadgeBg = (conf: number) => {
    if (conf >= 80) return 'bg-green-500/10 border-green-500/30 text-green-600';
    if (conf >= 60) return 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600';
    return 'bg-red-500/10 border-red-500/30 text-red-600';
  };

  /* ═══════════════════════════════════════════
   *  Word Stats
   * ═══════════════════════════════════════════ */
  const wordCount = currentText.split(/\s+/).filter(Boolean).length;
  const charCount = currentText.length;
  const lineCount = currentText.split('\n').length;

  const activeResult = pageResults[activeResultPage] || null;

  /* ═══════════════════════════════════════════
   *  Render
   * ═══════════════════════════════════════════ */
  return (
    <div className="h-full flex flex-col animate-fade-in bg-bg-base overflow-hidden">
      {/* ─── Header ─── */}
      <div className="border-b border-border bg-bg-surface flex-shrink-0">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const hasDocs = useAppStore.getState().documents.length > 0;
                setView(hasDocs ? AppView.DOCUMENT_LIST : AppView.HOME);
              }}
            >
              <ArrowLeft size={16} /> Back
            </Button>
            <div>
              <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
                <FileText size={20} className="text-accent" />
                Offline OCR Text Extractor
              </h1>
              <p className="text-[11px] text-text-secondary mt-0.5">
                Extract searchable text from images & scanned PDFs — runs 100% offline via Tesseract OCR
              </p>
            </div>
          </div>

          {/* Quick action buttons in header */}
          <div className="flex items-center gap-2">
            {pageResults.length > 0 && (
              <>
                <button
                  onClick={handleCopy}
                  className="p-2 rounded-lg border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary hover:text-accent transition-colors"
                  title="Copy all text"
                >
                  <Copy size={15} />
                </button>
                <button
                  onClick={handleDownloadTxt}
                  disabled={exporting}
                  className="p-2 rounded-lg border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary hover:text-accent transition-colors disabled:opacity-40"
                  title="Download as TXT"
                >
                  <Download size={15} />
                </button>
              </>
            )}

            {/* Layout Resizing Controls */}
            <div className="flex items-center gap-1.5 border-l border-border pl-2">
              <button
                onClick={() => setIsLeftCollapsed(!isLeftCollapsed)}
                className={`p-1.5 rounded-lg border transition-colors ${
                  isLeftCollapsed
                    ? 'border-accent bg-accent/10 text-accent font-semibold'
                    : 'border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary'
                }`}
                title={isLeftCollapsed ? 'Expand Document Source panel' : 'Collapse Document Source panel'}
              >
                <PanelLeft size={14} />
              </button>
              <button
                onClick={() => setIsRightCollapsed(!isRightCollapsed)}
                className={`p-1.5 rounded-lg border transition-colors ${
                  isRightCollapsed
                    ? 'border-accent bg-accent/10 text-accent font-semibold'
                    : 'border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary'
                }`}
                title={isRightCollapsed ? 'Expand Extracted Text panel' : 'Collapse Extracted Text panel'}
              >
                <PanelRight size={14} />
              </button>
              <button
                onClick={handleResetLayout}
                className="px-2.5 py-1.5 rounded-lg border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary hover:text-text-primary text-xs font-medium transition-colors flex items-center gap-1.5"
                title="Reset panels to default sizes (Source: 320px, Text: 400px)"
              >
                <Columns size={13} />
                <span className="hidden sm:inline">Reset Layout</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Document Switcher Bar ── */}
      <DocumentSelectorBar
        activeDocumentId={selectedDocId || undefined}
        onSelectDocument={(doc) => {
          setSelectedDocId(doc.id);
          setSelectedDocument(doc.id);
          setSelectedPage(1);
          setSourceMode('library');
        }}
        title="Offline OCR"
      />

      {/* ─── Main Layout ─── */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative select-none">
        {/* ═══ Left Panel: Configuration ═══ */}
        {!isLeftCollapsed && (
          <div
            style={{ width: `${leftWidth}px` }}
            className="border-r border-border bg-bg-surface flex flex-col flex-shrink-0 min-h-0 relative"
          >
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 scrollbar-thin">
            {/* Source Mode Tabs */}
            <div>
              <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">
                Document Source
              </label>
              <div className="grid grid-cols-2 gap-1.5 bg-bg-sunken rounded-lg p-1">
                <button
                  onClick={() => setSourceMode('upload')}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                    sourceMode === 'upload'
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Upload size={13} className="inline mr-1.5 -mt-0.5" />
                  Upload Image / PDF
                </button>
                <button
                  onClick={() => setSourceMode('library')}
                  className={`py-2 text-xs font-semibold rounded-md transition-colors ${
                    sourceMode === 'library'
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <Layers size={13} className="inline mr-1.5 -mt-0.5" />
                  From Library
                </button>
              </div>
            </div>

            {/* Upload Mode */}
            {sourceMode === 'upload' && (
              <div>
                {uploadedImages.length === 0 ? (
                  <div
                    className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-all group"
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload
                      size={28}
                      className="mx-auto mb-2 text-text-muted group-hover:text-accent transition-colors"
                    />
                    <p className="text-xs font-semibold text-text-secondary group-hover:text-text-primary">
                      Drop images or PDFs here or click to browse
                    </p>
                    <p className="text-[10px] text-text-muted mt-1">
                      PDF, JPG, PNG, WebP, BMP, TIFF supported
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,application/pdf"
                      multiple
                      className="hidden"
                      onChange={handleFileInput}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                        Uploaded ({uploadedImages.length})
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={handleBrowse}
                          className="p-1 rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary text-[10px]"
                          title="Add more"
                        >
                          <FolderOpen size={11} />
                        </button>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="p-1 rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary text-[10px]"
                          title="Upload more"
                        >
                          <Upload size={11} />
                        </button>
                      </div>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,application/pdf"
                      multiple
                      className="hidden"
                      onChange={handleFileInput}
                    />

                    <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-bg-base/50 divide-y divide-border/50 scrollbar-thin">
                      {uploadedImages.map((img, idx) => (
                        <div
                          key={idx}
                          onClick={() => setActiveUploadIdx(idx)}
                          className={`flex items-center gap-2 px-2.5 py-2 cursor-pointer transition-colors text-xs ${
                            activeUploadIdx === idx
                              ? 'bg-accent/8 text-accent font-semibold'
                              : 'text-text-secondary hover:bg-bg-sunken'
                          }`}
                        >
                          {img.name.toLowerCase().includes('.pdf') ? (
                            <FileText size={12} className="shrink-0 text-red-500" />
                          ) : (
                            <ImageIcon size={12} className="shrink-0 text-accent" />
                          )}
                          <span className="flex-1 truncate text-[11px]">{img.name}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeUploadedImage(idx);
                            }}
                            className="p-0.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Library Mode */}
            {sourceMode === 'library' && (
              <>
                <div>
                  <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Select Document
                  </label>
                  {documents.length > 0 ? (
                    <select
                      value={selectedDocId}
                      onChange={(e) => {
                        setSelectedDocId(e.target.value);
                        setSelectedDocument(e.target.value);
                        setSelectedPage(1);
                      }}
                      className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {documents.map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.filename} ({doc.type})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="p-3 bg-bg-sunken rounded-lg border border-border text-center text-[11px] text-text-muted">
                      No documents in library. Upload files from Home first or use "Upload Image" mode.
                    </div>
                  )}
                </div>

                {activeDoc?.type === DocumentType.PDF && (
                  <div>
                    <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                      Page ({selectedPage} / {activeDoc.pageCount})
                    </label>
                    <div className="flex gap-2 items-center">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={selectedPage <= 1 || isProcessing}
                        onClick={() => setSelectedPage((p) => p - 1)}
                        className="flex-1 justify-center text-xs"
                      >
                        <ChevronLeft size={14} /> Prev
                      </Button>
                      <span className="text-xs font-mono font-bold text-text-primary px-2">
                        {selectedPage}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={selectedPage >= (activeDoc.pageCount || 1) || isProcessing}
                        onClick={() => setSelectedPage((p) => p + 1)}
                        className="flex-1 justify-center text-xs"
                      >
                        Next <ChevronRight size={14} />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ─── Divider ─── */}
            <div className="border-t border-border/60" />

            {/* Language Selection */}
            <div>
              <label className="block text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                Recognition Languages
              </label>
              <div className="relative">
                <button
                  onClick={() => setShowLangPicker(!showLangPicker)}
                  className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent flex items-center justify-between"
                >
                  <span className="truncate">
                    {languages
                      .map((c) => LANGUAGES.find((l) => l.code === c)?.label?.split(' ')[0] || c)
                      .join(', ')}
                  </span>
                  <ChevronsUpDown size={13} className="text-text-muted shrink-0 ml-2" />
                </button>

                {showLangPicker && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-bg-surface border border-border rounded-lg shadow-lg z-50 max-h-52 flex flex-col overflow-hidden">
                    <div className="p-2 border-b border-border/50">
                      <input
                        type="text"
                        value={langSearch}
                        onChange={(e) => setLangSearch(e.target.value)}
                        placeholder="Search languages..."
                        className="w-full px-2.5 py-1.5 text-xs bg-bg-base border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent text-text-primary"
                        autoFocus
                      />
                    </div>
                    <div className="overflow-y-auto max-h-40 scrollbar-thin">
                      {filteredLanguages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => toggleLanguage(lang.code)}
                          className={`w-full px-3 py-1.5 text-left text-[11px] flex items-center gap-2 transition-colors ${
                            languages.includes(lang.code)
                              ? 'bg-accent/8 text-accent font-semibold'
                              : 'text-text-secondary hover:bg-bg-sunken'
                          }`}
                        >
                          <span className="text-sm">{lang.flag}</span>
                          <span className="flex-1">{lang.label}</span>
                          {languages.includes(lang.code) && (
                            <CheckCircle2 size={12} className="text-accent shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-border/50 p-1.5">
                      <button
                        onClick={() => setShowLangPicker(false)}
                        className="w-full py-1 text-[10px] font-semibold text-accent hover:bg-accent/8 rounded"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-relaxed">
                Select multiple languages for mixed-language documents.
              </p>
              {languages.length > 1 && (
                <div className="mt-1.5 p-2 bg-amber-500/10 border border-amber-500/25 rounded-lg flex items-center justify-between gap-1 text-[10px] text-amber-700 dark:text-amber-300">
                  <span>Tip: If scanning English-only images, select English only for highest accuracy.</span>
                  <button
                    onClick={() => setLanguages(['eng'])}
                    className="font-bold underline hover:text-accent shrink-0 ml-1.5"
                  >
                    English only
                  </button>
                </div>
              )}
            </div>

            {/* ─── Divider ─── */}
            <div className="border-t border-border/60" />

            {/* Layout / Page Segmentation Mode (PSM) */}
            <div className="bg-bg-sunken rounded-xl p-3 border border-border/80 flex flex-col gap-2">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center justify-between">
                <span>Layout & Text Mode</span>
                <span className="text-[9px] text-accent font-mono font-semibold">PSM</span>
              </label>
              <select
                value={psmMode}
                onChange={(e) => setPsmMode(e.target.value as any)}
                className="w-full text-xs bg-bg-surface border border-border rounded-lg px-2.5 py-1.5 text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="auto">Auto Detect (Recommended)</option>
                <option value="11">Banner / Poster / Sparse Text (PSM 11)</option>
                <option value="3">Full Page / Multi-column (PSM 3)</option>
                <option value="6">Single Text Block / Card (PSM 6)</option>
              </select>
              <p className="text-[10px] text-text-muted">
                {psmMode === '11'
                  ? 'Optimized for posters, social graphics, logos, and scattered headings.'
                  : psmMode === '3'
                  ? 'Optimized for standard document pages, books, and articles.'
                  : psmMode === '6'
                  ? 'Optimized for receipts, ID cards, and single text blocks.'
                  : 'Automatically selects the best recognition strategy based on image layout.'}
              </p>
            </div>

            {/* ─── Divider ─── */}
            <div className="border-t border-border/60" />

            {/* Preprocessing Options */}
            <div>
              <button
                onClick={() => {
                  const el = document.getElementById('preprocess-panel');
                  el?.classList.toggle('hidden');
                }}
                className="flex items-center justify-between w-full text-left"
              >
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5 cursor-pointer">
                  <Settings2 size={12} /> Image Preprocessing
                </label>
                <ChevronsUpDown size={12} className="text-text-muted" />
              </button>

              <div id="preprocess-panel" className="mt-2.5 flex flex-col gap-3">
                {/* Auto-Enhance Dark Background Preset */}
                <button
                  onClick={() => {
                    setPreprocessMode('invert');
                    setBrightness(105);
                    setContrast(130);
                    setPsmMode('11');
                    toast.success('Applied Dark-Mode Invert & Banner/Poster Mode');
                  }}
                  className="w-full py-1.5 px-2 bg-accent/10 border border-accent/30 text-accent rounded-md text-[11px] font-semibold hover:bg-accent/20 transition-colors flex items-center justify-center gap-1.5"
                  title="Inverts dark backgrounds and sets poster/banner mode for graphic images"
                >
                  <Sparkles size={12} /> Auto-Enhance Dark Graphic
                </button>

                {/* Mode */}
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { mode: 'none' as PreprocessMode, label: 'Original' },
                      { mode: 'grayscale' as PreprocessMode, label: 'Grayscale' },
                      { mode: 'threshold' as PreprocessMode, label: 'B&W Threshold' },
                      { mode: 'highContrast' as PreprocessMode, label: 'High Contrast' },
                      { mode: 'invert' as PreprocessMode, label: 'Invert (Dark Mode)' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.mode}
                      onClick={() => setPreprocessMode(opt.mode)}
                      className={`py-1.5 text-[11px] font-semibold rounded-md border transition-colors ${
                        preprocessMode === opt.mode
                          ? 'border-accent bg-accent/8 text-accent'
                          : 'border-border bg-bg-surface text-text-secondary hover:text-text-primary'
                      } ${opt.mode === 'invert' ? 'col-span-2' : ''}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {preprocessMode === 'threshold' && (
                  <div>
                    <div className="flex justify-between text-[10px] text-text-secondary mb-0.5">
                      <span>Threshold Level</span>
                      <span className="font-mono">{thresholdVal}</span>
                    </div>
                    <input
                      type="range"
                      min="30"
                      max="230"
                      value={thresholdVal}
                      onChange={(e) => setThresholdVal(parseInt(e.target.value))}
                      className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                    />
                  </div>
                )}

                {/* Brightness */}
                <div>
                  <div className="flex justify-between text-[10px] text-text-secondary mb-0.5">
                    <span className="flex items-center gap-1">
                      <SunMedium size={10} /> Brightness
                    </span>
                    <span className="font-mono">{brightness}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="200"
                    value={brightness}
                    onChange={(e) => setBrightness(parseInt(e.target.value))}
                    className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                </div>

                {/* Contrast */}
                <div>
                  <div className="flex justify-between text-[10px] text-text-secondary mb-0.5">
                    <span className="flex items-center gap-1">
                      <Contrast size={10} /> Contrast
                    </span>
                    <span className="font-mono">{contrast}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="300"
                    value={contrast}
                    onChange={(e) => setContrast(parseInt(e.target.value))}
                    className="w-full h-1 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                </div>

                {/* Rotation */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-secondary flex-1">Rotation</span>
                  <button
                    onClick={() => setRotation((r) => (r + 270) % 360)}
                    className="p-1.5 rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary transition-colors"
                    title="Rotate Left 90°"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <span className="text-[10px] font-mono text-text-primary w-8 text-center">{rotation}°</span>
                  <button
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    className="p-1.5 rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary transition-colors"
                    title="Rotate Right 90°"
                  >
                    <RotateCw size={12} />
                  </button>
                  <button
                    onClick={() => {
                      setPreprocessMode('none');
                      setBrightness(100);
                      setContrast(100);
                      setRotation(0);
                      setThresholdVal(128);
                    }}
                    className="px-2 py-1 text-[10px] rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary transition-colors"
                    title="Reset All"
                  >
                    <RefreshCw size={10} className="inline mr-0.5" /> Reset
                  </button>
                </div>

                {/* Region Crop Toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-text-secondary hover:text-text-primary pt-1 border-t border-border/50">
                  <input
                    type="checkbox"
                    checked={regionMode}
                    onChange={(e) => {
                      setRegionMode(e.target.checked);
                      if (!e.target.checked) setRegionRect(null);
                    }}
                    className="accent-accent rounded w-3.5 h-3.5 cursor-pointer"
                  />
                  <MousePointerSquare size={12} />
                  <span>OCR Selected Region Only</span>
                </label>
                {regionMode && (
                  <p className="text-[10px] text-text-muted leading-relaxed -mt-1">
                    {regionRect
                      ? 'Region selected. Only this area will be OCR\'d.'
                      : 'Draw a rectangle on the preview image to select a region.'}
                    {regionRect && (
                      <button
                        onClick={() => setRegionRect(null)}
                        className="ml-1.5 text-accent hover:underline font-semibold"
                      >
                        Clear
                      </button>
                    )}
                  </p>
                )}
              </div>
            </div>

            {/* ─── Divider ─── */}
            <div className="border-t border-border/60" />

            {/* Results Summary */}
            {pageResults.length > 0 && !isProcessing && (
              <div className="bg-bg-base/60 border border-border rounded-xl p-3 flex flex-col gap-2 animate-fade-in">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  Results Summary
                </span>
                {pageResults.map((r, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveResultPage(idx)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11px] transition-colors ${
                      activeResultPage === idx
                        ? 'bg-accent/8 text-accent font-semibold border border-accent/30'
                        : 'text-text-secondary hover:bg-bg-sunken border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <FileText size={11} />
                      Page {idx + 1}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${confBadgeBg(r.confidence)}`}
                    >
                      {r.confidence.toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Offline Security Notice */}
            <div className="p-3 bg-bg-sunken border border-border rounded-xl text-[11px] text-text-secondary space-y-1.5">
              <p className="font-semibold text-accent flex items-center gap-1.5">
                <AlertCircle size={13} /> 100% Offline & Private
              </p>
              <p className="leading-relaxed text-[10px]">
                All OCR processing runs entirely on your machine. No data is ever transmitted to any server.
                Language models are downloaded once and cached locally.
              </p>
            </div>
          </div>

          {/* Sticky Bottom Action Bar */}
          <div className="p-3.5 border-t border-border bg-bg-surface flex flex-col gap-2.5 flex-shrink-0 shadow-sm">
            <Button
              variant="primary"
              className="w-full justify-center py-2.5 font-bold text-sm shadow-md"
              onClick={handleRunOcr}
              disabled={
                isProcessing ||
                (sourceMode === 'upload' && uploadedImages.length === 0) ||
                (sourceMode === 'library' && !previewPath)
              }
            >
              {isProcessing ? (
                <>
                  <Loader2 size={16} className="animate-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Sparkles size={16} className="mr-2" />
                  Run OCR
                  {sourceMode === 'upload' && uploadedImages.length > 1
                    ? ` (${uploadedImages.length} pages)`
                    : ''}
                </>
              )}
            </Button>

            {/* Progress Bar in sticky bottom */}
            {isProcessing && (
              <div className="space-y-1.5 animate-fade-in">
                <span className="text-[11px] font-medium text-text-secondary block truncate">{ocrStatus}</span>
                <div className="w-full h-2 bg-bg-sunken rounded-full overflow-hidden border border-border">
                  <div
                    className="h-full bg-gradient-to-r from-accent to-purple-500 transition-all duration-300 rounded-full"
                    style={{ width: `${ocrProgress}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[10px] text-text-muted font-mono">
                  <span>Recognition in progress</span>
                  <span>{ocrProgress}%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

        {/* Left Resizer Splitter */}
        {!isLeftCollapsed && (
          <div
            onMouseDown={handleStartDragLeft}
            className={`w-2 -ml-1 -mr-1 z-30 flex items-center justify-center cursor-col-resize select-none group transition-colors flex-shrink-0 ${
              isDraggingLeft ? 'bg-accent/40' : 'hover:bg-accent/25'
            }`}
            title="Drag to resize Document Source panel"
          >
            <div
              className={`w-1 h-8 rounded-full transition-colors flex items-center justify-center ${
                isDraggingLeft ? 'bg-accent' : 'bg-border/80 group-hover:bg-accent'
              }`}
            />
          </div>
        )}

        {isLeftCollapsed && (
          <div className="w-8 border-r border-border bg-bg-surface flex flex-col items-center py-3 gap-3 flex-shrink-0">
            <button
              onClick={() => setIsLeftCollapsed(false)}
              className="p-1.5 rounded-lg border border-border bg-bg-base hover:bg-bg-sunken text-text-secondary hover:text-accent transition-colors"
              title="Expand Document Source panel"
            >
              <PanelLeft size={14} />
            </button>
            <span className="text-[10px] text-text-muted font-bold tracking-widest uppercase [writing-mode:vertical-rl] rotate-180 select-none">
              Source
            </span>
          </div>
        )}

        {/* ═══ Center: Preview ═══ */}
        <div className="flex-1 min-w-[320px] flex flex-col border-r border-border overflow-hidden min-h-0">
          {/* Preview Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-surface flex-shrink-0">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
              <ImageIcon size={12} /> Image Preview
              {regionMode && <span className="text-accent">(Region Select Mode)</span>}
            </span>
            <div className="flex items-center gap-1.5">
              {activeResult && (
                <button
                  onClick={() => setShowWordOverlay(!showWordOverlay)}
                  className={`p-1.5 rounded border transition-colors text-[10px] flex items-center gap-1 ${
                    showWordOverlay
                      ? 'border-accent bg-accent/8 text-accent'
                      : 'border-border bg-bg-surface text-text-secondary hover:text-text-primary'
                  }`}
                  title="Toggle word bounding boxes"
                >
                  {showWordOverlay ? <EyeOff size={12} /> : <Eye size={12} />}
                  <span className="hidden md:inline">Words</span>
                </button>
              )}
              <button
                onClick={() => setPreviewZoom((z) => Math.max(0.25, z - 0.25))}
                className="p-1.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-text-primary transition-colors"
                title="Zoom Out"
              >
                <ZoomOut size={12} />
              </button>
              <span className="text-[10px] font-mono text-text-secondary w-10 text-center">
                {Math.round(previewZoom * 100)}%
              </span>
              <button
                onClick={() => setPreviewZoom((z) => Math.min(4, z + 0.25))}
                className="p-1.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-text-primary transition-colors"
                title="Zoom In"
              >
                <ZoomIn size={12} />
              </button>
              <button
                onClick={() => setPreviewZoom(1)}
                className="px-2 py-1 text-[10px] rounded border border-border bg-bg-surface text-text-secondary hover:text-text-primary transition-colors"
                title="Fit"
              >
                Fit
              </button>
            </div>
          </div>

          {/* Preview Content */}
          <div
            ref={previewContainerRef}
            className="flex-1 bg-bg-sunken flex items-center justify-center p-4 overflow-auto relative"
            style={{ cursor: regionMode ? 'crosshair' : 'default' }}
          >
            {preprocessedUrl ? (
              <div
                className="relative inline-block shadow-md rounded bg-white"
                style={{ transform: `scale(${previewZoom})`, transformOrigin: 'center center' }}
                onMouseDown={handleRegionMouseDown}
                onMouseMove={handleRegionMouseMove}
                onMouseUp={handleRegionMouseUp}
                onMouseLeave={handleRegionMouseUp}
              >
                <img
                  ref={previewImgRef}
                  src={preprocessedUrl}
                  alt="Preview"
                  className="max-w-full select-none"
                  draggable={false}
                  style={{ display: 'block' }}
                />

                {/* Region selection rectangle */}
                {regionRect && (
                  <div
                    className="absolute border-2 border-accent bg-accent/10 pointer-events-none"
                    style={{
                      left: `${regionRect.x}%`,
                      top: `${regionRect.y}%`,
                      width: `${regionRect.w}%`,
                      height: `${regionRect.h}%`,
                    }}
                  >
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 bg-accent text-white text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap font-mono">
                      <Crop size={8} className="inline mr-0.5" /> Region Selected
                    </div>
                  </div>
                )}

                {/* Word overlay boxes */}
                {showWordOverlay && activeResult && previewImgRef.current && (
                  <div className="absolute inset-0 pointer-events-none">
                    {activeResult.words.map((word, i) => {
                      if (!word.bbox || !previewImgRef.current) return null;
                      const imgW = previewImgRef.current.naturalWidth;
                      const imgH = previewImgRef.current.naturalHeight;
                      if (!imgW || !imgH) return null;

                      const left = (word.bbox.x0 / imgW) * 100;
                      const top = (word.bbox.y0 / imgH) * 100;
                      const width = ((word.bbox.x1 - word.bbox.x0) / imgW) * 100;
                      const height = ((word.bbox.y1 - word.bbox.y0) / imgH) * 100;
                      const conf = word.confidence ?? 0;

                      let borderColor = 'border-green-400/60';
                      let bgColor = 'bg-green-400/8';
                      if (conf < 60) {
                        borderColor = 'border-red-400/60';
                        bgColor = 'bg-red-400/10';
                      } else if (conf < 80) {
                        borderColor = 'border-yellow-400/60';
                        bgColor = 'bg-yellow-400/8';
                      }

                      return (
                        <div
                          key={i}
                          className={`absolute border ${borderColor} ${bgColor}`}
                          style={{
                            left: `${left}%`,
                            top: `${top}%`,
                            width: `${width}%`,
                            height: `${height}%`,
                          }}
                          title={`"${word.text}" (${conf.toFixed(0)}% confidence)`}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center p-8">
                <ImageIcon size={40} className="mx-auto mb-3 text-text-muted/40" />
                <p className="text-xs text-text-muted font-medium">
                  {sourceMode === 'upload'
                    ? 'Upload an image to preview it here'
                    : 'Select a document from the library'}
                </p>
              </div>
            )}
          </div>

          {/* Multi-page nav for uploaded images */}
          {sourceMode === 'upload' && uploadedImages.length > 1 && (
            <div className="flex items-center justify-center gap-3 px-4 py-2 border-t border-border bg-bg-surface flex-shrink-0">
              <button
                onClick={() => setActiveUploadIdx((i) => Math.max(0, i - 1))}
                disabled={activeUploadIdx <= 0}
                className="p-1 rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary disabled:opacity-30"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-[11px] font-mono text-text-primary">
                {activeUploadIdx + 1} / {uploadedImages.length}
              </span>
              <button
                onClick={() => setActiveUploadIdx((i) => Math.min(uploadedImages.length - 1, i + 1))}
                disabled={activeUploadIdx >= uploadedImages.length - 1}
                className="p-1 rounded border border-border bg-bg-surface hover:bg-bg-sunken text-text-secondary disabled:opacity-30"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Right Resizer Splitter */}
        {!isRightCollapsed && (
          <div
            onMouseDown={handleStartDragRight}
            className={`w-2 -ml-1 -mr-1 z-30 flex items-center justify-center cursor-col-resize select-none group transition-colors flex-shrink-0 ${
              isDraggingRight ? 'bg-accent/40' : 'hover:bg-accent/25'
            }`}
            title="Drag to resize Extracted Text panel"
          >
            <div
              className={`w-1 h-8 rounded-full transition-colors flex items-center justify-center ${
                isDraggingRight ? 'bg-accent' : 'bg-border/80 group-hover:bg-accent'
              }`}
            />
          </div>
        )}

        {isRightCollapsed && (
          <div className="w-8 border-l border-border bg-bg-surface flex flex-col items-center py-3 gap-3 flex-shrink-0">
            <button
              onClick={() => setIsRightCollapsed(false)}
              className="p-1.5 rounded-lg border border-border bg-bg-base hover:bg-bg-sunken text-text-secondary hover:text-accent transition-colors"
              title="Expand Extracted Text panel"
            >
              <PanelRight size={14} />
            </button>
            <span className="text-[10px] text-text-muted font-bold tracking-widest uppercase [writing-mode:vertical-rl] rotate-180 select-none">
              Text
            </span>
          </div>
        )}

        {/* ═══ Right Panel: Text Output ═══ */}
        {!isRightCollapsed && (
          <div
            style={{ width: `${rightWidth}px` }}
            className="flex flex-col border-l border-border overflow-hidden min-h-0 bg-bg-base flex-shrink-0 relative"
          >
            {/* Extracted text toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-surface flex-shrink-0">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
              <Type size={12} /> Extracted Text
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={!currentText}
                onClick={handleFixOcrFormatting}
                className="p-1.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-accent transition-colors disabled:opacity-30 text-[10px] flex items-center gap-1"
                title="Clean OCR: Fix line hyphenation and multi-spaces"
              >
                <Wand2 size={12} />
                <span className="hidden sm:inline">Clean</span>
              </button>
              <button
                disabled={!currentText}
                onClick={handleRemoveLineBreaks}
                className="p-1.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-accent transition-colors disabled:opacity-30 text-[10px] flex items-center gap-1"
                title="Join single line breaks into flowing paragraphs"
              >
                <AlignLeft size={12} />
                <span className="hidden sm:inline">Join</span>
              </button>
              <div className="h-4 w-px bg-border mx-0.5" />
              <button
                disabled={!currentText}
                onClick={() => handleTransformCase('upper')}
                className="px-1.5 py-0.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-text-primary text-[10px] font-mono disabled:opacity-30"
                title="Uppercase"
              >
                AA
              </button>
              <button
                disabled={!currentText}
                onClick={() => handleTransformCase('lower')}
                className="px-1.5 py-0.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-text-primary text-[10px] font-mono disabled:opacity-30"
                title="Lowercase"
              >
                aa
              </button>
              <button
                disabled={!currentText}
                onClick={() => handleTransformCase('title')}
                className="px-1.5 py-0.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-text-primary text-[10px] font-mono disabled:opacity-30"
                title="Title Case"
              >
                Aa
              </button>
              <div className="h-4 w-px bg-border mx-0.5" />
              <button
                onClick={() => setShowFindReplace(!showFindReplace)}
                className={`p-1.5 rounded border transition-colors ${
                  showFindReplace
                    ? 'border-accent bg-accent/8 text-accent'
                    : 'border-border bg-bg-surface text-text-secondary hover:text-text-primary'
                }`}
                title="Find & Replace"
              >
                <Search size={12} />
              </button>
              <button
                disabled={!currentText}
                onClick={handleCopy}
                className="p-1.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-accent transition-colors disabled:opacity-30"
                title="Copy all text"
              >
                <Copy size={12} />
              </button>
              <button
                disabled={!currentText}
                onClick={handleClearText}
                className="p-1.5 rounded border border-border bg-bg-surface text-text-secondary hover:text-red-500 transition-colors disabled:opacity-30"
                title="Clear text"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* Find & Replace bar */}
          {showFindReplace && (
            <div className="px-3 py-2 bg-bg-surface border-b border-border flex flex-col gap-1.5 animate-fade-in flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <Search size={12} className="text-text-muted shrink-0" />
                <input
                  type="text"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder="Find text..."
                  className="flex-1 px-2 py-1 text-xs bg-bg-base border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent text-text-primary"
                />
                <span className="text-[10px] font-mono text-text-muted shrink-0 w-10 text-right">
                  {matchCount > 0 ? `${matchCount}` : '0'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Replace size={12} className="text-text-muted shrink-0" />
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Replace with..."
                  className="flex-1 px-2 py-1 text-xs bg-bg-base border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent text-text-primary"
                />
                <button
                  onClick={handleReplaceAll}
                  disabled={!findText || matchCount === 0}
                  className="px-2 py-1 text-[10px] font-semibold bg-accent text-white rounded hover:bg-accent-hover transition-colors disabled:opacity-30"
                >
                  Replace All
                </button>
              </div>
            </div>
          )}

          {/* Page tabs if multi-page */}
          {pageResults.length > 1 && (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-bg-surface overflow-x-auto flex-shrink-0 scrollbar-thin">
              {pageResults.map((r, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveResultPage(idx)}
                  className={`px-2.5 py-1 text-[10px] font-semibold rounded-md border transition-colors whitespace-nowrap flex items-center gap-1 ${
                    activeResultPage === idx
                      ? 'border-accent bg-accent/8 text-accent'
                      : 'border-border bg-bg-surface text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Page {idx + 1}
                  <span className={`font-mono ${confColor(r.confidence)}`}>
                    {r.confidence.toFixed(0)}%
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Text editor */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <textarea
              value={currentText}
              onChange={(e) => updateCurrentText(e.target.value)}
              className="flex-1 w-full p-4 font-mono text-sm leading-relaxed text-text-primary bg-bg-base outline-none border-none resize-none overflow-y-auto scrollbar-thin"
              placeholder={
                isProcessing
                  ? 'OCR is running, please wait...'
                  : "Click 'Run OCR' to extract text from the image. The recognized text will appear here for editing, copying, or exporting."
              }
              disabled={isProcessing}
              spellCheck={false}
            />
          </div>

          {/* Footer: Stats + Export */}
          <div className="border-t border-border bg-bg-surface flex-shrink-0">
            {/* Stats bar */}
            <div className="px-4 py-2 flex items-center justify-between border-b border-border/50">
              <div className="flex items-center gap-3 text-[10px] font-mono text-text-muted">
                <span>{charCount} chars</span>
                <span>{wordCount} words</span>
                <span>{lineCount} lines</span>
                {activeResult && (
                  <span className={`font-semibold ${confColor(activeResult.confidence)}`}>
                    {activeResult.confidence.toFixed(1)}% conf.
                  </span>
                )}
              </div>
            </div>

            {/* Export buttons */}
            <div className="p-3 flex flex-col gap-2">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                Export Options
              </label>

              {/* Filename */}
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="Filename"
                className="px-2.5 py-1.5 text-xs bg-bg-base border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-accent text-text-primary"
              />

              <div className="grid grid-cols-4 gap-1.5">
                <button
                  onClick={() => handleExport('txt')}
                  disabled={exporting || pageResults.length === 0}
                  className="py-2 text-[11px] font-semibold bg-bg-base border border-border rounded-md hover:bg-bg-sunken hover:border-accent text-text-secondary hover:text-accent transition-colors disabled:opacity-30 flex items-center justify-center gap-1"
                  title="Export plain text (.txt)"
                >
                  <FileText size={12} /> TXT
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  disabled={exporting || pageResults.length === 0}
                  className="py-2 text-[11px] font-semibold bg-bg-base border border-border rounded-md hover:bg-bg-sunken hover:border-accent text-text-secondary hover:text-accent transition-colors disabled:opacity-30 flex items-center justify-center gap-1"
                  title="Export tabular data (.csv)"
                >
                  <Table2 size={12} /> CSV
                </button>
                <button
                  onClick={() => handleExport('json')}
                  disabled={exporting || pageResults.length === 0}
                  className="py-2 text-[11px] font-semibold bg-bg-base border border-border rounded-md hover:bg-bg-sunken hover:border-accent text-text-secondary hover:text-accent transition-colors disabled:opacity-30 flex items-center justify-center gap-1"
                  title="Export structured JSON with word bounding boxes & confidences (.json)"
                >
                  <FileJson size={12} /> JSON
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  disabled={exporting || pageResults.length === 0}
                  className="py-2 text-[11px] font-semibold bg-bg-base border border-border rounded-md hover:bg-bg-sunken hover:border-accent text-text-secondary hover:text-accent transition-colors disabled:opacity-30 flex items-center justify-center gap-1"
                  title="Export searchable PDF with invisible text layer (.pdf)"
                >
                  <FileDown size={12} /> PDF
                </button>
              </div>

              {exporting && (
                <div className="flex items-center gap-2 text-[10px] text-accent animate-pulse">
                  <Loader2 size={12} className="animate-spin" />
                  <span>Exporting...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
