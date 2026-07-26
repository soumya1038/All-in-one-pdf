import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Canvas as FabricCanvas,
  Rect,
  Circle,
  Textbox,
  FabricImage,
  Triangle,
  Line,
  Polygon,
  PencilBrush,
  FabricObject,
} from 'fabric';
import {
  ArrowLeft,
  Download,
  Loader2,
  Type,
  Square,
  Circle as CircleIcon,
  ImagePlus,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FolderOpen,
  Lock,
  Unlock,
  Star,
  Palette,
  Trash,
  Wand2,
  Smile,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Layers,
  Copy,
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  Pencil,
  MousePointer2,
  Minus,
  Move,
  Triangle as TriangleIcon,
  Hexagon,
  Heart,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAppStore } from '../store/appStore';
import { AppView } from '../types/UI.types';
import { OutputFormat } from '../types/Output.types';
import Button from '../components/ui/Button';
import DragDropZone from '../components/ui/DragDropZone';
import { PDFDocument } from 'pdf-lib';
import { removeBackground } from '@imgly/background-removal';

/* ═══════════════════════════════════════════════
 *  Constants
 * ═══════════════════════════════════════════════ */
const FONT_OPTIONS = [
  'Inter', 'Arial', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins',
  'Lato', 'Oswald', 'Playfair Display', 'Raleway', 'Georgia',
  'Times New Roman', 'Courier New', 'Verdana', 'Impact', 'Comic Sans MS',
  'Trebuchet MS', 'Garamond', 'Palatino', 'Tahoma', 'Segoe UI',
  'Nunito', 'Ubuntu', 'Merriweather', 'Quicksand', 'DM Sans',
];

const PRESET_COLORS = [
  '#000000', '#FFFFFF', '#F3F4F6', '#D1D5DB', '#6B7280', '#374151',
  '#EF4444', '#DC2626', '#F97316', '#EA580C', '#F59E0B', '#84CC16',
  '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#EC4899', '#F43F5E', '#1C1917', '#44403C', '#FDE68A', '#BFDBFE',
];

const CANVAS_PRESETS = [
  { name: 'Instagram Post', w: 1080, h: 1080, icon: '📸' },
  { name: 'Instagram Story', w: 1080, h: 1920, icon: '📱' },
  { name: 'YouTube Thumbnail', w: 1280, h: 720, icon: '▶️' },
  { name: 'Facebook Post', w: 1200, h: 630, icon: '👥' },
  { name: 'Twitter/X Post', w: 1600, h: 900, icon: '🐦' },
  { name: 'Presentation 16:9', w: 1920, h: 1080, icon: '🖥️' },
  { name: 'A4 Portrait', w: 2480, h: 3508, icon: '📄' },
  { name: 'A4 Landscape', w: 3508, h: 2480, icon: '📃' },
  { name: 'Poster', w: 1587, h: 2245, icon: '🪧' },
  { name: 'Business Card', w: 1050, h: 600, icon: '💳' },
  { name: 'Logo', w: 500, h: 500, icon: '⭐' },
  { name: 'Desktop Wallpaper', w: 2560, h: 1440, icon: '🖥️' },
];

type ToolType = 'select' | 'text' | 'shapes' | 'draw' | 'background' | 'resize';
type ShapeKind = 'rect' | 'circle' | 'triangle' | 'line' | 'star' | 'polygon' | 'heart';

/* ═══════════════════════════════════════════════
 *  Main Component
 * ═══════════════════════════════════════════════ */
