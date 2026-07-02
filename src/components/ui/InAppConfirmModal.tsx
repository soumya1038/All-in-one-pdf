import { AlertCircle } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import Modal from './Modal';
import Button from './Button';

function InAppConfirmModal() {
  const confirmDialog = useAppStore((state) => state.confirmDialog);
  const closeConfirm = useAppStore((state) => state.closeConfirm);

  const isOpen = confirmDialog?.isOpen || false;
  const message = confirmDialog?.message || '';
  const title = confirmDialog?.title || 'Confirm Action';
  const confirmText = confirmDialog?.confirmText || 'Confirm';
  const cancelText = confirmDialog?.cancelText || 'Cancel';

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => closeConfirm(false)}
      title={title}
      size="sm"
      showCloseButton={true}
      closeOnBackdrop={false}
      footer={
        <div className="flex gap-3 justify-end w-full">
          <Button variant="secondary" onClick={() => closeConfirm(false)}>
            {cancelText}
          </Button>
          <Button variant="primary" onClick={() => closeConfirm(true)}>
            {confirmText}
          </Button>
        </div>
      }
    >
      <div className="flex gap-4 items-start py-2">
        <AlertCircle size={28} className="text-accent flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">
            {message}
          </p>
        </div>
      </div>
    </Modal>
  );
}

export default InAppConfirmModal;
