/**
 * Sanitize filename by removing or replacing invalid characters
 * @param filename - Original filename
 * @returns Sanitized filename safe for Windows file system
 */
export function sanitizeFilename(filename: string): string {
  // Windows forbidden characters: < > : " / \ | ? *
  const forbidden = /[<>:"/\\|?*]/g;
  
  // Replace forbidden characters with underscore
  let sanitized = filename.replace(forbidden, '_');
  
  // Remove leading/trailing spaces and dots
  sanitized = sanitized.trim().replace(/^\.+|\.+$/g, '');
  
  // Limit length to 255 characters (Windows limit)
  if (sanitized.length > 255) {
    const ext = sanitized.lastIndexOf('.');
    if (ext > 0) {
      const extension = sanitized.substring(ext);
      const nameWithoutExt = sanitized.substring(0, ext);
      sanitized = nameWithoutExt.substring(0, 255 - extension.length) + extension;
    } else {
      sanitized = sanitized.substring(0, 255);
    }
  }
  
  // If filename is empty after sanitization, use a default
  if (sanitized.length === 0) {
    sanitized = 'untitled';
  }
  
  return sanitized;
}
