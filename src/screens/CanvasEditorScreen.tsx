import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Canvas as FabricCanvas,
  Rect,
  Circle,
  Line,
  Textbox,
  FabricImage,
  FabricObject,
  PencilBrush,
  Group,
  Polygon
} from 'fabric';
import {
  ArrowLeft,
  Download,
  Loader2,
  Type,
  Square,
  Circle as CircleIcon,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FolderOpen,
  Trash2,
  Copy,
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  RotateCcw,
  Pencil,
  Check,
  X,
  Sliders,
  Crop,
  Shield,
  Highlighter,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowRight,
  Layers
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import Button from '../components/ui/Button';
import DragDropZone from '../components/ui/DragDropZone';
import { PDFDocument } from 'pdf-lib';
import { DocumentItem, DocumentType } from '../types/Document.types';
import DocumentSelectorBar from '../components/document/DocumentSelectorBar';
import { registerUploadedFile } from '../utils/fileUploadHelper';

/* ═══════════════════════════════════════════════
 *  Editor Tabs & Types
 * ═══════════════════════════════════════════════ */
type EditorTab = 'crop' | 'adjust' | 'text' | 'shapes' | 'draw';

type FilterPreset = 'none' | 'enhance' | 'clean' | 'bw' | 'grayscale';

export interface CustomFabricObject extends FabricObject {
  customData?: {
    isArrow?: boolean;
    isRedact?: boolean;
  };
  isEditing?: boolean;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: string;
  underline?: boolean;
  textAlign?: string;
}

interface AspectRatioPreset {
  label: string;
  ratio: number | null; // width / height, null for freeform
  iconLabel: string;
}

const ASPECT_RATIOS: AspectRatioPreset[] = [
  { label: 'Freeform', ratio: null, iconLabel: 'Free' },
  { label: 'Square (1:1)', ratio: 1, iconLabel: '1:1' },
  { label: 'Standard (4:3)', ratio: 4 / 3, iconLabel: '4:3' },
  { label: 'Wide (16:9)', ratio: 16 / 9, iconLabel: '16:9' },
  { label: 'Photo (3:2)', ratio: 3 / 2, iconLabel: '3:2' },
  { label: 'Passport (3.5×4.5)', ratio: 35 / 45, iconLabel: 'ID' },
  { label: 'A4 Document', ratio: 210 / 297, iconLabel: 'A4' },
];

const PRESET_COLORS = [
  '#000000', '#FFFFFF', '#EF4444', '#F97316', '#F59E0B',
  '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#EC4899', '#64748B'
];

/* ═══════════════════════════════════════════════
 *  Helpers: Chunked Base64 (High Performance)
 * ═══════════════════════════════════════════════ */
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

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* ═══════════════════════════════════════════════
 *  Helper: Arrow Factory
 * ═══════════════════════════════════════════════ */
function createArrow(fromX: number, fromY: number, toX: number, toY: number, color = '#EF4444', width = 3): Group {
  const line = new Line([fromX, fromY, toX, toY], {
    stroke: color,
    strokeWidth: width,
    selectable: false,
    evented: false,
  });

  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLength = Math.max(14, width * 4);

  const p1 = { x: toX, y: toY };
  const p2 = {
    x: toX - headLength * Math.cos(angle - Math.PI / 6),
    y: toY - headLength * Math.sin(angle - Math.PI / 6),
  };
  const p3 = {
    x: toX - headLength * Math.cos(angle + Math.PI / 6),
    y: toY - headLength * Math.sin(angle + Math.PI / 6),
  };

  const head = new Polygon([p1, p2, p3], {
    fill: color,
    stroke: color,
    strokeWidth: 1,
    selectable: false,
    evented: false,
  });

  const group = new Group([line, head], {
    selectable: true,
    evented: true,
    hasControls: true,
  }) as CustomFabricObject;
  group.customData = { isArrow: true };
  return group as unknown as Group;
}

/* ═══════════════════════════════════════════════
 *  Helper: Native Hardware-Accelerated Filters
 * ═══════════════════════════════════════════════ */
function processImageFilters(
  source: HTMLImageElement | HTMLCanvasElement,
  brightness: number,
  contrast: number,
  saturation: number,
  preset: FilterPreset
): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = source.width;
  off.height = source.height;
  const ctx = off.getContext('2d');
  if (!ctx) return off;

  const b = 1 + brightness / 100;
  const c = 1 + contrast / 100;
  const s = 1 + saturation / 100;

  ctx.filter = `brightness(${b}) contrast(${c}) saturate(${s})`;
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';

  if (preset === 'none') {
    return off;
  }

  const imgData = ctx.getImageData(0, 0, off.width, off.height);
  const d = imgData.data;

  if (preset === 'grayscale') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = g;
      d[i + 1] = g;
      d[i + 2] = g;
    }
  } else if (preset === 'bw') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const val = g > 130 ? 255 : 0;
      d[i] = val;
      d[i + 1] = val;
      d[i + 2] = val;
    }
  } else if (preset === 'clean') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      let val = g;
      if (g > 160) {
        val = Math.min(255, g * 1.3);
      } else if (g < 90) {
        val = Math.max(0, g * 0.5);
      } else {
        val = (g - 90) * 1.4 + 45;
      }
      d[i] = val;
      d[i + 1] = val;
      d[i + 2] = val;
    }
  } else if (preset === 'enhance') {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.min(255, Math.max(0, ((d[i] - 128) * 1.25) + 128));
      d[i + 1] = Math.min(255, Math.max(0, ((d[i + 1] - 128) * 1.25) + 128));
      d[i + 2] = Math.min(255, Math.max(0, ((d[i + 2] - 128) * 1.25) + 128));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return off;
}

/* ═══════════════════════════════════════════════
 *  Helper: Rotate / Flip Canvas
 * ═══════════════════════════════════════════════ */
function rotateCanvas(source: HTMLCanvasElement | HTMLImageElement, clockwise: boolean): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = source.height;
  off.height = source.width;
  const ctx = off.getContext('2d');
  if (!ctx) return off;

  ctx.translate(off.width / 2, off.height / 2);
  ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return off;
}

function flipCanvas(source: HTMLCanvasElement | HTMLImageElement, horizontal: boolean): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = source.width;
  off.height = source.height;
  const ctx = off.getContext('2d');
  if (!ctx) return off;

  ctx.translate(horizontal ? off.width : 0, horizontal ? 0 : off.height);
  ctx.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
  ctx.drawImage(source, 0, 0);
  return off;
}

/* ═══════════════════════════════════════════════
 *  MAIN COMPONENT
 * ═══════════════════════════════════════════════ */
