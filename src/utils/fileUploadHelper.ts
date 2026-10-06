import { DocumentItem, DocumentType } from '../types/Document.types';
import { useAppStore } from '../store/appStore';

/**
 * Universally registers an uploaded file, path, or image data in the central app store.
 * Handles Native Files (with Electron .path), browser File blobs, and base64/data URLs.
 * Automatically adds the DocumentItem to `documents` in appStore, sets it as selectedDocumentId,
 * and returns the DocumentItem.
 */
export async function registerUploadedFile(
  input: File | string,
  preferredName?: string
): Promise<DocumentItem | null> {
  try {
    let doc: DocumentItem | null = null;

    if (typeof input === 'string') {
      if (input.startsWith('data:')) {
        // Base64 Data URL
        const isPdf = input.startsWith('data:application/pdf');
        const type = isPdf ? DocumentType.PDF : DocumentType.IMAGE;
        const filename = preferredName || (isPdf ? `doc_${Date.now()}.pdf` : `image_${Date.now()}.png`);

        if (window.electron?.uploadBase64File) {
          const res = await window.electron.uploadBase64File(input, filename, type);
          if (res.success && res.data) {
            doc = res.data;
          }
        }
      } else {
        // Native filesystem path
        if (window.electron?.uploadFiles) {
          const res = await window.electron.uploadFiles([input]);
          if (res.success && res.data && res.data.length > 0) {
            doc = res.data[0];
          }
        }
      }
    } else if (input instanceof File) {
      const filePath = (input as unknown as { path?: string }).path;
      if (filePath && window.electron?.uploadFiles) {
        const res = await window.electron.uploadFiles([filePath]);
        if (res.success && res.data && res.data.length > 0) {
          doc = res.data[0];
        }
      } else {
        // Read file via FileReader as base64
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(input);
        });

        const isPdf = input.type === 'application/pdf' || input.name.toLowerCase().endsWith('.pdf');
        const type = isPdf ? DocumentType.PDF : DocumentType.IMAGE;
        const filename = input.name || preferredName || (isPdf ? `doc_${Date.now()}.pdf` : `image_${Date.now()}.png`);

        if (window.electron?.uploadBase64File) {
          const res = await window.electron.uploadBase64File(dataUrl, filename, type);
          if (res.success && res.data) {
            doc = res.data;
          }
        }
      }
    }

    if (doc) {
      // Add to store if not already present
      const store = useAppStore.getState();
      const existing = store.documents.find((d) => d.id === doc!.id);
      if (!existing) {
        store.addDocument(doc);
      }
      store.setSelectedDocument(doc.id);
      return doc;
    }
    return null;
  } catch (error) {
    console.error('Failed to register uploaded file:', error);
    return null;
  }
}
