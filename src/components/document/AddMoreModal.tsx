import { FilePlus, ScanLine } from 'lucide-react';
import { toast } from 'react-hot-toast';
import Modal from '../ui/Modal';
import { useAppStore } from '../../store/appStore';
import { ModalType, WorkflowType } from '../../types/UI.types';
import { useFileUpload } from '../../hooks/useFileUpload';

function AddMoreModal() {
  const modal = useAppStore((state) => state.ui.modal);
  const closeModal = useAppStore((state) => state.closeModal);
  const openModal = useAppStore((state) => state.openModal);
  const activeWorkflow = useAppStore((state) => state.ui.activeWorkflow);
  const { uploadFiles, isUploading } = useFileUpload();

  const isOpen = modal.type === ModalType.ADD_MORE;

  const handleUploadClick = async () => {
    try {
      let properties: ('openFile' | 'multiSelections')[] = ['openFile', 'multiSelections'];
      let extensions = ['pdf', 'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'tif', 'webp'];
      let name = 'PDF and Image Files';

      if (activeWorkflow === WorkflowType.COMPRESS || activeWorkflow === WorkflowType.SPLIT || activeWorkflow === WorkflowType.PROTECT) {
        properties = ['openFile'];
        extensions = ['pdf'];
        name = 'PDF Documents';
      } else if (activeWorkflow === WorkflowType.COMPRESS_IMAGE) {
        properties = ['openFile'];
        extensions = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp', 'bmp'];
        name = 'Image Files';
      } else if (activeWorkflow === WorkflowType.MERGE) {
        properties = ['openFile', 'multiSelections'];
        extensions = ['pdf'];
        name = 'PDF Documents';
      } else if (activeWorkflow === WorkflowType.CONVERT) {
        properties = ['openFile'];
        extensions = ['pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp'];
        name = 'Supported Files';
      }

      const result = await window.electron.showOpenDialog({
        properties,
        filters: [
          { name, extensions }
        ]
      });

      if (result.success && result.data && result.data.length > 0) {
        closeModal(); // Close Add More modal
        const filesToUpload = result.data.map(path => {
          const file = new File([], path.split(/[\\/]/).pop() || '');
          Object.defineProperty(file, 'path', { value: path });
          return file;
        });
        
        await uploadFiles(filesToUpload);
      }
    } catch (error) {
      console.error('Failed to open native dialog', error);
      toast.error('Failed to select files');
    }
  };

  const handleScanClick = () => {
    closeModal();
    // Brief delay to allow the first modal to unmount/close smoothly before opening the next
    setTimeout(() => {
      openModal(ModalType.SCANNER);
    }, 100);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title="Add Documents"
      size="md"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-2">
        {/* Upload Card */}
        <button
          onClick={handleUploadClick}
          disabled={isUploading}
          className="flex flex-col items-center justify-center p-6 bg-bg-surface hover:bg-bg-sunken border border-border hover:border-accent hover:shadow-lg rounded-xl transition-all duration-normal group text-center"
        >
          <div className="p-4 bg-accent/10 text-accent rounded-full mb-4 group-hover:scale-110 transition-all duration-normal">
            <FilePlus size={32} />
          </div>
          <h3 className="font-semibold text-text-primary text-lg group-hover:text-accent transition-fast">
            Upload Files
          </h3>
          <p className="text-sm text-text-secondary mt-2 max-w-[200px]">
            Add PDF or image files from your computer
          </p>
        </button>

        {/* Scan Card */}
        <button
          onClick={handleScanClick}
          className="flex flex-col items-center justify-center p-6 bg-bg-surface hover:bg-bg-sunken border border-border hover:border-accent hover:shadow-lg rounded-xl transition-all duration-normal group text-center"
        >
          <div className="p-4 bg-emerald-500/10 text-emerald-600 rounded-full mb-4 group-hover:scale-110 transition-all duration-normal">
            <ScanLine size={32} />
          </div>
          <h3 className="font-semibold text-text-primary text-lg group-hover:text-emerald-600 transition-fast">
            Scan Document
          </h3>
          <p className="text-sm text-text-secondary mt-2 max-w-[200px]">
            Use a connected scanner to scan documents directly
          </p>
        </button>
      </div>
    </Modal>
  );
}

export default AddMoreModal;
