import { useState, useEffect } from 'react';
import { ScanLine, Settings, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { useAppStore } from '../../store/appStore';
import { ModalType, AppView } from '../../types/UI.types';
import { ScannerDevice, ScanColorMode, ScanPaperSize } from '../../types/Scanner.types';

function ScannerModal() {
  const modal = useAppStore((state) => state.ui.modal);
  const closeModal = useAppStore((state) => state.closeModal);
  const addDocuments = useAppStore((state) => state.addDocuments);
  const setView = useAppStore((state) => state.setView);
  const setActiveWorkflow = useAppStore((state) => state.setActiveWorkflow);

  const [isScanning, setIsScanning] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [scanners, setScanners] = useState<ScannerDevice[]>([]);
  const [selectedScanner, setSelectedScanner] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [resolution, setResolution] = useState<75 | 150 | 300 | 600>(300);
  const [colorMode, setColorMode] = useState<ScanColorMode>(ScanColorMode.COLOR);
  const [paperSize, setPaperSize] = useState<ScanPaperSize>(ScanPaperSize.A4);

  const isOpen = modal.type === ModalType.SCANNER;

  useEffect(() => {
    if (isOpen) {
      checkScanners();
    }
  }, [isOpen]);

  const checkScanners = async () => {
    setIsChecking(true);
    const result = await window.electron.listScanners();

    if (result.success) {
      setScanners(result.data);
      if (result.data.length > 0) {
        setSelectedScanner(result.data[0].id);
      }
    } else {
      toast.error(result.error.message);
    }

    setIsChecking(false);
  };

  const handleScan = async () => {
    if (!selectedScanner) return;

    setIsScanning(true);

    try {
      const result = await window.electron.scan(selectedScanner, {
        resolution,
        colorMode,
        paperSize,
      });

      if (result.success) {
        toast.success('Scan completed successfully');

        // Upload the scanned image so the main process validates and temp-copies it
        const uploadResult = await window.electron.uploadFiles([result.data.imagePath]);
        if (uploadResult.success && uploadResult.data.length > 0) {
          // Add to store and navigate to document list so user can choose workflow
          addDocuments(uploadResult.data);
          // Reset workflow so user picks what they want to do with the scanned page
          setActiveWorkflow(useAppStore.getState().ui.activeWorkflow); // keep current or NONE
          closeModal();
          setView(AppView.DOCUMENT_LIST);
        } else if (!uploadResult.success) {
          toast.error('Scan completed but could not import image: ' + uploadResult.error.message);
        } else {
          toast.error('Scan completed but no image was returned');
        }
      } else {
        toast.error(result.error.message);
      }
    } catch (error) {
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const renderContent = () => {
    if (isChecking) {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <Spinner size="lg" />
          <p className="text-text-secondary">Checking for scanners...</p>
        </div>
      );
    }

    if (scanners.length === 0) {
      return (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-16 h-16 rounded-full bg-error-light flex items-center justify-center">
            <AlertCircle size={32} className="text-error" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-text-primary mb-2">No Scanner Detected</h3>
            <p className="text-text-secondary mb-4">
              Make sure your scanner is connected and drivers are installed.
            </p>
            <Button variant="secondary" onClick={checkScanners}>
              Retry
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Scanner Selection */}
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            Select Scanner
          </label>
          <select
            value={selectedScanner || ''}
            onChange={(e) => setSelectedScanner(e.target.value)}
            className="w-full px-3 py-2 bg-bg-sunken border border-border rounded-sm focus:outline-none focus:ring-2 focus:ring-border-focus"
          >
            {scanners.map((scanner) => (
              <option key={scanner.id} value={scanner.id}>
                {scanner.name}
              </option>
            ))}
          </select>
        </div>

        {/* Settings Toggle */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-2 text-sm text-accent hover:underline"
        >
          <Settings size={16} />
          {showSettings ? 'Hide' : 'Show'} Settings
        </button>

        {/* Scanner Settings */}
        {showSettings && (
          <div className="space-y-4 p-4 bg-bg-sunken rounded-md">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Resolution
              </label>
              <select
                value={resolution}
                onChange={(e) => setResolution(parseInt(e.target.value) as 75 | 150 | 300 | 600)}
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm"
              >
                <option value={75}>75 DPI</option>
                <option value={150}>150 DPI</option>
                <option value={300}>300 DPI (Recommended)</option>
                <option value={600}>600 DPI</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Color Mode
              </label>
              <select
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as ScanColorMode)}
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm"
              >
                <option value={ScanColorMode.COLOR}>Color</option>
                <option value={ScanColorMode.GRAYSCALE}>Grayscale</option>
                <option value={ScanColorMode.BLACK_AND_WHITE}>Black & White</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Paper Size
              </label>
              <select
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as ScanPaperSize)}
                className="w-full px-3 py-2 bg-bg-surface border border-border rounded-sm"
              >
                <option value={ScanPaperSize.A4}>A4</option>
                <option value={ScanPaperSize.LETTER}>Letter</option>
                <option value={ScanPaperSize.LEGAL}>Legal</option>
                <option value={ScanPaperSize.AUTO}>Auto</option>
              </select>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="p-4 bg-accent-light rounded-md">
          <p className="text-sm text-text-secondary">
            📄 Place your document on the scanner bed and click Scan to begin.
          </p>
        </div>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title="Scan Document"
      size="md"
      closeOnBackdrop={!isScanning}
      footer={
        <>
          <Button variant="secondary" onClick={closeModal} disabled={isScanning}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleScan}
            disabled={isScanning || scanners.length === 0}
            isLoading={isScanning}
          >
            <ScanLine size={16} />
            {isScanning ? 'Scanning...' : 'Scan'}
          </Button>
        </>
      }
    >
      {renderContent()}
    </Modal>
  );
}

export default ScannerModal;
