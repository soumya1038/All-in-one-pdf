/**
 * Format file size in bytes to human-readable string
 * @param bytes - File size in bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Parse human-readable file size to bytes
 * @param sizeStr - Size string (e.g., "1.5 MB")
 * @returns Size in bytes
 */
export function parseFileSize(sizeStr: string): number {
  const units: Record<string, number> = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024,
  };

  const match = sizeStr.match(/^([\d.]+)\s*([A-Z]+)$/i);
  if (!match) return 0;

  const [, num, unit] = match;
  const multiplier = units[unit.toUpperCase()] || 1;

  return parseFloat(num) * multiplier;
}
