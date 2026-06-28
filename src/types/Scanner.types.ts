/**
 * Scanner status states
 */
export enum ScannerStatus {
  IDLE = 'IDLE',
  CHECKING = 'CHECKING',
  READY = 'READY',
  SCANNING = 'SCANNING',
  ERROR = 'ERROR',
  NOT_FOUND = 'NOT_FOUND',
}

/**
 * Scanner device information
 */
export interface ScannerDevice {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
}

/**
 * Scanner resolution options (DPI)
 */
export type ScanResolution = 75 | 150 | 300 | 600;

/**
 * Scanner color mode
 */
export enum ScanColorMode {
  COLOR = 'COLOR',
  GRAYSCALE = 'GRAYSCALE',
  BLACK_AND_WHITE = 'BLACK_AND_WHITE',
}

/**
 * Scanner paper size
 */
export enum ScanPaperSize {
  A4 = 'A4',
  LETTER = 'LETTER',
  LEGAL = 'LEGAL',
  AUTO = 'AUTO',
}

/**
 * Scanner settings
 */
export interface ScanSettings {
  resolution: ScanResolution;
  colorMode: ScanColorMode;
  paperSize: ScanPaperSize;
}

/**
 * Scanner state in the app
 */
export interface ScannerState {
  status: ScannerStatus;
  devices: ScannerDevice[];
  selectedDevice?: ScannerDevice;
  settings: ScanSettings;
  error?: string;
}

/**
 * Scan result
 */
export interface ScanResult {
  imagePath: string;      // Temp path to scanned image
  format: 'jpg' | 'png';
  size: number;           // File size in bytes
  dimensions: {
    width: number;
    height: number;
  };
  estimatedDpi: number;
  isBlank: boolean;       // Blank page detection
}
