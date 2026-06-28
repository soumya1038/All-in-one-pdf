import { DocumentItem } from '../types/Document.types';
import { CompressionBreakdown } from '../types/Output.types';

/**
 * Calculate compressibility score for a document (0-1, higher = more compressible)
 * @param document - Document to assess
 * @returns Compressibility score
 */
function calculateCompressibility(document: DocumentItem): number {
  // Base score on document type and characteristics
  let score = 0.5; // Default moderate compressibility

  switch (document.type) {
    case 'IMAGE':
      // Images vary - scanned B&W text is highly compressible
      // Already-compressed JPEGs are not
      // Without analyzing content, use moderate score
      score = 0.6;
      break;
    
    case 'PDF':
      // PDFs can contain mix of content
      // Vector PDFs: moderate, scanned PDFs: high
      score = 0.7;
      break;
    
    case 'WORD':
    case 'EXCEL':
    case 'POWERPOINT':
      // Office documents are already compressed
      score = 0.3;
      break;
    
    case 'TEXT':
      // Plain text is highly compressible
      score = 0.9;
      break;
  }

  // Adjust based on file size
  // Smaller files generally have less room for compression
  const sizeMB = document.size / (1024 * 1024);
  if (sizeMB < 1) {
    score *= 0.7;
  } else if (sizeMB > 10) {
    score *= 1.2;
  }

  return Math.min(1, Math.max(0, score));
}

/**
 * Calculate quality estimation based on compression ratio
 * @param ratio - Compression ratio (0-1)
 * @returns Quality descriptor
 */
function estimateQuality(ratio: number): 'Good' | 'Fair' | 'Reduced' {
  if (ratio >= 0.7) return 'Good';
  if (ratio >= 0.4) return 'Fair';
  return 'Reduced';
}

/**
 * Calculate intelligent compression distribution across documents
 * Distributes target size proportionally based on compressibility
 * @param documents - Documents to compress
 * @param targetTotalSize - Target total size in bytes
 * @returns Compression breakdown for each document
 */
export function calculateCompression(
  documents: DocumentItem[],
  targetTotalSize: number
): CompressionBreakdown[] {
  const totalSize = documents.reduce((sum, doc) => sum + doc.size, 0);
  
  // If target is larger than current, no compression needed
  if (targetTotalSize >= totalSize) {
    return documents.map((doc) => ({
      documentId: doc.id,
      originalSize: doc.size,
      targetSize: doc.size,
      compressionRatio: 1,
      quality: 'Good',
      compressibility: 0,
    }));
  }

  // Calculate compressibility scores
  const scoredDocs = documents.map((doc) => ({
    doc,
    score: calculateCompressibility(doc),
  }));

  // Calculate total compressibility weight
  const totalWeight = scoredDocs.reduce((sum, { doc, score }) => 
    sum + (doc.size * score), 0
  );

  // Distribute size budget based on compressibility
  const breakdown: CompressionBreakdown[] = scoredDocs.map(({ doc, score }) => {
    // More compressible files get compressed more
    // Less compressible files get compressed less
    const weight = (doc.size * score) / totalWeight;
    const sizeReduction = (totalSize - targetTotalSize) * weight;
    const targetSize = Math.max(doc.size - sizeReduction, doc.size * 0.1); // Min 10% of original
    const ratio = targetSize / doc.size;

    return {
      documentId: doc.id,
      originalSize: doc.size,
      targetSize: Math.round(targetSize),
      compressionRatio: ratio,
      quality: estimateQuality(ratio),
      compressibility: score,
    };
  });

  // Verify total matches target (adjust for rounding)
  const calculatedTotal = breakdown.reduce((sum, b) => sum + b.targetSize, 0);
  const diff = targetTotalSize - calculatedTotal;
  
  if (Math.abs(diff) > 0 && breakdown.length > 0) {
    // Distribute difference to the most compressible document
    const mostCompressible = breakdown.reduce((max, b) => 
      b.compressibility > max.compressibility ? b : max
    );
    mostCompressible.targetSize += diff;
    mostCompressible.compressionRatio = mostCompressible.targetSize / mostCompressible.originalSize;
    mostCompressible.quality = estimateQuality(mostCompressible.compressionRatio);
  }

  return breakdown;
}

/**
 * Calculate minimum achievable size based on compressibility
 * @param documents - Documents to assess
 * @returns Minimum achievable size in bytes
 */
export function calculateMinimumSize(documents: DocumentItem[]): number {
  return documents.reduce((total, doc) => {
    const score = calculateCompressibility(doc);
    // Minimum is roughly 10% + (90% * (1 - compressibility))
    const minRatio = 0.1 + (0.9 * (1 - score));
    return total + (doc.size * minRatio);
  }, 0);
}