export default function CanvasEditorScreen() {
  const setView = useAppStore((s) => s.setView);

  // Core refs
  const fabricRef = useRef<FabricCanvas | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // State
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [canvasW, setCanvasW] = useState(1920);
  const [canvasH, setCanvasH] = useState(1080);
  const [zoom, setZoom] = useState(0.45);
  const [activeTool, setActiveTool] = useState<ToolType>('select');
  const [selVer, setSelVer] = useState(0);
  const [brushColor, setBrushColor] = useState('#EF4444');
  const [brushSize, setBrushSize] = useState(5);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'PNG' | 'JPEG' | 'PDF'>('PNG');
  const [exportQuality, setExportQuality] = useState(92);
  const [filename, setFilename] = useState('design');
  const [bgRemovingId, setBgRemovingId] = useState<string | null>(null);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [grabbingText, setGrabbingText] = useState(false);

  // History
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const isRestoringRef = useRef(false);

  // Clipboard
  const clipboardRef = useRef<FabricObject | null>(null);

  // Active Tool Ref to bypass stale closure in canvas event handlers
  const activeToolRef = useRef<ToolType>(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  // Bump selection - forces re-render so `sel` is re-evaluated
  const bump = useCallback(() => setSelVer((v) => v + 1), []);

  // Get active selection (re-evaluated each render)
  const fc = fabricRef.current;
  const sel = fc?.getActiveObject() as (FabricObject & Record<string, any>) | undefined;
  void selVer; // selVer triggers re-render

  /* ═══════════════════════════════════════════════
   *  Canvas Initialization
   * ═══════════════════════════════════════════════ */
  useEffect(() => {
    if (!canvasElRef.current || fabricRef.current) return;

    const c = new FabricCanvas(canvasElRef.current, {
      width: canvasW * zoom,
      height: canvasH * zoom,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
      stopContextMenu: true,
      fireRightClick: true,
    });
    c.setZoom(zoom);
    fabricRef.current = c;

    // Canva-like selection handles
    FabricObject.prototype.set({
      transparentCorners: false,
      cornerColor: '#2563EB',
      cornerStrokeColor: '#1D4ED8',
      cornerStyle: 'circle',
      cornerSize: 10,
      borderColor: '#3B82F6',
      borderDashArray: undefined,
      borderScaleFactor: 1.8,
      padding: 6,
      rotatingPointOffset: 30,
    });

    // Events
    const syncSel = () => bump();
    c.on('selection:created', syncSel);
    c.on('selection:updated', syncSel);
    c.on('selection:cleared', syncSel);
    c.on('object:modified', () => { syncSel(); saveHistory(); });
    c.on('text:changed', syncSel);
    c.on('object:added', () => { if (!isRestoringRef.current) saveHistory(); });

    c.on('mouse:down', (options) => {
      if (activeToolRef.current === 'text') {
        // If clicking on an existing object, don't create new text
        const target = c.findTarget(options.e);
        if (target) return;

        const pointer = c.getPointer(options.e);
        const text = new Textbox('Type something...', {
          left: pointer.x - 100,
          top: pointer.y - 12,
          width: 200,
          fontSize: 24,
          fontFamily: 'Inter',
          fill: '#1F2937',
          textAlign: 'left',
          editable: true,
        });
        (text as any).customData = { id: `text_${Date.now()}` };
        c.add(text);
        c.setActiveObject(text);
        setActiveTool('select');
        c.renderAll();
        setTimeout(() => {
          text.enterEditing();
          text.selectAll();
        }, 50);
      }
    });

    // Initial history
    setTimeout(() => saveHistory(), 100);

    return () => {
      c.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceLoaded]);

  /* ═══════════════════════════════════════════════
   *  Load Google Fonts
   * ═══════════════════════════════════════════════ */
  useEffect(() => {
    const fontFamilies = [
      'Inter:wght@300;400;600;700;900',
      'Roboto:wght@300;400;500;700',
      'Open+Sans:wght@300;400;600;700',
      'Montserrat:wght@300;400;600;700;900',
      'Poppins:wght@300;400;500;600;700',
      'Lato:wght@300;400;700',
      'Playfair+Display:wght@400;700',
      'Raleway:wght@300;400;600;700',
      'Nunito:wght@300;400;600;700',
      'Quicksand:wght@400;500;700',
      'DM+Sans:wght@400;500;700',
    ].join('&family=');
    const link = document.createElement('link');
    link.href = `https://fonts.googleapis.com/css2?family=${fontFamilies}&display=swap`;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { document.head.removeChild(link); };
  }, []);

  /* ═══════════════════════════════════════════════
   *  Load Image from Store
   * ═══════════════════════════════════════════════ */
  useEffect(() => {
    const docState = useAppStore.getState();
    const docs = docState.documents;
    const activeDocId = docState.ui.selectedDocumentId;
    let mainDoc = docs.find((d) => d.id === activeDocId && d.type === 'IMAGE');
    if (!mainDoc) mainDoc = docs.find((d) => d.type === 'IMAGE');

    if (mainDoc) {
      const imgUrl = `docuflow:///${mainDoc.tempPath.replace(/\\/g, '/')}`;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setCanvasW(img.naturalWidth);
        setCanvasH(img.naturalHeight);
        setCustomW(img.naturalWidth);
        setCustomH(img.naturalHeight);
        // Auto-fit zoom
        const vw = (viewportRef.current?.clientWidth || 900) - 80;
        const vh = (viewportRef.current?.clientHeight || 600) - 80;
        const fitZoom = Math.min(vw / img.naturalWidth, vh / img.naturalHeight, 1);
        setZoom(fitZoom);
        setSourceLoaded(true);

        // Add image to canvas after fabric initializes
        setTimeout(() => {
          const c = fabricRef.current;
          if (!c) return;
          c.setDimensions({ width: img.naturalWidth * fitZoom, height: img.naturalHeight * fitZoom });
          c.setZoom(fitZoom);

          const fabricImg = new FabricImage(img, {
            left: 0,
            top: 0,
            selectable: true,
            evented: true,
            hasControls: true,
          });
          (fabricImg as any).customData = { isBackground: true, id: 'bg_image' };
          // Scale to fit canvas exactly
          fabricImg.scaleToWidth(img.naturalWidth);
          c.add(fabricImg);
          c.sendObjectToBack(fabricImg);
          c.renderAll();
          saveHistory();
        }, 200);
      };
      img.src = imgUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ═══════════════════════════════════════════════
   *  History / Undo / Redo
   * ═══════════════════════════════════════════════ */
  const saveHistory = useCallback(() => {
    const c = fabricRef.current;
    if (!c || isRestoringRef.current) return;
    const json = JSON.stringify(c.toJSON());
    const h = historyRef.current;
    const idx = historyIdxRef.current;
    historyRef.current = [...h.slice(0, idx + 1), json];
    if (historyRef.current.length > 50) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
  }, []);

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
   *  Zoom Controls
   * ═══════════════════════════════════════════════ */
  const applyZoom = useCallback((z: number) => {
    const c = fabricRef.current;
    if (!c) return;
    const clamped = Math.max(0.1, Math.min(3, z));
    c.setZoom(clamped);
    c.setDimensions({ width: canvasW * clamped, height: canvasH * clamped });
    setZoom(clamped);
  }, [canvasW, canvasH]);

  const zoomIn = () => applyZoom(zoom + 0.1);
  const zoomOut = () => applyZoom(zoom - 0.1);
  const zoomFit = () => {
    const vw = (viewportRef.current?.clientWidth || 900) - 80;
    const vh = (viewportRef.current?.clientHeight || 600) - 80;
    applyZoom(Math.min(vw / canvasW, vh / canvasH, 1));
  };

  /* ═══════════════════════════════════════════════
   *  Tool Switching
   * ═══════════════════════════════════════════════ */
  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    if (activeTool === 'draw') {
      c.isDrawingMode = true;
      if (!c.freeDrawingBrush || !(c.freeDrawingBrush instanceof PencilBrush)) {
        c.freeDrawingBrush = new PencilBrush(c);
      }
      c.freeDrawingBrush.color = brushColor;
      c.freeDrawingBrush.width = brushSize;
    } else {
      c.isDrawingMode = false;
    }
    c.renderAll();
  }, [activeTool, brushColor, brushSize]);

  /* ═══════════════════════════════════════════════
   *  Object Property Update Helper
   * ═══════════════════════════════════════════════ */
  const updateProp = useCallback((key: string, value: any) => {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    (obj as any).set(key, value);
    obj.setCoords();
    c.renderAll();
    bump();
  }, [bump]);

  const updateScale = useCallback((dim: 'w' | 'h', value: number) => {
    const obj = fabricRef.current?.getActiveObject();
    if (!obj) return;
    const v = Math.max(5, value);
    if (dim === 'w') {
      obj.set('scaleX', v / (obj.width || 1));
    } else {
      obj.set('scaleY', v / (obj.height || 1));
    }
    obj.setCoords();
    fabricRef.current?.renderAll();
    bump();
  }, [bump]);

  /* ═══════════════════════════════════════════════
   *  Add Objects
   * ═══════════════════════════════════════════════ */
  const addText = useCallback((preset?: 'heading' | 'subheading' | 'body') => {
    const c = fabricRef.current;
    if (!c) return;
    const size = preset === 'heading' ? 64 : preset === 'subheading' ? 42 : 24;
    const weight = preset === 'heading' || preset === 'subheading' ? 'bold' : 'normal';
    const content = preset === 'heading' ? 'Add a heading' :
                    preset === 'subheading' ? 'Add a subheading' :
                    'Add body text';
    const text = new Textbox(content, {
      left: canvasW / 2 - 200,
      top: canvasH / 2 - size,
      width: 400,
      fontSize: size,
      fontFamily: 'Inter',
      fontWeight: weight,
      fill: '#1F2937',
      textAlign: 'center',
      editable: true,
    });
    (text as any).customData = { id: `text_${Date.now()}` };
    c.add(text);
    c.setActiveObject(text);
    c.renderAll();
    setActiveTool('select');
    bump();
    toast.success('Text added — double-click to edit');
  }, [canvasW, canvasH, bump]);

  const addShape = useCallback((kind: ShapeKind) => {
    const c = fabricRef.current;
    if (!c) return;
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    let obj: FabricObject;

    switch (kind) {
      case 'rect':
        obj = new Rect({
          left: cx - 100, top: cy - 75, width: 200, height: 150,
          fill: '#3B82F6', stroke: '#1D4ED8', strokeWidth: 2, rx: 8, ry: 8,
        });
        (obj as any).customData = { id: `rect_${Date.now()}` };
        break;
      case 'circle':
        obj = new Circle({
          left: cx - 80, top: cy - 80, radius: 80,
          fill: '#8B5CF6', stroke: '#7C3AED', strokeWidth: 2,
        });
        (obj as any).customData = { id: `circle_${Date.now()}` };
        break;
      case 'triangle':
        obj = new Triangle({
          left: cx - 80, top: cy - 70, width: 160, height: 140,
          fill: '#F59E0B', stroke: '#D97706', strokeWidth: 2,
        });
        (obj as any).customData = { id: `tri_${Date.now()}` };
        break;
      case 'line':
        obj = new Line([cx - 150, cy, cx + 150, cy], {
          stroke: '#374151', strokeWidth: 3,
        });
        (obj as any).customData = { id: `line_${Date.now()}` };
        break;
      case 'star': {
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 80 : 35;
          const a = (Math.PI / 5) * i - Math.PI / 2;
          pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        obj = new Polygon(pts, {
          fill: '#F59E0B', stroke: '#D97706', strokeWidth: 2,
        });
        (obj as any).customData = { id: `star_${Date.now()}` };
        break;
      }
      case 'heart': {
        // Heart via polygon approximation
        const hPts: { x: number; y: number }[] = [];
        for (let t = 0; t <= 2 * Math.PI; t += 0.05) {
          const x = 16 * Math.pow(Math.sin(t), 3);
          const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          hPts.push({ x: cx + x * 5, y: cy + y * 5 });
        }
        obj = new Polygon(hPts, {
          fill: '#EF4444', stroke: '#DC2626', strokeWidth: 2,
        });
        (obj as any).customData = { id: `heart_${Date.now()}` };
        break;
      }
      case 'polygon':
        // Hexagon
        {
          const hexPts: { x: number; y: number }[] = [];
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            hexPts.push({ x: cx + 80 * Math.cos(a), y: cy + 80 * Math.sin(a) });
          }
          obj = new Polygon(hexPts, {
            fill: '#14B8A6', stroke: '#0D9488', strokeWidth: 2,
          });
          (obj as any).customData = { id: `hex_${Date.now()}` };
        }
        break;
      default:
        return;
    }
    c.add(obj);
    c.setActiveObject(obj);
    c.renderAll();
    setActiveTool('select');
    bump();
    toast.success(`${kind} added`);
  }, [canvasW, canvasH, bump]);

  const handleAddImageOverlay = useCallback(() => {
    overlayInputRef.current?.click();
  }, []);

  const handleOverlayFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const c = fabricRef.current;
    if (!c) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      try {
        const img = await FabricImage.fromURL(dataUrl, { crossOrigin: 'anonymous' });
        // Scale to fit 50% of canvas width
        const maxW = canvasW * 0.5;
        if ((img.width || 100) > maxW) {
          img.scaleToWidth(maxW);
        }
        img.set({
          left: canvasW / 2 - ((img.width || 100) * (img.scaleX || 1)) / 2,
          top: canvasH / 2 - ((img.height || 100) * (img.scaleY || 1)) / 2,
        });
        (img as any).customData = { id: `img_${Date.now()}` };
        c.add(img);
        c.setActiveObject(img);
        c.renderAll();
        bump();
        toast.success('Image added');
      } catch {
        toast.error('Failed to load image');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [canvasW, canvasH, bump]);

  /* ═══════════════════════════════════════════════
   *  Object Actions
   * ═══════════════════════════════════════════════ */
  const deleteSelected = useCallback(() => {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    c.remove(obj);
    c.discardActiveObject();
    c.renderAll();
    bump();
    saveHistory();
    toast.success('Deleted');
  }, [bump, saveHistory]);

  const duplicateSelected = useCallback(() => {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c) return;
    obj.clone().then((cloned: FabricObject) => {
      cloned.set({
        left: (obj.left || 0) + 30,
        top: (obj.top || 0) + 30,
      });
      (cloned as any).customData = { id: `dup_${Date.now()}` };
      c.add(cloned);
      c.setActiveObject(cloned);
      c.renderAll();
      bump();
      saveHistory();
      toast.success('Duplicated');
    });
  }, [bump, saveHistory]);

  const bringForward = () => { const c = fabricRef.current; const o = c?.getActiveObject(); if (o && c) { c.bringObjectForward(o); c.renderAll(); } };
  const sendBackward = () => { const c = fabricRef.current; const o = c?.getActiveObject(); if (o && c) { c.sendObjectBackwards(o); c.renderAll(); } };
  const bringToFront = () => { const c = fabricRef.current; const o = c?.getActiveObject(); if (o && c) { c.bringObjectToFront(o); c.renderAll(); } };
  const sendToBack = () => { const c = fabricRef.current; const o = c?.getActiveObject(); if (o && c) { c.sendObjectToBack(o); c.renderAll(); } };

  const toggleLock = useCallback(() => {
    const obj = sel;
    if (!obj) return;
    const locked = !obj.lockMovementX;
    obj.set({
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      lockRotation: locked,
      hasControls: !locked,
      selectable: true,
      evented: true,
    });
    fabricRef.current?.renderAll();
    bump();
    toast.success(locked ? 'Layer locked' : 'Layer unlocked');
  }, [sel, bump]);

  /* ═══════════════════════════════════════════════
   *  Background Removal
   * ═══════════════════════════════════════════════ */
  const handleRemoveBG = useCallback(async () => {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c || obj.type !== 'image') return;
    const imgObj = obj as FabricImage;
    const src = imgObj.getSrc();
    if (!src) return;

    setBgRemovingId('active');
    try {
      const blob = await removeBackground(src);
      const url = URL.createObjectURL(blob);
      const newImg = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      newImg.set({
        left: imgObj.left,
        top: imgObj.top,
        scaleX: imgObj.scaleX,
        scaleY: imgObj.scaleY,
        angle: imgObj.angle,
        opacity: imgObj.opacity,
      });
      (newImg as any).customData = (imgObj as any).customData;
      c.remove(imgObj);
      c.add(newImg);
      c.setActiveObject(newImg);
      c.renderAll();
      bump();
      saveHistory();
      toast.success('Background removed!');
    } catch (err) {
      toast.error('Background removal failed');
      console.error(err);
    } finally {
      setBgRemovingId(null);
    }
  }, [bump, saveHistory]);

  /* ═══════════════════════════════════════════════
   *  Grab Text (OCR & Layout Reconstruction)
   * ═══════════════════════════════════════════════ */
  const handleGrabText = useCallback(async () => {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!obj || !c || obj.type !== 'image') return;
    const imgObj = obj as FabricImage;

    const imgElement = imgObj.getElement() as HTMLImageElement;
    if (!imgElement) return;

    setGrabbingText(true);
    const toastId = toast.loading('Reconstructing text layers from image...');

    try {
      // 1. Draw image to temp canvas to retrieve pixel colors and bypass local protocol cross-origin policies
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imgElement.naturalWidth || imgElement.width;
      tempCanvas.height = imgElement.naturalHeight || imgElement.height;
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) throw new Error('Could not get 2d context');
      ctx.drawImage(imgElement, 0, 0);
      const dataUrl = tempCanvas.toDataURL('image/png');

      // 2. Dynamically import Tesseract.js
      const Tesseract = (await import('tesseract.js')).default;

      // 3. Run OCR
      const result = await Tesseract.recognize(dataUrl, 'eng');
      const { lines } = result.data as any;

      if (!lines || lines.length === 0) {
        toast.error('No text found in this image', { id: toastId });
        return;
      }

      let textCount = 0;

      lines.forEach((line: any) => {
        const textStr = line.text.trim();
        if (textStr.length < 2) return; // ignore random noise characters

        const { x0, y0, x1, y1 } = line.bbox;
        const w = x1 - x0;
        const h = y1 - y0;

        // Sample background color (average border pixels)
        const bgRgb = (() => {
          const samples = [
            ctx.getImageData(Math.max(0, x0 - 4), Math.max(0, y0 - 4), 1, 1).data,
            ctx.getImageData(Math.min(tempCanvas.width - 1, x1 + 4), Math.max(0, y0 - 4), 1, 1).data,
            ctx.getImageData(Math.max(0, x0 - 4), Math.min(tempCanvas.height - 1, y1 + 4), 1, 1).data,
            ctx.getImageData(Math.min(tempCanvas.width - 1, x1 + 4), Math.min(tempCanvas.height - 1, y1 + 4), 1, 1).data,
          ];
          let r = 0, g = 0, b = 0;
          samples.forEach((s) => { r += s[0]; g += s[1]; b += s[2]; });
          return `rgb(${Math.round(r / samples.length)}, ${Math.round(g / samples.length)}, ${Math.round(b / samples.length)})`;
        })();

        // Sample text color (find the sampled pixel with max distance from background)
        const textColor = (() => {
          const match = bgRgb.match(/\d+/g);
          const bgR = match ? parseInt(match[0]) : 255;
          const bgG = match ? parseInt(match[1]) : 255;
          const bgB = match ? parseInt(match[2]) : 255;

          let maxDist = -1;
          let bestColor = 'rgb(0,0,0)';
          const stepX = w / 6;
          const stepY = h / 6;
          for (let i = 1; i <= 5; i++) {
            for (let j = 1; j <= 5; j++) {
              const px = Math.round(x0 + i * stepX);
              const py = Math.round(y0 + j * stepY);
              const imgData = ctx.getImageData(px, py, 1, 1).data;
              const r = imgData[0], g = imgData[1], b = imgData[2];
              const dist = Math.sqrt(Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2));
              if (dist > maxDist) {
                maxDist = dist;
                bestColor = `rgb(${r},${g},${b})`;
              }
            }
          }
          return bestColor;
        })();

        // 4. Overwrite text in image with the background color (Canva-like inpainting)
        ctx.fillStyle = bgRgb;
        ctx.fillRect(Math.max(0, x0 - 2), Math.max(0, y0 - 2), w + 4, h + 4);

        // 5. Create active editable Textbox object
        const textObj = new Textbox(textStr, {
          left: imgObj.left + x0 * imgObj.scaleX,
          top: imgObj.top + y0 * imgObj.scaleY,
          width: w * imgObj.scaleX + 25,
          fontSize: h * imgObj.scaleY * 0.85,
          fontFamily: 'Inter',
          fill: textColor,
          textAlign: 'left',
          editable: true,
        });
        (textObj as any).customData = { id: `text_${Date.now()}_${Math.random()}` };
        c.add(textObj);
        textCount++;
      });

      // 6. Update background image source to reflect covered texts
      const erasedDataUrl = tempCanvas.toDataURL('image/png');
      const newImgEl = new Image();
      newImgEl.onload = () => {
        imgObj.setElement(newImgEl);
        c.renderAll();
        saveHistory();
        bump();
      };
      newImgEl.src = erasedDataUrl;

      toast.success(`Converted ${textCount} text elements into editable text layers!`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error('Failed to grab text from image', { id: toastId });
    } finally {
      setGrabbingText(false);
    }
  }, [bump, saveHistory]);

  /* ═══════════════════════════════════════════════
   *  Canvas Resize
   * ═══════════════════════════════════════════════ */
  const handleResizeCanvas = useCallback((w: number, h: number) => {
    if (w < 50 || h < 50) return;
    const c = fabricRef.current;
    if (!c) return;
    setCanvasW(w);
    setCanvasH(h);
    setCustomW(w);
    setCustomH(h);
    c.setDimensions({ width: w * zoom, height: h * zoom });
    c.renderAll();
    toast.success(`Canvas: ${w}×${h}`);
  }, [zoom]);

  /* ═══════════════════════════════════════════════
   *  Export
   * ═══════════════════════════════════════════════ */
  const handleExport = useCallback(async () => {
    const c = fabricRef.current;
    if (!c) return;
    setExporting(true);

    try {
      // Deselect, render at full res
      c.discardActiveObject();
      const prevZoom = zoom;
      c.setZoom(1);
      c.setDimensions({ width: canvasW, height: canvasH });
      c.renderAll();

      let dataUrl: string;
      if (exportFormat === 'PDF') {
        dataUrl = c.toDataURL({ format: 'png', multiplier: 1 });
      } else {
        dataUrl = c.toDataURL({
          format: exportFormat.toLowerCase() as 'png' | 'jpeg',
          quality: exportQuality / 100,
          multiplier: 1,
        });
      }

      // Restore zoom
      c.setZoom(prevZoom);
      c.setDimensions({ width: canvasW * prevZoom, height: canvasH * prevZoom });
      c.renderAll();

      if (exportFormat === 'PDF') {
        // Build PDF
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([canvasW * 0.24, canvasH * 0.24]);
        const pngBytes = new Uint8Array(atob(dataUrl.split(',')[1]).split('').map(c => c.charCodeAt(0)));
        const pngImage = await pdfDoc.embedPng(pngBytes);
        page.drawImage(pngImage, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
        const pdfDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        const base64 = pdfDataUrl.split(',')[1];
        const result = await (window as any).electron.saveTempOutput(base64, `${filename}.pdf`);
        if (result.success) {
          const stats = await (window as any).electron.validateFile(result.data);
          useAppStore.getState().updateOutputOptions({ filename: filename, format: OutputFormat.PDF });
          useAppStore.getState().setProcessingStatus({
            step: 'complete' as any,
            progress: 100,
            totalFiles: 1,
            processedFiles: 1,
            outputPath: result.data,
            outputSize: stats.size,
          } as any);
          setView(AppView.SUCCESS);
          toast.success('PDF exported');
        }
      } else {
        const base64 = dataUrl.split(',')[1];
        const ext = exportFormat.toLowerCase();
        const result = await (window as any).electron.saveTempOutput(base64, `${filename}.${ext}`);
        if (result.success) {
          const stats = await (window as any).electron.validateFile(result.data);
          useAppStore.getState().updateOutputOptions({
            filename: filename,
            format: exportFormat === 'JPEG' ? OutputFormat.JPEG : OutputFormat.PNG,
          });
          useAppStore.getState().setProcessingStatus({
            step: 'complete' as any,
            progress: 100,
            totalFiles: 1,
            processedFiles: 1,
            outputPath: result.data,
            outputSize: stats.size,
          } as any);
          setView(AppView.SUCCESS);
          toast.success(`${exportFormat} exported`);
        }
      }
    } catch (err) {
      console.error('Export error:', err);
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }, [canvasW, canvasH, zoom, exportFormat, exportQuality, filename, setView]);

  /* ═══════════════════════════════════════════════
   *  Keyboard Shortcuts
   * ═══════════════════════════════════════════════ */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'z') { handleUndo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'y') { handleRedo(); e.preventDefault(); }
      if (e.ctrlKey && e.key === 'd') { e.preventDefault(); duplicateSelected(); }
      if (e.ctrlKey && e.key === 'c') {
        const obj = fabricRef.current?.getActiveObject();
        if (obj) { clipboardRef.current = obj; toast.success('Copied'); }
      }
      if (e.ctrlKey && e.key === 'v') {
        const clip = clipboardRef.current;
        if (clip) {
          clip.clone().then((cloned: FabricObject) => {
            cloned.set({ left: (clip.left || 0) + 30, top: (clip.top || 0) + 30 });
            fabricRef.current?.add(cloned);
            fabricRef.current?.setActiveObject(cloned);
            fabricRef.current?.renderAll();
            bump();
            saveHistory();
          });
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteSelected, handleUndo, handleRedo, duplicateSelected, bump, saveHistory]);

  /* ═══════════════════════════════════════════════
   *  File Upload Handlers
   * ═══════════════════════════════════════════════ */
  const handleFilesDropped = (files: File[]) => {
    const imgFile = files.find((f) => f.type.startsWith('image/'));
    if (!imgFile) return;
    loadImageFile(imgFile);
  };

  const handleBrowseImage = () => fileInputRef.current?.click();

  const handleUploadNew = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImageFile(file);
    e.target.value = '';
  };

  const loadImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        setCanvasW(img.naturalWidth);
        setCanvasH(img.naturalHeight);
        setCustomW(img.naturalWidth);
        setCustomH(img.naturalHeight);
        const vw = (viewportRef.current?.clientWidth || 900) - 80;
        const vh = (viewportRef.current?.clientHeight || 600) - 80;
        const fitZoom = Math.min(vw / img.naturalWidth, vh / img.naturalHeight, 1);
        setZoom(fitZoom);
        setSourceLoaded(true);

        setTimeout(() => {
          const c = fabricRef.current;
          if (!c) return;
          c.setDimensions({ width: img.naturalWidth * fitZoom, height: img.naturalHeight * fitZoom });
          c.setZoom(fitZoom);
          c.set('backgroundColor', '#ffffff');

          const fabricImg = new FabricImage(img, {
            left: 0, top: 0,
            selectable: true, evented: true, hasControls: true,
          });
          (fabricImg as any).customData = { isBackground: true, id: 'bg_image' };
          fabricImg.scaleToWidth(img.naturalWidth);
          c.add(fabricImg);
          c.sendObjectToBack(fabricImg);
          c.renderAll();
          saveHistory();
        }, 200);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Helper to get effective dimensions
  const getEffW = (o: FabricObject) => Math.round((o.width || 0) * (o.scaleX || 1));
  const getEffH = (o: FabricObject) => Math.round((o.height || 0) * (o.scaleY || 1));

  /* ═══════════════════════════════════════════════
   *  RENDER: Upload Screen
   * ═══════════════════════════════════════════════ */
  if (!sourceLoaded) {
    return (
      <div className="h-full flex flex-col bg-bg-base text-text-primary">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-bg-surface shrink-0">
          <button onClick={() => setView(AppView.HOME)} className="p-2 hover:bg-bg-sunken rounded-md transition-fast text-text-secondary hover:text-text-primary">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold">Image Editor</h1>
            <p className="text-xs text-text-muted">Professional canvas-based image editor</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-xl text-center space-y-6">
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl flex items-center justify-center shadow-lg transform hover:scale-105 transition-slow">
              <Smile size={44} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Canvas Image Editor</h2>
              <p className="text-text-secondary mt-2">
                Drop your image to start editing. Add text, shapes, images &mdash; every element is independently selectable, resizable, and editable.
              </p>
            </div>
            <DragDropZone onFilesDropped={handleFilesDropped} disabled={false} />
            <div className="flex justify-center gap-3">
              <Button variant="secondary" size="lg" onClick={handleBrowseImage}>
                <FolderOpen size={20} /> Browse Image
              </Button>
            </div>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadNew} />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
   *  Left Tool Sidebar Items
   * ═══════════════════════════════════════════════ */
  const toolItems: { id: ToolType; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <MousePointer2 size={18} />, label: 'Select' },
    { id: 'text', icon: <Type size={18} />, label: 'Text' },
    { id: 'shapes', icon: <Square size={18} />, label: 'Shapes' },
    { id: 'draw', icon: <Pencil size={18} />, label: 'Draw' },
    { id: 'background', icon: <Palette size={18} />, label: 'BG' },
    { id: 'resize', icon: <Maximize2 size={18} />, label: 'Resize' },
  ];

  /* ═══════════════════════════════════════════════
   *  RENDER: Editor
   * ═══════════════════════════════════════════════ */
  return (
    <div className="h-full flex flex-col bg-bg-base select-none overflow-hidden" style={{ minHeight: 0 }}>
      {/* ─── Top Toolbar ─── */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#1A1A1D] text-white border-b border-[#2D2D30] shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => setView(AppView.HOME)} className="p-2 hover:bg-[#2D2D30] rounded-md transition-fast text-gray-400 hover:text-white" title="Exit Editor">
            <ArrowLeft size={18} />
          </button>
          <div className="h-4 w-px bg-gray-700" />
          <div>
            <h2 className="text-sm font-bold truncate max-w-[200px]">{filename}</h2>
            <p className="text-[10px] text-gray-400 font-mono">{canvasW}×{canvasH} px</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={handleUndo} className="p-1.5 hover:bg-[#2D2D30] rounded text-gray-400 hover:text-white disabled:opacity-20" title="Undo (Ctrl+Z)">
            <Undo2 size={15} />
          </button>
          <button onClick={handleRedo} className="p-1.5 hover:bg-[#2D2D30] rounded text-gray-400 hover:text-white disabled:opacity-20" title="Redo (Ctrl+Y)">
            <Redo2 size={15} />
          </button>
          <div className="h-4 w-px bg-gray-700 mx-1" />
          <button onClick={zoomOut} className="p-1.5 hover:bg-[#2D2D30] rounded text-gray-400 hover:text-white">
            <ZoomOut size={15} />
          </button>
          <span className="text-xs font-mono w-12 text-center text-gray-300">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} className="p-1.5 hover:bg-[#2D2D30] rounded text-gray-400 hover:text-white">
            <ZoomIn size={15} />
          </button>
          <button onClick={zoomFit} className="p-1.5 hover:bg-[#2D2D30] rounded text-gray-400 hover:text-white" title="Fit to Screen">
            <Maximize2 size={15} />
          </button>
        </div>
      </div>

      {/* ─── Body: Left + Canvas + Right ─── */}
      <div className="flex flex-1 overflow-hidden relative" style={{ minHeight: 0 }}>
        {/* Left Tool Strip */}
        <div className="w-16 bg-[#18181B] text-gray-400 border-r border-[#27272A] flex flex-col items-center py-4 gap-1.5 shrink-0">
          {toolItems.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              className={`w-12 h-12 flex flex-col items-center justify-center rounded-lg transition-fast ${
                activeTool === t.id ? 'bg-accent text-white shadow-md shadow-accent/20' : 'hover:bg-[#27272A] hover:text-white'
              }`}
              title={t.label}
            >
              {t.icon}
              <span className="text-[9px] mt-1 font-medium leading-none">{t.label}</span>
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={handleAddImageOverlay} className="w-12 h-12 flex flex-col items-center justify-center rounded-lg hover:bg-[#27272A] hover:text-white text-emerald-400" title="Add Image Overlay">
            <ImagePlus size={18} />
            <span className="text-[9px] mt-1 font-medium leading-none">Image</span>
          </button>
        </div>

        {/* Center Canvas Viewport */}
        <div
          ref={viewportRef}
          className="flex-1 bg-[#121214] overflow-auto flex items-center justify-center relative p-8"
          style={{ minHeight: 0 }}
          onClick={(e) => {
            if (e.target === viewportRef.current) {
              fabricRef.current?.discardActiveObject();
              fabricRef.current?.renderAll();
              bump();
            }
          }}
        >
          <div className="relative shadow-2xl" style={{ flexShrink: 0 }}>
            <canvas ref={canvasElRef} />
          </div>
        </div>

        {/* Right Properties Panel */}
        <div className="w-80 border-l border-border bg-bg-surface overflow-y-auto shrink-0 flex flex-col">
          <div className="p-4 flex-1 space-y-5">

            {/* ─── SELECTED OBJECT PROPERTIES ─── */}
            {sel ? (
              <div className="space-y-4 animate-fade-in-up">
                {/* Type badge + Actions */}
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 bg-accent/15 text-accent text-[10px] font-bold uppercase rounded-full tracking-wider">
                    {sel.type === 'textbox' ? 'Text' : sel.type === 'image' ? 'Image' : sel.type || 'Object'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={duplicateSelected} className="p-1.5 hover:bg-accent/10 text-accent rounded transition-fast" title="Duplicate (Ctrl+D)">
                      <Copy size={14} />
                    </button>
                    <button onClick={toggleLock} className={`p-1.5 rounded transition-fast ${sel.lockMovementX ? 'bg-amber-500/20 text-amber-500' : 'hover:bg-bg-sunken text-text-muted'}`} title="Lock/Unlock">
                      {sel.lockMovementX ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                    <button onClick={deleteSelected} className="p-1.5 hover:bg-red-500/10 text-red-400 rounded transition-fast" title="Delete (Del)">
                      <Trash size={14} />
                    </button>
                  </div>
                </div>

                {/* ─── Transform ─── */}
                <div className="bg-bg-sunken rounded-lg p-3 space-y-2.5">
                  <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5">
                    <Move size={11} /> Transform
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-text-muted mb-0.5 block">X</label>
                      <input type="number" value={Math.round(sel.left || 0)} onChange={(e) => updateProp('left', Number(e.target.value))}
                        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary outline-none focus:border-accent font-mono" />
                    </div>
                    <div>
                      <label className="text-[10px] text-text-muted mb-0.5 block">Y</label>
                      <input type="number" value={Math.round(sel.top || 0)} onChange={(e) => updateProp('top', Number(e.target.value))}
                        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary outline-none focus:border-accent font-mono" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-text-muted mb-0.5 block">W</label>
                      <input type="number" value={getEffW(sel)} onChange={(e) => updateScale('w', Number(e.target.value))}
                        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary outline-none focus:border-accent font-mono" />
                    </div>
                    <div>
                      <label className="text-[10px] text-text-muted mb-0.5 block">H</label>
                      <input type="number" value={getEffH(sel)} onChange={(e) => updateScale('h', Number(e.target.value))}
                        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary outline-none focus:border-accent font-mono" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-text-muted mb-0.5 block flex items-center gap-1"><RotateCw size={10} /> Angle</label>
                      <input type="number" value={Math.round(sel.angle || 0)} onChange={(e) => updateProp('angle', Number(e.target.value) % 360)}
                        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary outline-none focus:border-accent font-mono" />
                    </div>
                    <div>
                      <label className="text-[10px] text-text-muted mb-0.5 block">Opacity</label>
                      <input type="number" min={0} max={100} value={Math.round((sel.opacity ?? 1) * 100)} onChange={(e) => updateProp('opacity', Math.min(1, Math.max(0, Number(e.target.value) / 100)))}
                        className="w-full px-2 py-1 bg-bg-base border border-border rounded text-xs text-text-primary outline-none focus:border-accent font-mono" />
                    </div>
                  </div>
                  <input type="range" min={0} max={100} value={Math.round((sel.opacity ?? 1) * 100)} onChange={(e) => updateProp('opacity', Number(e.target.value) / 100)} className="w-full accent-accent h-1" />
                </div>

                {/* Depth */}
                <div>
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest block mb-1.5 flex items-center gap-1.5"><Layers size={11} /> Layer Order</label>
                  <div className="grid grid-cols-4 gap-1">
                    <button onClick={bringToFront} className="p-1.5 bg-bg-sunken hover:bg-bg-base border border-border rounded text-[10px] font-semibold transition-fast">Front</button>
                    <button onClick={bringForward} className="p-1.5 bg-bg-sunken hover:bg-bg-base border border-border rounded text-[10px] font-semibold transition-fast">Up</button>
                    <button onClick={sendBackward} className="p-1.5 bg-bg-sunken hover:bg-bg-base border border-border rounded text-[10px] font-semibold transition-fast">Down</button>
                    <button onClick={sendToBack} className="p-1.5 bg-bg-sunken hover:bg-bg-base border border-border rounded text-[10px] font-semibold transition-fast">Back</button>
                  </div>
                </div>

                {/* ─── TEXT Properties ─── */}
                {(sel.type === 'textbox' || sel.type === 'i-text') && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5"><Type size={11} /> Text</h4>
                    {/* Font Family */}
                    <div>
                      <label className="text-[10px] text-text-muted mb-1 block">Font Family</label>
                      <select value={sel.fontFamily || 'Inter'} onChange={(e) => updateProp('fontFamily', e.target.value)}
                        className="w-full px-2 py-1.5 bg-bg-sunken border border-border rounded-md text-xs text-text-primary outline-none focus:border-accent"
                        style={{ fontFamily: sel.fontFamily || 'Inter' }}>
                        {FONT_OPTIONS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                      </select>
                    </div>
                    {/* Font Size */}
                    <div>
                      <label className="text-[10px] text-text-muted mb-1 block flex justify-between">
                        <span>Font Size</span><span className="font-mono text-text-primary">{sel.fontSize || 24}px</span>
                      </label>
                      <input type="range" min={8} max={240} value={sel.fontSize || 24} onChange={(e) => updateProp('fontSize', Number(e.target.value))} className="w-full accent-accent" />
                    </div>
                    {/* Letter Spacing */}
                    <div>
                      <label className="text-[10px] text-text-muted mb-1 block flex justify-between">
                        <span>Letter Spacing</span><span className="font-mono text-text-primary">{sel.charSpacing || 0}</span>
                      </label>
                      <input type="range" min={-200} max={1000} value={sel.charSpacing || 0} onChange={(e) => updateProp('charSpacing', Number(e.target.value))} className="w-full accent-accent" />
                    </div>
                    {/* Line Height */}
                    <div>
                      <label className="text-[10px] text-text-muted mb-1 block flex justify-between">
                        <span>Line Height</span><span className="font-mono text-text-primary">{(sel.lineHeight || 1.16).toFixed(2)}</span>
                      </label>
                      <input type="range" min={50} max={300} value={Math.round((sel.lineHeight || 1.16) * 100)} onChange={(e) => updateProp('lineHeight', Number(e.target.value) / 100)} className="w-full accent-accent" />
                    </div>
                    {/* Style toggles */}
                    <div>
                      <label className="text-[10px] text-text-muted mb-1.5 block">Style & Alignment</label>
                      <div className="flex gap-1 flex-wrap">
                        {(['left', 'center', 'right'] as const).map((a) => (
                          <button key={a} onClick={() => updateProp('textAlign', a)}
                            className={`p-2 rounded border transition-fast ${sel.textAlign === a ? 'bg-accent text-white border-accent' : 'bg-bg-sunken border-border hover:bg-bg-base'}`}>
                            {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
                          </button>
                        ))}
                        <div className="w-px bg-border mx-0.5" />
                        <button onClick={() => updateProp('fontWeight', sel.fontWeight === 'bold' ? 'normal' : 'bold')}
                          className={`p-2 rounded border transition-fast ${sel.fontWeight === 'bold' ? 'bg-accent text-white border-accent' : 'bg-bg-sunken border-border hover:bg-bg-base'}`}><Bold size={14} /></button>
                        <button onClick={() => updateProp('fontStyle', sel.fontStyle === 'italic' ? 'normal' : 'italic')}
                          className={`p-2 rounded border transition-fast ${sel.fontStyle === 'italic' ? 'bg-accent text-white border-accent' : 'bg-bg-sunken border-border hover:bg-bg-base'}`}><Italic size={14} /></button>
                        <button onClick={() => updateProp('underline', !sel.underline)}
                          className={`p-2 rounded border transition-fast ${sel.underline ? 'bg-accent text-white border-accent' : 'bg-bg-sunken border-border hover:bg-bg-base'}`}><Underline size={14} /></button>
                      </div>
                    </div>
                    {/* Text Color */}
                    <div>
                      <label className="text-[10px] text-text-muted mb-1.5 block">Text Color</label>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {PRESET_COLORS.map((c) => (
                          <button key={c} onClick={() => updateProp('fill', c)}
                            className={`w-5 h-5 rounded-full border transition-fast ${String(sel.fill) === c ? 'border-accent scale-125 ring-1 ring-accent' : 'border-border/50 hover:scale-110'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <input type="color" value={String(sel.fill || '#000000')} onChange={(e) => updateProp('fill', e.target.value)}
                        className="w-full h-7 rounded border border-border cursor-pointer bg-transparent" />
                    </div>
                  </div>
                )}

                {/* ─── SHAPE Properties ─── */}
                {(sel.type === 'rect' || sel.type === 'circle' || sel.type === 'triangle' || sel.type === 'polygon' || sel.type === 'line') && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5"><Square size={11} /> Shape</h4>
                    {/* Fill Color */}
                    {sel.type !== 'line' && (
                      <div>
                        <label className="text-[10px] text-text-muted mb-1.5 block">Fill Color</label>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {PRESET_COLORS.map((c) => (
                            <button key={c} onClick={() => updateProp('fill', c)}
                              className={`w-5 h-5 rounded-full border transition-fast ${String(sel.fill) === c ? 'border-accent scale-125 ring-1 ring-accent' : 'border-border/50 hover:scale-110'}`}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input type="color" value={String(sel.fill || '#3B82F6')} onChange={(e) => updateProp('fill', e.target.value)}
                            className="flex-1 h-7 rounded border border-border cursor-pointer bg-transparent" />
                          <button onClick={() => updateProp('fill', 'transparent')}
                            className="px-2.5 py-1 bg-bg-sunken border border-border rounded text-[10px] font-semibold text-text-muted hover:bg-bg-base transition-fast">No Fill</button>
                        </div>
                      </div>
                    )}
                    {/* Stroke Color */}
                    <div>
                      <label className="text-[10px] text-text-muted mb-1.5 block">Border Color</label>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {PRESET_COLORS.slice(0, 12).map((c) => (
                          <button key={c} onClick={() => updateProp('stroke', c)}
                            className={`w-5 h-5 rounded-full border transition-fast ${String(sel.stroke) === c ? 'border-accent scale-125 ring-1 ring-accent' : 'border-border/50 hover:scale-110'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <input type="color" value={String(sel.stroke || '#000000')} onChange={(e) => updateProp('stroke', e.target.value)}
                        className="w-full h-7 rounded border border-border cursor-pointer bg-transparent" />
                    </div>
                    {/* Stroke Width */}
                    <div>
                      <label className="text-[10px] text-text-muted mb-1 block flex justify-between">
                        <span>Border Width</span><span className="font-mono text-text-primary">{sel.strokeWidth || 0}px</span>
                      </label>
                      <input type="range" min={0} max={20} value={sel.strokeWidth || 0} onChange={(e) => updateProp('strokeWidth', Number(e.target.value))} className="w-full accent-accent" />
                    </div>
                    {/* Corner Radius for Rect */}
                    {sel.type === 'rect' && (
                      <div>
                        <label className="text-[10px] text-text-muted mb-1 block flex justify-between">
                          <span>Corner Radius</span><span className="font-mono text-text-primary">{sel.rx || 0}px</span>
                        </label>
                        <input type="range" min={0} max={100} value={sel.rx || 0} onChange={(e) => { updateProp('rx', Number(e.target.value)); updateProp('ry', Number(e.target.value)); }} className="w-full accent-accent" />
                      </div>
                    )}
                  </div>
                )}

                {/* ─── IMAGE Properties ─── */}
                {sel.type === 'image' && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1.5"><ImagePlus size={11} /> Image</h4>
                    {/* Flip */}
                    <div className="flex gap-1.5">
                      <button onClick={() => updateProp('flipX', !sel.flipX)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs font-semibold transition-fast ${sel.flipX ? 'bg-accent/15 border-accent text-accent' : 'bg-bg-sunken border-border hover:bg-bg-base text-text-secondary'}`}>
                        <FlipHorizontal size={13} /> Flip H
                      </button>
                      <button onClick={() => updateProp('flipY', !sel.flipY)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs font-semibold transition-fast ${sel.flipY ? 'bg-accent/15 border-accent text-accent' : 'bg-bg-sunken border-border hover:bg-bg-base text-text-secondary'}`}>
                        <FlipVertical size={13} /> Flip V
                      </button>
                    </div>
                    {/* Remove BG */}
                    <button onClick={handleRemoveBG} disabled={!!bgRemovingId}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700 rounded-md text-xs font-semibold shadow-md disabled:opacity-50 transition-fast">
                      {bgRemovingId ? <><Loader2 size={14} className="animate-spin" /> Removing BG...</> : <><Wand2 size={14} /> Remove Background (AI)</>}
                    </button>
                    {/* Grab Text (OCR) */}
                    <button onClick={handleGrabText} disabled={grabbingText}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-semibold shadow-md disabled:opacity-50 transition-fast">
                      {grabbingText ? <><Loader2 size={14} className="animate-spin" /> Grabbing Text...</> : <><Type size={14} /> Grab Text (Canva style OCR)</>}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* ─── NO SELECTION: Show tool panels ─── */
              <div className="animate-fade-in-up">
                {/* Text Tool Panel */}
                {activeTool === 'text' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-text-primary">Add Text</h3>
                    <button onClick={() => addText('heading')} className="w-full text-left px-4 py-3 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg transition-fast">
                      <p className="text-xl font-bold text-text-primary">Add a heading</p>
                    </button>
                    <button onClick={() => addText('subheading')} className="w-full text-left px-4 py-3 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg transition-fast">
                      <p className="text-base font-semibold text-text-primary">Add a subheading</p>
                    </button>
                    <button onClick={() => addText('body')} className="w-full text-left px-4 py-3 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg transition-fast">
                      <p className="text-sm text-text-secondary">Add body text</p>
                    </button>
                    <p className="text-[10px] text-text-muted text-center mt-2">Double-click any text on canvas to edit it inline</p>
                  </div>
                )}

                {/* Shapes Panel */}
                {activeTool === 'shapes' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-text-primary">Add Shape</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { kind: 'rect' as ShapeKind, icon: <Square size={22} />, label: 'Rectangle' },
                        { kind: 'circle' as ShapeKind, icon: <CircleIcon size={22} />, label: 'Circle' },
                        { kind: 'triangle' as ShapeKind, icon: <TriangleIcon size={22} />, label: 'Triangle' },
                        { kind: 'line' as ShapeKind, icon: <Minus size={22} />, label: 'Line' },
                        { kind: 'star' as ShapeKind, icon: <Star size={22} />, label: 'Star' },
                        { kind: 'heart' as ShapeKind, icon: <Heart size={22} />, label: 'Heart' },
                        { kind: 'polygon' as ShapeKind, icon: <Hexagon size={22} />, label: 'Hexagon' },
                      ]).map((s) => (
                        <button key={s.kind} onClick={() => addShape(s.kind)}
                          className="p-3 bg-bg-sunken border border-border hover:bg-bg-base hover:scale-105 rounded-lg flex flex-col items-center justify-center text-text-secondary transition-fast text-[10px] font-semibold gap-1.5">
                          {s.icon}
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Draw Panel */}
                {activeTool === 'draw' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-text-primary">Free Draw</h3>
                    <div>
                      <label className="text-[10px] text-text-muted mb-1.5 block font-semibold">Brush Color</label>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {PRESET_COLORS.slice(0, 16).map((c) => (
                          <button key={c} onClick={() => setBrushColor(c)}
                            className={`w-6 h-6 rounded-full border-2 transition-fast ${brushColor === c ? 'border-accent scale-110 shadow-sm' : 'border-transparent hover:scale-105'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="w-full h-8 rounded border border-border cursor-pointer bg-transparent" />
                    </div>
                    <div>
                      <label className="text-[10px] text-text-muted mb-1 block font-semibold">Brush Size: {brushSize}px</label>
                      <input type="range" min={1} max={60} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full accent-accent" />
                    </div>
                  </div>
                )}

                {/* Background Panel */}
                {activeTool === 'background' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-text-primary">Canvas Background</h3>
                    <div>
                      <label className="text-[10px] text-text-muted mb-2 block font-semibold">Solid Colors</label>
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_COLORS.map((c) => (
                          <button key={c} onClick={() => { fabricRef.current?.set('backgroundColor', c); fabricRef.current?.renderAll(); }}
                            className="w-7 h-7 rounded border border-border transition-fast hover:scale-105"
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-text-muted mb-1 block font-semibold">Custom Color</label>
                      <input type="color" value={String(fabricRef.current?.backgroundColor || '#ffffff')} onChange={(e) => { fabricRef.current?.set('backgroundColor', e.target.value); fabricRef.current?.renderAll(); }}
                        className="w-full h-8 rounded border border-border cursor-pointer bg-transparent" />
                    </div>
                  </div>
                )}

                {/* Resize Panel */}
                {activeTool === 'resize' && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-text-primary">Canvas Size</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-text-muted mb-0.5 block">Width (px)</label>
                        <input type="number" value={customW} onChange={(e) => setCustomW(Number(e.target.value))}
                          className="w-full px-2 py-1.5 bg-bg-sunken border border-border rounded text-xs font-mono text-text-primary outline-none focus:border-accent" />
                      </div>
                      <div>
                        <label className="text-[10px] text-text-muted mb-0.5 block">Height (px)</label>
                        <input type="number" value={customH} onChange={(e) => setCustomH(Number(e.target.value))}
                          className="w-full px-2 py-1.5 bg-bg-sunken border border-border rounded text-xs font-mono text-text-primary outline-none focus:border-accent" />
                      </div>
                    </div>
                    <button onClick={() => handleResizeCanvas(customW, customH)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white rounded-md text-xs font-semibold transition-fast">
                      <Maximize2 size={14} /> Apply Size
                    </button>
                    <div className="border-t border-border pt-4">
                      <label className="text-[10px] text-text-muted mb-2 block font-semibold">Quick Presets</label>
                      <div className="space-y-1.5">
                        {CANVAS_PRESETS.map((p) => (
                          <button key={p.name} onClick={() => { setCustomW(p.w); setCustomH(p.h); handleResizeCanvas(p.w, p.h); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 bg-bg-sunken hover:bg-bg-base border border-border rounded-lg transition-fast text-left">
                            <span className="text-base">{p.icon}</span>
                            <div className="flex-1">
                              <span className="text-xs font-semibold text-text-primary">{p.name}</span>
                              <span className="text-[10px] text-text-muted ml-2 font-mono">{p.w}×{p.h}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Default Select - No Selection */}
                {activeTool === 'select' && (
                  <div className="text-center py-8 text-text-secondary bg-bg-sunken rounded-lg">
                    <MousePointer2 className="mx-auto mb-2 opacity-35" size={24} />
                    <p className="text-xs font-semibold">No element selected</p>
                    <p className="text-[10px] text-text-muted mt-1">Click any element to edit it.<br />Double-click text to type inline.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── Export Footer ─── */}
          <div className="p-4 border-t border-border bg-bg-sunken space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider">Export</h4>
              <div className="flex bg-white rounded border border-border p-0.5">
                {(['PNG', 'JPEG', 'PDF'] as const).map((fmt) => (
                  <button key={fmt} onClick={() => setExportFormat(fmt)}
                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-fast ${exportFormat === fmt ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:bg-bg-sunken'}`}>
                    {fmt}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-text-muted mb-1 block">Filename</label>
              <input type="text" value={filename} onChange={(e) => setFilename(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-border rounded text-xs text-text-primary outline-none focus:border-accent" />
            </div>
            {exportFormat === 'JPEG' && (
              <div>
                <label className="text-[10px] text-text-muted mb-1 block flex justify-between"><span>Quality</span><span className="font-mono">{exportQuality}%</span></label>
                <input type="range" min={30} max={100} value={exportQuality} onChange={(e) => setExportQuality(Number(e.target.value))} className="w-full accent-accent" />
              </div>
            )}
            <button onClick={handleExport} disabled={exporting}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white rounded font-semibold text-sm shadow disabled:opacity-50 transition-fast">
              {exporting ? <><Loader2 size={15} className="animate-spin" /> Exporting...</> : <><Download size={15} /> Export</>}
            </button>
          </div>
        </div>
      </div>

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadNew} />
      <input ref={overlayInputRef} type="file" accept="image/*" className="hidden" onChange={handleOverlayFileChange} />
    </div>
  );
}