export default function CanvasEditorScreen() {
  const setView = useAppStore((s) => s.setView);
  const documents = useAppStore((s) => s.documents);
  const selectedDocumentId = useAppStore((s) => s.ui.selectedDocumentId);
  const setSelectedDocument = useAppStore((s) => s.setSelectedDocument);

  // References
  const fabricRef = useRef<FabricCanvas | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Images state
  const rawImageRef = useRef<HTMLImageElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [hasImage, setHasImage] = useState(false);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [imageName, setImageName] = useState('image');
  const [imgDimensions, setImgDimensions] = useState({ width: 0, height: 0 });

  // Navigation & Tool Tabs
  const [activeTab, setActiveTab] = useState<EditorTab>('crop');
  const [zoom, setZoom] = useState(1);

  // Selection
  const [selVer, setSelVer] = useState(0);
  const bump = useCallback(() => setSelVer((v) => v + 1), []);

  // History
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const isRestoringRef = useRef(false);

  // Color & Light Adjustments
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [activeFilter, setActiveFilter] = useState<FilterPreset>('none');

  // Crop State
  const [isCropping, setIsCropping] = useState(false);
  const [selectedRatio, setSelectedRatio] = useState<number | null>(null);
  const [cropBox, setCropBox] = useState({ x: 10, y: 10, w: 80, h: 80 }); // percentage
  const [dragCropHandle, setDragCropHandle] = useState<string | null>(null);
  const [cropDragStart, setCropDragStart] = useState<{ x: number; y: number } | null>(null);

  // Free Draw State
  const [drawMode, setDrawMode] = useState<'pen' | 'highlighter'>('pen');
  const [drawColor, setDrawColor] = useState('#EF4444');
  const [drawWidth, setDrawWidth] = useState(4);

  // Export State
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'PNG' | 'JPEG' | 'PDF'>('PNG');
  const [exportQuality, setExportQuality] = useState(90);
  const [isExporting, setIsExporting] = useState(false);

  /* ═══════════════════════════════════════════════
   *  History: Save, Undo, Redo
   * ═══════════════════════════════════════════════ */
  const saveHistory = useCallback(() => {
    const c = fabricRef.current;
    if (!c || isRestoringRef.current) return;
    const json = JSON.stringify(c.toJSON());
    const h = historyRef.current;
    const idx = historyIdxRef.current;
    historyRef.current = [...h.slice(0, idx + 1), json];
    if (historyRef.current.length > 40) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
    bump();
  }, [bump]);

  const handleUndo = useCallback(() => {
    const c = fabricRef.current;
    if (!c || historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const json = historyRef.current[historyIdxRef.current];
    if (!json) return;
    isRestoringRef.current = true;
    c.loadFromJSON(JSON.parse(json)).then(() => {
      c.renderAll();
      bump();
      isRestoringRef.current = false;
    });
  }, [bump]);

  const handleRedo = useCallback(() => {
    const c = fabricRef.current;
    if (!c || historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const json = historyRef.current[historyIdxRef.current];
    if (!json) return;
    isRestoringRef.current = true;
    c.loadFromJSON(JSON.parse(json)).then(() => {
      c.renderAll();
      bump();
      isRestoringRef.current = false;
    });
  }, [bump]);

  /* ═══════════════════════════════════════════════
   *  Refresh Background Image with Active Filters
   * ═══════════════════════════════════════════════ */
  const refreshFilteredBackground = useCallback(() => {
    const c = fabricRef.current;
    const baseCanvas = baseCanvasRef.current;
    if (!c || !baseCanvas) return;

    const filtered = processImageFilters(
      baseCanvas,
      brightness,
      contrast,
      saturation,
      activeFilter
    );

    const fImg = new FabricImage(filtered, {
      selectable: false,
      evented: false,
      hasControls: false,
    });

    c.backgroundImage = fImg;
    c.renderAll();
  }, [brightness, contrast, saturation, activeFilter]);

  useEffect(() => {
    refreshFilteredBackground();
  }, [refreshFilteredBackground]);

  /* ═══════════════════════════════════════════════
   *  Update Dimensions & Fit Zoom
   * ═══════════════════════════════════════════════ */
  const fitZoomToViewport = useCallback((w: number, h: number) => {
    const vp = viewportRef.current;
    if (!vp) return 1;
    const padW = vp.clientWidth - 60;
    const padH = vp.clientHeight - 60;
    if (padW <= 0 || padH <= 0 || w <= 0 || h <= 0) return 1;
    const calc = Math.min(padW / w, padH / h, 1);
    return Math.max(0.1, parseFloat(calc.toFixed(3)));
  }, []);

  const setCanvasImageAndDimensions = useCallback((canvasSource: HTMLCanvasElement, fit = true) => {
    baseCanvasRef.current = canvasSource;
    const w = canvasSource.width;
    const h = canvasSource.height;
    setImgDimensions({ width: w, height: h });

    const applyToFabric = (c: FabricCanvas) => {
      let newZoom = zoom;
      if (fit) {
        newZoom = fitZoomToViewport(w, h);
        setZoom(newZoom);
      }

      c.setDimensions({ width: w * newZoom, height: h * newZoom });
      c.setZoom(newZoom);
      refreshFilteredBackground();
    };

    const c = fabricRef.current;
    if (c) {
      applyToFabric(c);
    } else {
      requestAnimationFrame(() => {
        if (fabricRef.current) {
          applyToFabric(fabricRef.current);
        }
      });
    }
  }, [zoom, fitZoomToViewport, refreshFilteredBackground]);

  /* ═══════════════════════════════════════════════
   *  Load Image from File or URL
   * ═══════════════════════════════════════════════ */
  const loadImageElement = useCallback((img: HTMLImageElement, name = 'image') => {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) {
      toast.error('Could not determine image dimensions');
      return;
    }

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);

    rawImageRef.current = img;
    baseCanvasRef.current = off;
    setImageName(name.replace(/\.[^/.]+$/, ''));
    setImgDimensions({ width: w, height: h });
    setHasImage(true);

    // Reset adjustments
    setBrightness(0);
    setContrast(0);
    setSaturation(0);
    setActiveFilter('none');
    setIsCropping(false);

    // Apply to canvas
    setCanvasImageAndDimensions(off, true);
    setTimeout(() => {
      saveHistory();
    }, 50);
  }, [setCanvasImageAndDimensions, saveHistory]);

  const loadImageFromDataUrl = useCallback((dataUrl: string, name = 'image') => {
    const img = new Image();
    // Only set crossOrigin for remote http/https to prevent CORS block on data: or local URLs
    if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => loadImageElement(img, name);
    img.onerror = () => toast.error('Failed to load image');
    img.src = dataUrl;
  }, [loadImageElement]);

  const loadDocumentIntoCanvas = useCallback(async (doc: DocumentItem) => {
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
      loadImageFromDataUrl(dataUrl, doc.filename);
    } catch (err) {
      console.error('Failed to load document into canvas editor:', err);
      toast.error('Failed to load image');
    }
  }, [loadImageFromDataUrl, setSelectedDocument]);

  // Auto-load active image from shared session on mount or when selected document changes
  useEffect(() => {
    if (documents.length > 0) {
      const activeDoc = (selectedDocumentId && documents.find(d => d.id === selectedDocumentId && d.type === DocumentType.IMAGE))
        || (!hasImage ? documents.find(d => d.type === DocumentType.IMAGE) : null);

      if (activeDoc && activeDoc.id !== currentDocId) {
        loadDocumentIntoCanvas(activeDoc);
      }
    }
  }, [documents, selectedDocumentId, currentDocId, hasImage, loadDocumentIntoCanvas]);

  const handleLoadFromFile = useCallback(async (file: File) => {
    const registered = await registerUploadedFile(file);
    if (registered) {
      toast.success(`Image loaded: ${registered.filename}`);
      loadDocumentIntoCanvas(registered);
      return;
    }

    const filePath = (file as unknown as { path?: string }).path;
    const fileName = file.name || (filePath ? filePath.split(/[\\/]/).pop() : 'image') || 'image';

    if (filePath && window.electron?.readImageAsDataUrl) {
      try {
        const res = await window.electron.readImageAsDataUrl(filePath);
        if (res.success && res.data) {
          loadImageFromDataUrl(res.data, fileName);
          return;
        }
      } catch (err) {
        console.warn('Failed to read image via electron, falling back to FileReader', err);
      }
    }

    if (file.size > 0) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          loadImageFromDataUrl(e.target.result as string, fileName);
        }
      };
      reader.onerror = () => {
        toast.error('Failed to read image file');
      };
      reader.readAsDataURL(file);
    } else if (filePath) {
      // 0-byte dummy file from electron dialog with path
      loadImageFromDataUrl(`docuflow:///${filePath.replace(/\\/g, '/')}`, fileName);
    } else {
      toast.error('Failed to load image: file is empty');
    }
  }, [loadImageFromDataUrl, loadDocumentIntoCanvas]);

  const handleOpenLocalFile = async () => {
    try {
      const res = await window.electron.showOpenDialog({
        title: 'Open Image',
        filters: [{ name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'] }],
        properties: ['openFile']
      });
      if (res.success && res.data && res.data.length > 0) {
        const filePath = res.data[0];
        const registered = await registerUploadedFile(filePath);
        if (registered) {
          toast.success(`Image loaded: ${registered.filename}`);
          loadDocumentIntoCanvas(registered);
        } else {
          const fileName = filePath.split(/[\\/]/).pop() || 'image';
          const dataRes = await window.electron.readImageAsDataUrl(filePath);
          if (dataRes.success && dataRes.data) {
            loadImageFromDataUrl(dataRes.data, fileName);
          } else {
            loadImageFromDataUrl(`docuflow:///${filePath.replace(/\\/g, '/')}`, fileName);
          }
        }
      }
    } catch {
      fileInputRef.current?.click();
    }
  };


  /* ═══════════════════════════════════════════════
   *  Initialize Fabric Canvas (Mounted Once)
   * ═══════════════════════════════════════════════ */
  useEffect(() => {
    if (!canvasElRef.current || fabricRef.current) return;

    const c = new FabricCanvas(canvasElRef.current, {
      width: 800,
      height: 600,
      backgroundColor: '#FFFFFF',
      preserveObjectStacking: true,
      selection: true,
    });

    FabricObject.prototype.set({
      transparentCorners: false,
      cornerColor: '#3B82F6',
      cornerStrokeColor: '#1D4ED8',
      cornerStyle: 'circle',
      cornerSize: 10,
      borderColor: '#60A5FA',
      borderScaleFactor: 2,
      padding: 4,
    });

    c.on('selection:created', bump);
    c.on('selection:updated', bump);
    c.on('selection:cleared', bump);
    c.on('object:modified', () => { bump(); saveHistory(); });
    c.on('object:added', () => { if (!isRestoringRef.current) saveHistory(); });
    c.on('text:changed', bump);

    fabricRef.current = c;

    if (baseCanvasRef.current) {
      const bc = baseCanvasRef.current;
      const w = bc.width;
      const h = bc.height;
      const initialZoom = fitZoomToViewport(w, h);
      setZoom(initialZoom);
      c.setDimensions({ width: w * initialZoom, height: h * initialZoom });
      c.setZoom(initialZoom);
      const filtered = processImageFilters(bc, 0, 0, 0, 'none');
      const fImg = new FabricImage(filtered, {
        selectable: false,
        evented: false,
        hasControls: false,
      });
      c.backgroundImage = fImg;
      c.renderAll();
    }

    return () => {
      c.dispose();
      fabricRef.current = null;
    };
  }, [bump, saveHistory, fitZoomToViewport]);

  /* ═══════════════════════════════════════════════
   *  Draw Tool Mode Setup
   * ═══════════════════════════════════════════════ */
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;

    if (activeTab === 'draw') {
      c.isDrawingMode = true;
      if (!c.freeDrawingBrush || !(c.freeDrawingBrush instanceof PencilBrush)) {
        c.freeDrawingBrush = new PencilBrush(c);
      }
      if (drawMode === 'highlighter') {
        // Semi-transparent highlighter brush
        c.freeDrawingBrush.color = drawColor + '55'; // 33% alpha
        c.freeDrawingBrush.width = Math.max(16, drawWidth * 2.5);
      } else {
        c.freeDrawingBrush.color = drawColor;
        c.freeDrawingBrush.width = drawWidth;
      }
    } else {
      c.isDrawingMode = false;
    }
    c.renderAll();
  }, [activeTab, drawMode, drawColor, drawWidth]);

  /* ═══════════════════════════════════════════════
   *  Clipboard Paste & Keyboard Shortcuts
   * ═══════════════════════════════════════════════ */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA';

      // Delete active object
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
        const c = fabricRef.current;
        const activeObj = c?.getActiveObject() as CustomFabricObject | undefined;
        if (activeObj && !activeObj.isEditing) {
          e.preventDefault();
          c?.remove(activeObj);
          c?.discardActiveObject();
          c?.renderAll();
          bump();
          saveHistory();
        }
      }

      // Undo / Redo
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        } else if (e.key === 'y') {
          e.preventDefault();
          handleRedo();
        } else if (e.key === 'd') {
          e.preventDefault();
          handleDuplicate();
        }
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              if (ev.target?.result) {
                loadImageFromDataUrl(ev.target.result as string, 'Pasted_Image');
                toast.success('Loaded image from clipboard');
              }
            };
            reader.readAsDataURL(file);
            break;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  });

  /* ═══════════════════════════════════════════════
   *  Object Management: Duplicate, Delete, Layering
   * ═══════════════════════════════════════════════ */
  const fc = fabricRef.current;
  const sel = fc?.getActiveObject() as CustomFabricObject | undefined;
  void selVer;

  const handleDeleteSelected = () => {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    c.remove(obj);
    c.discardActiveObject();
    c.renderAll();
    bump();
    saveHistory();
    toast.success('Element removed');
  };

  const handleDuplicate = () => {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    obj.clone().then((cloned: FabricObject) => {
      cloned.set({
        left: (obj.left || 0) + 20,
        top: (obj.top || 0) + 20,
      });
      c.add(cloned);
      c.setActiveObject(cloned);
      c.renderAll();
      bump();
      saveHistory();
    });
  };

  const updateSelectedProp = (key: string, value: unknown) => {
    const c = fabricRef.current;
    const obj = c?.getActiveObject() as CustomFabricObject | undefined;
    if (!obj || !c) return;

    if (obj.customData?.isArrow && (key === 'stroke' || key === 'fill') && (obj as unknown as Group).getObjects) {
      (obj as unknown as Group).getObjects().forEach((child) => {
        if (child instanceof Line) child.set('stroke', value as string);
        if (child instanceof Polygon) {
          child.set('fill', value as string);
          child.set('stroke', value as string);
        }
      });
    } else {
      obj.set(key as keyof FabricObject, value);
    }

    obj.setCoords();
    c.renderAll();
    bump();
    saveHistory();
  };

  /* ═══════════════════════════════════════════════
   *  Rotate, Flip, and Crop Functions
   * ═══════════════════════════════════════════════ */
  const handleRotate = (clockwise: boolean) => {
    if (!baseCanvasRef.current) return;
    const rotated = rotateCanvas(baseCanvasRef.current, clockwise);
    setCanvasImageAndDimensions(rotated, true);
    saveHistory();
    toast.success(`Rotated 90° ${clockwise ? 'CW' : 'CCW'}`);
  };

  const handleFlip = (horizontal: boolean) => {
    if (!baseCanvasRef.current) return;
    const flipped = flipCanvas(baseCanvasRef.current, horizontal);
    setCanvasImageAndDimensions(flipped, false);
    saveHistory();
    toast.success(`Flipped ${horizontal ? 'horizontally' : 'vertically'}`);
  };

  const handleApplyCrop = () => {
    if (!baseCanvasRef.current) return;
    const base = baseCanvasRef.current;

    const sx = Math.max(0, Math.round((cropBox.x / 100) * base.width));
    const sy = Math.max(0, Math.round((cropBox.y / 100) * base.height));
    const sw = Math.min(base.width - sx, Math.round((cropBox.w / 100) * base.width));
    const sh = Math.min(base.height - sy, Math.round((cropBox.h / 100) * base.height));

    if (sw < 10 || sh < 10) {
      toast.error('Crop selection too small');
      return;
    }

    const cropped = document.createElement('canvas');
    cropped.width = sw;
    cropped.height = sh;
    const ctx = cropped.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh);

    // Shift existing annotations by crop offset
    const c = fabricRef.current;
    if (c) {
      c.getObjects().forEach((obj) => {
        obj.set({
          left: (obj.left || 0) - sx,
          top: (obj.top || 0) - sy,
        });
        obj.setCoords();
      });
    }

    setCanvasImageAndDimensions(cropped, true);
    setIsCropping(false);
    setCropBox({ x: 10, y: 10, w: 80, h: 80 });
    saveHistory();
    toast.success('Crop applied');
  };

  /* ═══════════════════════════════════════════════
   *  Add Text, Shapes, and Privacy Redaction
   * ═══════════════════════════════════════════════ */
  const handleAddText = () => {
    const c = fabricRef.current;
    if (!c) return;
    const w = imgDimensions.width || 800;
    const h = imgDimensions.height || 600;
    const minDim = Math.min(w, h);
    const fontSize = Math.max(16, Math.min(84, Math.round(minDim * 0.045)));

    const text = new Textbox('Type something...', {
      left: Math.round(w / 2 - Math.min(w * 0.25, 140)),
      top: Math.round(h / 2 - fontSize),
      width: Math.max(200, Math.round(w * 0.4)),
      fontSize,
      fontFamily: 'Inter, system-ui, sans-serif',
      fill: '#1E293B',
      textAlign: 'center',
      editable: true,
    });
    c.add(text);
    c.setActiveObject(text);
    c.renderAll();
    saveHistory();
    toast.success('Text added — double click to edit');
  };

  const handleAddRedaction = () => {
    const c = fabricRef.current;
    if (!c) return;
    const w = imgDimensions.width || 800;
    const h = imgDimensions.height || 600;
    const rw = Math.max(140, Math.round(w * 0.28));
    const rh = Math.max(32, Math.round(h * 0.065));

    const box = new Rect({
      left: Math.round((w - rw) / 2),
      top: Math.round((h - rh) / 2),
      width: rw,
      height: rh,
      fill: '#000000',
      stroke: '#000000',
      strokeWidth: 0,
      rx: 3,
      ry: 3,
    }) as CustomFabricObject;
    box.customData = { isRedact: true };
    c.add(box);
    c.setActiveObject(box);
    c.renderAll();
    saveHistory();
    toast.success('Privacy redaction box added — position over private text');
  };

  const handleAddHighlightBox = () => {
    const c = fabricRef.current;
    if (!c) return;
    const w = imgDimensions.width || 800;
    const h = imgDimensions.height || 600;
    const hw = Math.max(160, Math.round(w * 0.32));
    const hh = Math.max(36, Math.round(h * 0.075));

    const hl = new Rect({
      left: Math.round((w - hw) / 2),
      top: Math.round((h - hh) / 2),
      width: hw,
      height: hh,
      fill: 'rgba(250, 204, 21, 0.32)',
      stroke: '#EAB308',
      strokeWidth: 2,
      rx: 4,
      ry: 4,
    });
    c.add(hl);
    c.setActiveObject(hl);
    c.renderAll();
    saveHistory();
    toast.success('Highlight box added');
  };

  const handleAddRectangle = () => {
    const c = fabricRef.current;
    if (!c) return;
    const w = imgDimensions.width || 800;
    const h = imgDimensions.height || 600;
    const rw = Math.max(120, Math.round(w * 0.25));
    const rh = Math.max(80, Math.round(h * 0.2));
    const sw = Math.max(2, Math.round(Math.min(w, h) * 0.005));

    const rect = new Rect({
      left: Math.round((w - rw) / 2),
      top: Math.round((h - rh) / 2),
      width: rw,
      height: rh,
      fill: 'transparent',
      stroke: '#EF4444',
      strokeWidth: sw,
      rx: 4,
      ry: 4,
    });
    c.add(rect);
    c.setActiveObject(rect);
    c.renderAll();
    saveHistory();
  };

  const handleAddCircle = () => {
    const c = fabricRef.current;
    if (!c) return;
    const w = imgDimensions.width || 800;
    const h = imgDimensions.height || 600;
    const radius = Math.max(35, Math.round(Math.min(w, h) * 0.1));
    const sw = Math.max(2, Math.round(Math.min(w, h) * 0.005));

    const circle = new Circle({
      left: Math.round(w / 2 - radius),
      top: Math.round(h / 2 - radius),
      radius,
      fill: 'transparent',
      stroke: '#3B82F6',
      strokeWidth: sw,
    });
    c.add(circle);
    c.setActiveObject(circle);
    c.renderAll();
    saveHistory();
  };

  const handleAddArrow = () => {
    const c = fabricRef.current;
    if (!c) return;
    const w = imgDimensions.width || 800;
    const h = imgDimensions.height || 600;
    const len = Math.max(70, Math.round(Math.min(w, h) * 0.22));
    const sw = Math.max(2, Math.round(Math.min(w, h) * 0.006));

    const arrow = createArrow(
      Math.round(w / 2 - len / 2),
      Math.round(h / 2),
      Math.round(w / 2 + len / 2),
      Math.round(h / 2),
      '#EF4444',
      sw
    );
    c.add(arrow);
    c.setActiveObject(arrow);
    c.renderAll();
    saveHistory();
  };

  /* ═══════════════════════════════════════════════
   *  Export Handling
   * ═══════════════════════════════════════════════ */
  const handleExport = async () => {
    const c = fabricRef.current;
    if (!c || imgDimensions.width <= 0) return;

    setIsExporting(true);
    try {
      c.discardActiveObject();
      c.renderAll();

      const dataUrl = c.toDataURL({
        format: exportFormat === 'JPEG' ? 'jpeg' : 'png',
        quality: exportQuality / 100,
        multiplier: 1 / zoom, // render at true 1:1 original pixel resolution
      });

      if (exportFormat === 'PDF') {
        const pdfDoc = await PDFDocument.create();
        const a4W = 595.28;
        const a4H = 841.89;
        const isLandscape = imgDimensions.width > imgDimensions.height;
        const pageW = isLandscape ? a4H : a4W;
        const pageH = isLandscape ? a4W : a4H;

        const page = pdfDoc.addPage([pageW, pageH]);
        const pngBytes = base64ToUint8Array(dataUrl.split(',')[1]);
        const embeddedImage = await pdfDoc.embedPng(pngBytes);

        const margin = 20;
        const maxW = pageW - margin * 2;
        const maxH = pageH - margin * 2;
        const scale = Math.min(maxW / imgDimensions.width, maxH / imgDimensions.height);
        const drawW = imgDimensions.width * scale;
        const drawH = imgDimensions.height * scale;

        page.drawImage(embeddedImage, {
          x: (pageW - drawW) / 2,
          y: (pageH - drawH) / 2,
          width: drawW,
          height: drawH,
        });

        const pdfBytes = await pdfDoc.save();
        const b64 = uint8ArrayToBase64(new Uint8Array(pdfBytes));
        const cleanName = imageName.endsWith('.pdf') ? imageName : `${imageName}.pdf`;

        const res = await window.electron.saveFileFromBase64(
          `data:application/pdf;base64,${b64}`,
          cleanName,
          [{ name: 'PDF Documents', extensions: ['pdf'] }]
        );

        if (res.success) {
          toast.success(`PDF saved: ${res.data.split(/[\\/]/).pop()}`);
          setIsExportModalOpen(false);
        } else if (!res.error?.message?.includes('cancelled')) {
          toast.error('Failed to save PDF');
        }
      } else {
        const ext = exportFormat.toLowerCase();
        const cleanName = imageName.endsWith(`.${ext}`) ? imageName : `${imageName}.${ext}`;

        const res = await window.electron.saveFileFromBase64(
          dataUrl,
          cleanName,
          [{ name: `${exportFormat} Image`, extensions: [ext] }]
        );

        if (res.success) {
          toast.success(`Image saved: ${res.data.split(/[\\/]/).pop()}`);
          setIsExportModalOpen(false);
        } else if (!res.error?.message?.includes('cancelled')) {
          toast.error('Failed to save image');
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  /* ═══════════════════════════════════════════════
   *  RENDER: Workspace & Overlay
   * ═══════════════════════════════════════════════ */
  return (
    <div className="h-full flex flex-col bg-bg-base select-none overflow-hidden relative" style={{ minHeight: 0 }}>
      {/* ─── Empty State / Upload Zone Overlay (Canvas stays mounted underneath) ─── */}
      {!hasImage && (
        <div className="absolute inset-0 z-40 bg-bg-base flex flex-col">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-bg-surface shrink-0">
            <button
              onClick={() => setView(AppView.HOME)}
              className="p-2 hover:bg-bg-sunken rounded-md transition-fast text-text-secondary hover:text-text-primary"
              title="Back to Home"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold">Image Editor</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-accent/15 text-accent border border-accent/30 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  Active Feature
                </span>
              </div>
              <p className="text-xs text-text-muted">Crop, enhance, annotate, and markup your images</p>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-xl text-center space-y-6">
              <div className="w-20 h-20 mx-auto bg-accent/10 border border-accent/20 rounded-2xl flex items-center justify-center text-accent shadow-sm">
                <Pencil size={36} />
              </div>
              <div>
                <h2 className="text-xl font-bold">Open an Image to Edit</h2>
                <p className="text-text-secondary mt-1 text-sm">
                  Drop your image, browse from your computer, or paste a screenshot directly with <kbd className="px-1.5 py-0.5 bg-bg-sunken border border-border rounded text-xs font-mono">Ctrl+V</kbd>.
                </p>
              </div>

              <DragDropZone
                accept={['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif']}
                onFilesDropped={(files) => {
                  if (files.length > 0) {
                    handleLoadFromFile(files[0]);
                  }
                }}
                disabled={false}
              />

              <div className="flex justify-center gap-3">
                <Button variant="primary" size="lg" onClick={handleOpenLocalFile}>
                  <FolderOpen size={18} className="mr-2" /> Browse Image File
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ─── Top Header Bar ─── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#18181B] text-white border-b border-[#27272A] shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const hasDocs = useAppStore.getState().documents.length > 0;
              setView(hasDocs ? AppView.DOCUMENT_LIST : AppView.HOME);
            }}
            className="p-1.5 hover:bg-[#27272A] rounded-md transition-fast text-gray-400 hover:text-white"
            title="Back to Documents"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="h-4 w-px bg-gray-700" />
          <button
            onClick={handleOpenLocalFile}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#27272A] hover:bg-[#3F3F46] rounded-md transition-colors text-gray-200"
            title="Open another image"
          >
            <FolderOpen size={14} /> Open Image
          </button>
          <button
            onClick={() => {
              if (rawImageRef.current) {
                loadImageElement(rawImageRef.current, imageName);
                toast.success('Reset to original image');
              }
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#27272A] hover:bg-[#3F3F46] rounded-md transition-colors text-gray-300 hover:text-white"
            title="Reset all edits and return to original uncropped image"
          >
            <RotateCcw size={13} /> Reset
          </button>
          <div className="h-4 w-px bg-gray-700" />
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent/20 border border-accent/40 text-accent text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            Image Editor Active
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <div>
            <h2 className="text-xs font-bold truncate max-w-[220px] text-gray-100">{imageName}</h2>
            <p className="text-[10px] text-gray-400 font-mono">
              {imgDimensions.width} × {imgDimensions.height} px
            </p>
          </div>
        </div>

        {/* Undo / Redo & Zoom Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#27272A] px-1 py-0.5 rounded-lg border border-[#3F3F46]">
            <button
              onClick={handleUndo}
              disabled={historyIdxRef.current <= 0}
              className="p-1.5 hover:bg-[#3F3F46] rounded text-gray-300 disabled:opacity-25 transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={handleRedo}
              disabled={historyIdxRef.current >= historyRef.current.length - 1}
              className="p-1.5 hover:bg-[#3F3F46] rounded text-gray-300 disabled:opacity-25 transition-colors"
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={14} />
            </button>
          </div>

          <div className="flex items-center gap-1 bg-[#27272A] px-1.5 py-0.5 rounded-lg border border-[#3F3F46]">
            <button
              onClick={() => {
                const n = Math.max(0.2, parseFloat((zoom - 0.15).toFixed(2)));
                setZoom(n);
                fabricRef.current?.setZoom(n);
                fabricRef.current?.setDimensions({
                  width: imgDimensions.width * n,
                  height: imgDimensions.height * n
                });
              }}
              className="p-1 hover:bg-[#3F3F46] rounded text-gray-300 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-[11px] font-mono w-11 text-center text-gray-200">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => {
                const n = Math.min(3, parseFloat((zoom + 0.15).toFixed(2)));
                setZoom(n);
                fabricRef.current?.setZoom(n);
                fabricRef.current?.setDimensions({
                  width: imgDimensions.width * n,
                  height: imgDimensions.height * n
                });
              }}
              className="p-1 hover:bg-[#3F3F46] rounded text-gray-300 transition-colors"
              title="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => {
                const fit = fitZoomToViewport(imgDimensions.width, imgDimensions.height);
                setZoom(fit);
                fabricRef.current?.setZoom(fit);
                fabricRef.current?.setDimensions({
                  width: imgDimensions.width * fit,
                  height: imgDimensions.height * fit
                });
              }}
              className="p-1 hover:bg-[#3F3F46] rounded text-gray-300 transition-colors"
              title="Fit to Screen"
            >
              <Maximize2 size={13} />
            </button>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsExportModalOpen(true)}
            className="font-bold text-xs bg-accent hover:bg-accent-hover text-white shadow-sm"
          >
            <Download size={14} className="mr-1.5" /> Export
          </Button>
        </div>
      </div>

      {/* ── Document Switcher Bar ── */}
      <DocumentSelectorBar
        activeDocumentId={currentDocId || undefined}
        onSelectDocument={loadDocumentIntoCanvas}
        acceptedTypes={[DocumentType.IMAGE]}
        title="Image Editor"
      />

      {/* ─── Main Content: Left Tools + Center Canvas ─── */}
      <div className="flex flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
        {/* Left Side Tool Panel */}
        <div className="w-72 bg-bg-surface border-r border-border flex flex-col shrink-0 overflow-y-auto select-none">
          {/* Top Tabs */}
          <div className="flex border-b border-border bg-bg-sunken p-1.5 gap-1 shrink-0">
            {[
              { id: 'crop' as EditorTab, label: 'Crop & Rotate', icon: <Crop size={14} /> },
              { id: 'adjust' as EditorTab, label: 'Adjust', icon: <Sliders size={14} /> },
              { id: 'text' as EditorTab, label: 'Text', icon: <Type size={14} /> },
              { id: 'shapes' as EditorTab, label: 'Shapes', icon: <Square size={14} /> },
              { id: 'draw' as EditorTab, label: 'Draw', icon: <Pencil size={14} /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'crop') setIsCropping(true);
                  else setIsCropping(false);
                }}
                className={`flex-1 py-1.5 px-1 rounded-md text-[11px] font-semibold flex flex-col items-center gap-1 transition-fast ${
                  activeTab === tab.id
                    ? 'bg-bg-surface text-accent shadow-sm border border-border/50'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Specific Content */}
          <div className="p-4 space-y-4 flex-1">
            {/* ── Tab: Crop & Rotate ── */}
            {activeTab === 'crop' && (
              <div className="space-y-4 animate-fade-in">
                {/* Rotate & Flip */}
                <div>
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2">
                    Rotate & Flip
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    <button
                      onClick={() => handleRotate(false)}
                      className="p-2 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium text-text-secondary hover:text-text-primary transition-colors"
                      title="Rotate 90° Counter-Clockwise"
                    >
                      <RotateCcw size={16} /> CCW
                    </button>
                    <button
                      onClick={() => handleRotate(true)}
                      className="p-2 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium text-text-secondary hover:text-text-primary transition-colors"
                      title="Rotate 90° Clockwise"
                    >
                      <RotateCw size={16} /> CW
                    </button>
                    <button
                      onClick={() => handleFlip(true)}
                      className="p-2 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium text-text-secondary hover:text-text-primary transition-colors"
                      title="Flip Horizontally"
                    >
                      <FlipHorizontal size={16} /> Flip H
                    </button>
                    <button
                      onClick={() => handleFlip(false)}
                      className="p-2 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg flex flex-col items-center gap-1 text-[10px] font-medium text-text-secondary hover:text-text-primary transition-colors"
                      title="Flip Vertically"
                    >
                      <FlipVertical size={16} /> Flip V
                    </button>
                  </div>
                </div>

                {/* Aspect Ratio Presets */}
                <div>
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2">
                    Aspect Ratio
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ASPECT_RATIOS.map((r) => (
                      <button
                        key={r.label}
                        onClick={() => {
                          setSelectedRatio(r.ratio);
                          setIsCropping(true);
                          if (r.ratio) {
                            // Calculate centered box conforming to aspect ratio
                            const imgW = imgDimensions.width;
                            const imgH = imgDimensions.height;
                            const imgRatio = imgW / imgH;
                            let newW = 80;
                            let newH = 80;
                            if (r.ratio > imgRatio) {
                              newH = (newW / r.ratio) * imgRatio;
                            } else {
                              newW = (newH * r.ratio) / imgRatio;
                            }
                            setCropBox({
                              x: (100 - newW) / 2,
                              y: (100 - newH) / 2,
                              w: newW,
                              h: newH,
                            });
                          }
                        }}
                        className={`p-2 border rounded-lg text-left transition-colors ${
                          selectedRatio === r.ratio
                            ? 'bg-accent/15 border-accent text-accent font-semibold'
                            : 'bg-bg-sunken border-border hover:bg-bg-base text-text-secondary'
                        }`}
                      >
                        <p className="text-xs">{r.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Crop Action Buttons */}
                <div className="pt-2 border-t border-border space-y-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center py-2 text-xs font-bold"
                    onClick={handleApplyCrop}
                  >
                    <Check size={14} className="mr-1.5" /> Apply Crop
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center py-1.5 text-xs text-text-muted hover:text-text-secondary"
                    onClick={() => {
                      setIsCropping(false);
                      setCropBox({ x: 0, y: 0, w: 100, h: 100 });
                    }}
                  >
                    Cancel Crop
                  </Button>
                </div>
              </div>
            )}

            {/* ── Tab: Adjust & Filters ── */}
            {activeTab === 'adjust' && (
              <div className="space-y-4 animate-fade-in">
                {/* 1-Click Document Presets */}
                <div>
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2">
                    Quick Presets
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { id: 'none' as FilterPreset, label: 'Original' },
                      { id: 'enhance' as FilterPreset, label: 'Auto Enhance' },
                      { id: 'clean' as FilterPreset, label: 'Clean Scan' },
                      { id: 'bw' as FilterPreset, label: 'Crisp B&W' },
                      { id: 'grayscale' as FilterPreset, label: 'Grayscale' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setActiveFilter(p.id)}
                        className={`p-2 rounded-lg border text-xs text-left transition-colors font-medium ${
                          activeFilter === p.id
                            ? 'bg-accent text-white border-accent shadow-sm'
                            : 'bg-bg-sunken border-border hover:bg-bg-base text-text-secondary'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fine Sliders */}
                <div className="space-y-3 pt-2 border-t border-border">
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">
                    Fine Adjustments
                  </span>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-secondary">Brightness</span>
                      <span className="font-mono text-text-primary">{brightness > 0 ? `+${brightness}` : brightness}%</span>
                    </div>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={brightness}
                      onChange={(e) => setBrightness(Number(e.target.value))}
                      className="w-full accent-accent cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-secondary">Contrast</span>
                      <span className="font-mono text-text-primary">{contrast > 0 ? `+${contrast}` : contrast}%</span>
                    </div>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={contrast}
                      onChange={(e) => setContrast(Number(e.target.value))}
                      className="w-full accent-accent cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-secondary">Saturation</span>
                      <span className="font-mono text-text-primary">{saturation > 0 ? `+${saturation}` : saturation}%</span>
                    </div>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={saturation}
                      onChange={(e) => setSaturation(Number(e.target.value))}
                      className="w-full accent-accent cursor-pointer"
                    />
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center py-1.5 text-xs text-text-muted hover:text-text-primary"
                    onClick={() => {
                      setBrightness(0);
                      setContrast(0);
                      setSaturation(0);
                      setActiveFilter('none');
                    }}
                  >
                    Reset Adjustments
                  </Button>
                </div>
              </div>
            )}

            {/* ── Tab: Text ── */}
            {activeTab === 'text' && (
              <div className="space-y-4 animate-fade-in">
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center py-2 text-xs font-bold"
                  onClick={handleAddText}
                >
                  <Type size={14} className="mr-1.5" /> Add Text Box
                </Button>

                {sel && (sel.type === 'textbox' || sel.type === 'text') ? (
                  <div className="p-3 bg-bg-sunken border border-border rounded-lg space-y-3">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">
                      Edit Selected Text
                    </span>

                    {/* Font Size */}
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">Font Size</span>
                        <span className="font-mono text-text-primary">{sel.fontSize || 24}px</span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={96}
                        value={sel.fontSize || 24}
                        onChange={(e) => updateSelectedProp('fontSize', Number(e.target.value))}
                        className="w-full accent-accent"
                      />
                    </div>

                    {/* Style Toggles */}
                    <div className="flex gap-1 items-center">
                      <button
                        onClick={() => updateSelectedProp('fontWeight', sel.fontWeight === 'bold' ? 'normal' : 'bold')}
                        className={`p-1.5 rounded border text-xs font-bold transition-colors ${
                          sel.fontWeight === 'bold' ? 'bg-accent text-white border-accent' : 'bg-bg-surface border-border text-text-secondary'
                        }`}
                      >
                        <Bold size={13} />
                      </button>
                      <button
                        onClick={() => updateSelectedProp('fontStyle', sel.fontStyle === 'italic' ? 'normal' : 'italic')}
                        className={`p-1.5 rounded border text-xs font-bold transition-colors ${
                          sel.fontStyle === 'italic' ? 'bg-accent text-white border-accent' : 'bg-bg-surface border-border text-text-secondary'
                        }`}
                      >
                        <Italic size={13} />
                      </button>
                      <button
                        onClick={() => updateSelectedProp('underline', !sel.underline)}
                        className={`p-1.5 rounded border text-xs font-bold transition-colors ${
                          sel.underline ? 'bg-accent text-white border-accent' : 'bg-bg-surface border-border text-text-secondary'
                        }`}
                      >
                        <Underline size={13} />
                      </button>
                      <div className="w-px h-5 bg-border mx-1" />
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                          key={align}
                          onClick={() => updateSelectedProp('textAlign', align)}
                          className={`p-1.5 rounded border text-xs transition-colors ${
                            sel.textAlign === align ? 'bg-accent text-white border-accent' : 'bg-bg-surface border-border text-text-secondary'
                          }`}
                        >
                          {align === 'left' ? <AlignLeft size={13} /> : align === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
                        </button>
                      ))}
                    </div>

                    {/* Color */}
                    <div>
                      <span className="text-xs text-text-secondary block mb-1">Color</span>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => updateSelectedProp('fill', c)}
                            className="w-5 h-5 rounded-full border border-border/60 hover:scale-110 transition-transform"
                            style={{ backgroundColor: c }}
                          />
                        ))}
                        <input
                          type="color"
                          value={String(sel.fill || '#000000')}
                          onChange={(e) => updateSelectedProp('fill', e.target.value)}
                          className="w-6 h-6 rounded cursor-pointer border border-border p-0"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted text-center italic py-2">
                    Click &quot;Add Text Box&quot; or select any text to customize formatting.
                  </p>
                )}
              </div>
            )}

            {/* ── Tab: Shapes & Redact ── */}
            {activeTab === 'shapes' && (
              <div className="space-y-4 animate-fade-in">
                {/* Privacy Redact Tool */}
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-2">
                  <div className="flex items-center gap-1.5 text-red-400">
                    <Shield size={14} />
                    <span className="text-xs font-bold uppercase tracking-wider">Privacy Redaction</span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-snug">
                    Cover private numbers, Aadhaar, names, or signatures with an unremovable blackout mask.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white border-none"
                    onClick={handleAddRedaction}
                  >
                    + Add Blackout Box
                  </Button>
                </div>

                {/* Standard Shapes */}
                <div>
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2">
                    Document Callouts
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleAddHighlightBox}
                      className="p-2.5 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors text-left"
                    >
                      <div className="w-4 h-3 bg-amber-400/40 border border-amber-500 rounded-sm" />
                      Highlight Box
                    </button>
                    <button
                      onClick={handleAddRectangle}
                      className="p-2.5 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors text-left"
                    >
                      <Square size={14} className="text-red-400" />
                      Box Outline
                    </button>
                    <button
                      onClick={handleAddCircle}
                      className="p-2.5 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors text-left"
                    >
                      <CircleIcon size={14} className="text-blue-400" />
                      Circle
                    </button>
                    <button
                      onClick={handleAddArrow}
                      className="p-2.5 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg flex items-center gap-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors text-left"
                    >
                      <ArrowRight size={14} className="text-red-400" />
                      Arrow
                    </button>
                  </div>
                </div>

                {/* Color for selected shape */}
                {sel && sel.type !== 'textbox' && (
                  <div className="p-3 bg-bg-sunken border border-border rounded-lg space-y-2">
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">
                      Shape Color
                    </span>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => {
                            if (sel.stroke) updateSelectedProp('stroke', c);
                            else updateSelectedProp('fill', c);
                          }}
                          className="w-5 h-5 rounded-full border border-border/60 hover:scale-110 transition-transform"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Draw & Pen ── */}
            {activeTab === 'draw' && (
              <div className="space-y-4 animate-fade-in">
                <div>
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block mb-2">
                    Drawing Mode
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setDrawMode('pen')}
                      className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 font-medium transition-colors ${
                        drawMode === 'pen'
                          ? 'bg-accent/15 border-accent text-accent'
                          : 'bg-bg-sunken border-border text-text-secondary'
                      }`}
                    >
                      <Pencil size={15} /> Pen Ink
                    </button>
                    <button
                      onClick={() => setDrawMode('highlighter')}
                      className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 font-medium transition-colors ${
                        drawMode === 'highlighter'
                          ? 'bg-accent/15 border-accent text-accent'
                          : 'bg-bg-sunken border-border text-text-secondary'
                      }`}
                    >
                      <Highlighter size={15} /> Highlighter
                    </button>
                  </div>
                </div>

                {/* Brush Width */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-secondary">Thickness</span>
                    <span className="font-mono text-text-primary">{drawWidth}px</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={drawWidth}
                    onChange={(e) => setDrawWidth(Number(e.target.value))}
                    className="w-full accent-accent cursor-pointer"
                  />
                </div>

                {/* Color */}
                <div>
                  <span className="text-xs text-text-secondary block mb-1.5">Color</span>
                  <div className="flex flex-wrap gap-2 items-center">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setDrawColor(c)}
                        className={`w-6 h-6 rounded-full border transition-transform ${
                          drawColor === c ? 'scale-125 border-accent ring-2 ring-accent/30' : 'border-border/60 hover:scale-110'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <input
                      type="color"
                      value={drawColor}
                      onChange={(e) => setDrawColor(e.target.value)}
                      className="w-7 h-7 rounded cursor-pointer border border-border p-0"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-text-muted italic bg-bg-sunken p-2.5 rounded border border-border/60">
                  Draw directly on the image with mouse or touch pen. Switch tabs when finished.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Center Canvas Viewport */}
        <div
          ref={viewportRef}
          className="flex-1 bg-[#121214] overflow-auto flex items-center justify-center relative p-8 select-none"
          style={{ minHeight: 0 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) {
              handleLoadFromFile(file);
            }
          }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.1 : 0.1;
              const next = Math.max(0.15, Math.min(3, parseFloat((zoom + delta).toFixed(2))));
              setZoom(next);
              fabricRef.current?.setZoom(next);
              fabricRef.current?.setDimensions({
                width: imgDimensions.width * next,
                height: imgDimensions.height * next,
              });
            }
          }}
          onMouseDown={(e) => {
            if (e.target === viewportRef.current) {
              fabricRef.current?.discardActiveObject();
              fabricRef.current?.renderAll();
              bump();
            }
          }}
        >
          {/* Canvas Wrapper */}
          <div
            className="relative shadow-2xl rounded overflow-hidden"
            style={{
              width: imgDimensions.width > 0 ? imgDimensions.width * zoom : 800,
              height: imgDimensions.height > 0 ? imgDimensions.height * zoom : 600,
            }}
          >
            <canvas ref={canvasElRef} />

            {/* ── Interactive Crop Overlay ── */}
            {isCropping && (
              <div
                className="absolute inset-0 z-30 select-none cursor-crosshair"
                onPointerMove={(e) => {
                  if (!dragCropHandle || !cropDragStart) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (rect.width <= 0 || rect.height <= 0) return;
                  const dx = ((e.clientX - cropDragStart.x) / rect.width) * 100;
                  const dy = ((e.clientY - cropDragStart.y) / rect.height) * 100;

                  setCropBox((prev) => {
                    let { x, y, w, h } = prev;

                    if (dragCropHandle === 'move') {
                      x = Math.max(0, Math.min(100 - w, x + dx));
                      y = Math.max(0, Math.min(100 - h, y + dy));
                    } else if (dragCropHandle === 'tl') {
                      const nx = Math.max(0, Math.min(x + w - 5, x + dx));
                      const ny = Math.max(0, Math.min(y + h - 5, y + dy));
                      w = w - (nx - x);
                      h = h - (ny - y);
                      x = nx;
                      y = ny;
                    } else if (dragCropHandle === 'tr') {
                      const ny = Math.max(0, Math.min(y + h - 5, y + dy));
                      w = Math.max(5, Math.min(100 - x, w + dx));
                      h = h - (ny - y);
                      y = ny;
                    } else if (dragCropHandle === 'bl') {
                      const nx = Math.max(0, Math.min(x + w - 5, x + dx));
                      w = w - (nx - x);
                      h = Math.max(5, Math.min(100 - y, h + dy));
                      x = nx;
                    } else if (dragCropHandle === 'br') {
                      w = Math.max(5, Math.min(100 - x, w + dx));
                      h = Math.max(5, Math.min(100 - y, h + dy));
                    }

                    if (selectedRatio && dragCropHandle !== 'move') {
                      const imgRatio = imgDimensions.width / imgDimensions.height;
                      const targetPercentRatio = selectedRatio / imgRatio;
                      h = Math.max(5, Math.min(100 - y, w / targetPercentRatio));
                    }

                    return { x, y, w, h };
                  });
                  setCropDragStart({ x: e.clientX, y: e.clientY });
                }}
                onPointerUp={() => {
                  setDragCropHandle(null);
                  setCropDragStart(null);
                }}
              >
                {/* SVG shaded mask */}
                <svg className="w-full h-full absolute inset-0 pointer-events-none">
                  <defs>
                    <mask id="crop-mask">
                      <rect width="100%" height="100%" fill="white" />
                      <rect
                        x={`${cropBox.x}%`}
                        y={`${cropBox.y}%`}
                        width={`${cropBox.w}%`}
                        height={`${cropBox.h}%`}
                        fill="black"
                      />
                    </mask>
                  </defs>
                  <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.55)" mask="url(#crop-mask)" />
                </svg>

                {/* Crop Box Rectangle */}
                <div
                  className="absolute border-2 border-accent cursor-move shadow-md"
                  style={{
                    left: `${cropBox.x}%`,
                    top: `${cropBox.y}%`,
                    width: `${cropBox.w}%`,
                    height: `${cropBox.h}%`,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDragCropHandle('move');
                    setCropDragStart({ x: e.clientX, y: e.clientY });
                  }}
                >
                  {/* Grid Lines */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-40">
                    <div className="border-r border-b border-white" />
                    <div className="border-r border-b border-white" />
                    <div className="border-b border-white" />
                    <div className="border-r border-b border-white" />
                    <div className="border-r border-b border-white" />
                    <div className="border-b border-white" />
                    <div className="border-r border-b border-white" />
                    <div className="border-r border-b border-white" />
                    <div />
                  </div>

                  {/* Corner Handles */}
                  <div
                    className="absolute -top-2 -left-2 w-4 h-4 bg-accent border-2 border-white rounded-full cursor-nwse-resize shadow"
                    title="Resize Top-Left"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDragCropHandle('tl');
                      setCropDragStart({ x: e.clientX, y: e.clientY });
                    }}
                  />
                  <div
                    className="absolute -top-2 -right-2 w-4 h-4 bg-accent border-2 border-white rounded-full cursor-nesw-resize shadow"
                    title="Resize Top-Right"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDragCropHandle('tr');
                      setCropDragStart({ x: e.clientX, y: e.clientY });
                    }}
                  />
                  <div
                    className="absolute -bottom-2 -left-2 w-4 h-4 bg-accent border-2 border-white rounded-full cursor-nesw-resize shadow"
                    title="Resize Bottom-Left"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDragCropHandle('bl');
                      setCropDragStart({ x: e.clientX, y: e.clientY });
                    }}
                  />
                  <div
                    className="absolute -bottom-2 -right-2 w-4 h-4 bg-accent border-2 border-white rounded-full cursor-nwse-resize shadow"
                    title="Resize Bottom-Right"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDragCropHandle('br');
                      setCropDragStart({ x: e.clientX, y: e.clientY });
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Floating Context Toolbar when an object is selected */}
          {sel && !isCropping && (
            <div className="absolute bottom-6 bg-[#18181B]/95 backdrop-blur-md border border-[#3F3F46] rounded-xl px-3 py-1.5 shadow-2xl flex items-center gap-2 text-white z-20 animate-fade-in-up">
              <span className="text-[10px] uppercase font-bold text-gray-400 border-r border-gray-700 pr-2">
                {sel.type === 'textbox' ? 'Text' : sel.customData?.isRedact ? 'Redact' : 'Shape'}
              </span>
              <button
                onClick={handleDuplicate}
                className="p-1.5 hover:bg-[#27272A] rounded text-gray-300 hover:text-white transition-colors"
                title="Duplicate (Ctrl+D)"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => {
                  const c = fabricRef.current;
                  const o = c?.getActiveObject();
                  if (o && c) {
                    c.bringObjectToFront(o);
                    c.renderAll();
                  }
                }}
                className="p-1.5 hover:bg-[#27272A] rounded text-gray-300 hover:text-white transition-colors"
                title="Bring to Front"
              >
                <Layers size={14} />
              </button>
              <div className="h-3 w-px bg-gray-700" />
              <button
                onClick={handleDeleteSelected}
                className="p-1.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 transition-colors"
                title="Delete (Del)"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Export Modal ─── */}
      {isExportModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bg-surface border border-border rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-4 animate-scale-in">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="font-bold text-sm text-text-primary flex items-center gap-1.5">
                <Download size={16} className="text-accent" /> Save & Export Image
              </h3>
              <button
                onClick={() => setIsExportModalOpen(false)}
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-sunken transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Format Selector */}
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1.5">File Format</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['PNG', 'JPEG', 'PDF'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setExportFormat(fmt)}
                    className={`py-2 text-xs font-bold rounded-lg border transition-colors ${
                      exportFormat === fmt
                        ? 'bg-accent text-white border-accent shadow-sm'
                        : 'bg-bg-sunken border-border text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Filename */}
            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1">File Name</label>
              <input
                type="text"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-bg-sunken border border-border rounded-lg text-xs font-medium text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            {/* Quality for JPEG */}
            {exportFormat === 'JPEG' && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-secondary font-medium">JPEG Quality</span>
                  <span className="font-mono text-text-primary">{exportQuality}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={exportQuality}
                  onChange={(e) => setExportQuality(Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
              </div>
            )}

            {/* Output resolution note */}
            <p className="text-[11px] text-text-muted bg-bg-sunken p-2 rounded border border-border/50">
              Exports at native <strong className="text-text-primary">{imgDimensions.width} × {imgDimensions.height} px</strong> full resolution.
            </p>

            {/* Action Buttons */}
            <div className="pt-2 border-t border-border flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-center py-2 text-xs"
                onClick={() => setIsExportModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={isExporting}
                className="flex-1 justify-center py-2 text-xs font-bold"
                onClick={handleExport}
              >
                {isExporting ? (
                  <>
                    <Loader2 size={14} className="mr-1.5 animate-spin" /> Saving...
                  </>
                ) : (
                  'Save File As...'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for native OS file selection fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            handleLoadFromFile(f);
          }
        }}
      />
    </div>
  );
}
