/**
 * Keyboard shortcuts used throughout the application
 */
export const KEYBOARD_SHORTCUTS = {
  UPLOAD_FILES: 'Ctrl+O',
  SCAN: 'Ctrl+Shift+S',
  MERGE_PDF: 'Ctrl+M',
  COMPRESS_PDF: 'Ctrl+Shift+C',
  CONVERT: 'Ctrl+E',
  UNDO: 'Ctrl+Z',
  DELETE: 'Delete',
  PREVIEW: 'Space',
  CLOSE_MODAL: 'Escape',
  SAVE_OUTPUT: 'Ctrl+S',
} as const;

/**
 * Keyboard shortcut to action mapping
 */
export interface ShortcutAction {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: string;
  description: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    key: 'o',
    ctrl: true,
    action: 'upload',
    description: 'Upload files',
  },
  {
    key: 's',
    ctrl: true,
    shift: true,
    action: 'scan',
    description: 'Scan document',
  },
  {
    key: 'm',
    ctrl: true,
    action: 'merge',
    description: 'Merge PDFs',
  },
  {
    key: 'c',
    ctrl: true,
    shift: true,
    action: 'compress',
    description: 'Compress PDF',
  },
  {
    key: 'e',
    ctrl: true,
    action: 'convert',
    description: 'Convert format',
  },
  {
    key: 'z',
    ctrl: true,
    action: 'undo',
    description: 'Undo reorder',
  },
  {
    key: 'Delete',
    action: 'delete',
    description: 'Delete selected',
  },
  {
    key: ' ',
    action: 'preview',
    description: 'Preview document',
  },
  {
    key: 'Escape',
    action: 'closeModal',
    description: 'Close modal',
  },
  {
    key: 's',
    ctrl: true,
    action: 'save',
    description: 'Save output',
  },
];
