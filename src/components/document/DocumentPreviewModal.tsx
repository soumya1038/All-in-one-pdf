import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store/appStore';
import { ModalType } from '../../types/UI.types';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { 
  Printer, Crop, ShieldAlert, Sparkles, 
  RotateCcw, Sliders, Check
} from 'lucide-react';
import { toast } from 'react-hot-toast';

enum EditTab {
  FILTERS = 'FILTERS',
  CROP = 'CROP',
}

interface CropBox {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  width: number; // percentage 0-100
  height: number; // percentage 0-100
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

  // Crop Box State
  const [cropBox, setCropBox] = useState<CropBox>({ x: 10, y: 10, width: 80, height: 80 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragType, setDragType] = useState<string | null>(null); // 'move' or handle 'tl', 'tr', 'bl', 'br'

  // Image load & setup
  useEffect(() => {
    if (isOpen && isEditing && doc) {
      const img = new Image();
      // Load through custom protocol
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
    setCropBox({ x: 10, y: 10, width: 80, height: 80 });
  };

  // Filter application
  const applyFilter = (filterType: 'grayscale' | 'binarize' | 'clean') => {
    const canvas = canvasRef.current;
    const img = originalImageRef.current;
    if (!canvas || !img) return;

    // Reset canvas to original first so filters don't stack destructively
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
        // Text Cleaning Filter (Contrast Stretch / Background Whitening)
        let newVal = gray;
        if (gray > 165) {
          newVal = 255; // Force light gray/dirty background to white
        } else if (gray < 85) {
          newVal = 0;   // Force dark gray text to clean black
        } else {
          // Stretch middle range
          newVal = ((gray - 85) / (165 - 85)) * 255;
        }
        data[i] = newVal;
        data[i + 1] = newVal;
        data[i + 2] = newVal;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    toast.success(`${filterType.toUpperCase()} filter applied`);
  };

  // Perform canvas cropping
  const executeCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Calculate pixel coordinates
    const sourceX = (cropBox.x / 100) * canvas.width;
    const sourceY = (cropBox.y / 100) * canvas.height;
    const sourceW = (cropBox.width / 100) * canvas.width;
    const sourceH = (cropBox.height / 100) * canvas.height;

    // Get cropped image data
    const croppedData = ctx.getImageData(sourceX, sourceY, sourceW, sourceH);

    // Resize canvas to cropped dimensions
    canvas.width = sourceW;
    canvas.height = sourceH;

    // Put cropped data back
    ctx.putImageData(croppedData, 0, 0);

    // Reset crop box selector
    setCropBox({ x: 5, y: 5, width: 90, height: 90 });
    toast.success('Image cropped');
  };

  // Save changes to backend
  const handleSaveEdit = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !documentId) return;

    setIsProcessing(true);

    try {
      // Export canvas to base64 jpeg
      const base64Data = canvas.toDataURL('image/jpeg', 0.9);
      
      const result = await window.electron.applyDocumentEdit(documentId, base64Data);

      if (result.success) {
        // Update document state in store
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

  // Crop Draggable / Resizable handlers
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

    setCropBox((prev) => {
      let { x, y, width, height } = { ...prev };

      if (dragType === 'move') {
        x = Math.max(0, Math.min(100 - width, x + deltaX));
        y = Math.max(0, Math.min(100 - height, y + deltaY));
      } else if (dragType === 'tl') {
        const newX = Math.max(0, Math.min(x + width - 10, x + deltaX));
        const newY = Math.max(0, Math.min(y + height - 10, y + deltaY));
        width = width + (x - newX);
        height = height + (y - newY);
        x = newX;
        y = newY;
      } else if (dragType === 'tr') {
        width = Math.max(10, Math.min(100 - x, width + deltaX));
        const newY = Math.max(0, Math.min(y + height - 10, y + deltaY));
        height = height + (y - newY);
        y = newY;
      } else if (dragType === 'bl') {
        const newX = Math.max(0, Math.min(x + width - 10, x + deltaX));
        width = width + (x - newX);
        x = newX;
        height = Math.max(10, Math.min(100 - y, height + deltaY));
      } else if (dragType === 'br') {
        width = Math.max(10, Math.min(100 - x, width + deltaX));
        height = Math.max(10, Math.min(100 - y, height + deltaY));
      }

      return { x, y, width, height };
    });

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
                // PDF native viewer iframe
                <iframe
                  src={`file:///${doc.tempPath.replace(/\\/g, '/')}`}
                  title={doc.filename}
                  className="w-full h-full min-h-[440px] border-none rounded-lg bg-white"
                />
              ) : (
                // Image View
                <img
                  src={`docuflow:///${doc.tempPath.replace(/\\/g, '/')}`}
                  alt={doc.filename}
                  className="max-w-full max-h-[460px] rounded-lg shadow-sm object-contain"
                />
              )
            ) : (
              // Edit Mode Canvas + Crop Overlay
              <div 
                ref={containerRef}
                className="relative max-w-full max-h-[460px] flex items-center justify-center"
              >
                <canvas 
                  ref={canvasRef} 
                  className="max-w-full max-h-[460px] object-contain rounded-lg shadow-md bg-white"
                />
                
                {/* Crop Box GUI Layer */}
                {activeTab === EditTab.CROP && (
                  <div
                    className="absolute border-2 border-accent bg-accent/10 cursor-move z-10"
                    style={{
                      left: `${cropBox.x}%`,
                      top: `${cropBox.y}%`,
                      width: `${cropBox.width}%`,
                      height: `${cropBox.height}%`,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'move')}
                  >
                    {/* Crop Handles */}
                    <div 
                      className="absolute -top-2 -left-2 w-4 h-4 bg-accent border-2 border-white rounded-full cursor-nwse-resize"
                      onMouseDown={(e) => handleMouseDown(e, 'tl')}
                    />
                    <div 
                      className="absolute -top-2 -right-2 w-4 h-4 bg-accent border-2 border-white rounded-full cursor-nesw-resize"
                      onMouseDown={(e) => handleMouseDown(e, 'tr')}
                    />
                    <div 
                      className="absolute -bottom-2 -left-2 w-4 h-4 bg-accent border-2 border-white rounded-full cursor-nesw-resize"
                      onMouseDown={(e) => handleMouseDown(e, 'bl')}
                    />
                    <div 
                      className="absolute -bottom-2 -right-2 w-4 h-4 bg-accent border-2 border-white rounded-full cursor-nwse-resize"
                      onMouseDown={(e) => handleMouseDown(e, 'br')}
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
                </div>

                {/* Tab Content */}
                <div className="flex-1 flex flex-col gap-3 justify-start">
                  {activeTab === EditTab.FILTERS ? (
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
                  ) : (
                    <div className="flex flex-col gap-3">
                      <span className="text-xs font-semibold text-text-muted uppercase">Crop Actions</span>
                      <p className="text-xs text-text-secondary">Drag the crop handles to choose your crop region, then apply below.</p>
                      
                      <Button 
                        variant="primary" 
                        className="w-full justify-center"
                        onClick={executeCrop}
                      >
                        <Check size={16} className="mr-2" />
                        Apply Crop Area
                      </Button>
                      <Button 
                        variant="ghost" 
                        className="w-full justify-center"
                        onClick={resetCanvas}
                      >
                        <RotateCcw size={16} className="mr-2" />
                        Reset Crop
                      </Button>
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
