export interface Point {
  x: number;
  y: number;
}

export interface QuadCrop {
  tl: Point;
  tr: Point;
  bl: Point;
  br: Point;
}

export interface DocumentDetectionResult {
  cropBox: QuadCrop;
  rawBox: QuadCrop;
  hasDetectedSubject: boolean;
  confidence: number;
}

const DEFAULT_CROP: QuadCrop = {
  tl: { x: 0, y: 0 },
  tr: { x: 100, y: 0 },
  bl: { x: 0, y: 100 },
  br: { x: 100, y: 100 }
};

/**
 * Expand a quadrilateral crop box outward by a given percentage margin.
 */
export function expandCropWithMargin(crop: QuadCrop, marginPercent: number): QuadCrop {
  if (marginPercent === 0) return { ...crop };
  return {
    tl: {
      x: Math.max(0, Math.round((crop.tl.x - marginPercent) * 10) / 10),
      y: Math.max(0, Math.round((crop.tl.y - marginPercent) * 10) / 10)
    },
    tr: {
      x: Math.min(100, Math.round((crop.tr.x + marginPercent) * 10) / 10),
      y: Math.max(0, Math.round((crop.tr.y - marginPercent) * 10) / 10)
    },
    bl: {
      x: Math.max(0, Math.round((crop.bl.x - marginPercent) * 10) / 10),
      y: Math.min(100, Math.round((crop.bl.y + marginPercent) * 10) / 10)
    },
    br: {
      x: Math.min(100, Math.round((crop.br.x + marginPercent) * 10) / 10),
      y: Math.min(100, Math.round((crop.br.y + marginPercent) * 10) / 10)
    }
  };
}

/**
 * High-precision, client-side document, ID, and subject corner detection.
 * Uses directional Sobel edge gradients (gx, gy), 2D integral projection images,
 * perimeter background profiling, and multi-stage boundary refinement to accurately
 * detect physical documents/cards even with large surrounding backgrounds.
 * 
 * Supports automatic safety margin outward expansion.
 */
export function detectDocumentCorners(
  sourceCanvas: HTMLCanvasElement,
  marginPercent: number = 1.5
): DocumentDetectionResult {
  if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) {
    return {
      cropBox: DEFAULT_CROP,
      rawBox: DEFAULT_CROP,
      hasDetectedSubject: false,
      confidence: 0
    };
  }

  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;

  // 1. Downscale to a 320px target analysis canvas for crisp line resolution & fast computation
  const TARGET_DIM = 320;
  const scale = Math.min(1, TARGET_DIM / Math.max(srcW, srcH));
  const w = Math.max(30, Math.round(srcW * scale));
  const h = Math.max(30, Math.round(srcH * scale));

  const offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    return {
      cropBox: DEFAULT_CROP,
      rawBox: DEFAULT_CROP,
      hasDetectedSubject: false,
      confidence: 0
    };
  }

  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 2. Grayscale conversion & Perimeter Background Profiling
  const gray = new Float32Array(w * h);
  let perimeterSum = 0;
  let perimeterCount = 0;
  const borderMarginX = Math.max(2, Math.round(w * 0.05));
  const borderMarginY = Math.max(2, Math.round(h * 0.05));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      gray[y * w + x] = lum;

      // Sample perimeter (outer 5% borders) to profile background
      if (x < borderMarginX || x >= w - borderMarginX || y < borderMarginY || y >= h - borderMarginY) {
        perimeterSum += lum;
        perimeterCount++;
      }
    }
  }

  const bgMeanLum = perimeterCount > 0 ? perimeterSum / perimeterCount : 128;

  // 3. Directional Sobel Gradients
  // sobelH (|gy|): Detects horizontal boundary edges (top & bottom borders of card)
  // sobelV (|gx|): Detects vertical boundary edges (left & right borders of card)
  const sobelH = new Float32Array(w * h);
  const sobelV = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gX =
        -gray[(y - 1) * w + (x - 1)] + gray[(y - 1) * w + (x + 1)] -
        2 * gray[y * w + (x - 1)] + 2 * gray[y * w + (x + 1)] -
        gray[(y + 1) * w + (x - 1)] + gray[(y + 1) * w + (x + 1)];

      const gY =
        -gray[(y - 1) * w + (x - 1)] - 2 * gray[(y - 1) * w + x] - gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + (x + 1)];

      sobelV[y * w + x] = Math.abs(gX);
      sobelH[y * w + x] = Math.abs(gY);
    }
  }

  // 4. 2D Integral Images for O(1) rectangular edge and luminance queries
  const intH = new Float64Array((w + 1) * (h + 1));
  const intV = new Float64Array((w + 1) * (h + 1));
  const intGray = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pIdx = (y + 1) * (w + 1) + (x + 1);
      const topIdx = y * (w + 1) + (x + 1);
      const leftIdx = (y + 1) * (w + 1) + x;
      const diagIdx = y * (w + 1) + x;

      intH[pIdx] = sobelH[y * w + x] + intH[topIdx] + intH[leftIdx] - intH[diagIdx];
      intV[pIdx] = sobelV[y * w + x] + intV[topIdx] + intV[leftIdx] - intV[diagIdx];
      intGray[pIdx] = gray[y * w + x] + intGray[topIdx] + intGray[leftIdx] - intGray[diagIdx];
    }
  }

  const querySum = (integral: Float64Array, x1: number, y1: number, x2: number, y2: number) => {
    return (
      integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
      integral[y1 * (w + 1) + (x2 + 1)] -
      integral[(y2 + 1) * (w + 1) + x1] +
      integral[y1 * (w + 1) + x1]
    );
  };

  const horizScore = (x1: number, x2: number, y: number) => {
    const yMin = Math.max(0, y - 1);
    const yMax = Math.min(h - 1, y + 1);
    const len = x2 - x1 + 1;
    return querySum(intH, x1, yMin, x2, yMax) / (len * (yMax - yMin + 1));
  };

  const vertScore = (y1: number, y2: number, x: number) => {
    const xMin = Math.max(0, x - 1);
    const xMax = Math.min(w - 1, x + 1);
    const len = y2 - y1 + 1;
    return querySum(intV, xMin, y1, xMax, y2) / (len * (xMax - xMin + 1));
  };

  // 5. Stage 1: Multi-scale Grid Search with Background Contrast & Edge Scoring
  let bestScore = -1;
  let candidate = {
    x1: Math.round(w * 0.05),
    y1: Math.round(h * 0.05),
    x2: Math.round(w * 0.95),
    y2: Math.round(h * 0.95)
  };

  const minW = Math.max(10, Math.round(w * 0.08));
  const minH = Math.max(10, Math.round(h * 0.08));
  const step = 2;

  for (let y1 = 1; y1 <= h - minH - 1; y1 += step) {
    for (let y2 = y1 + minH; y2 <= h - 1; y2 += step) {
      const boxH = y2 - y1;

      for (let x1 = 1; x1 <= w - minW - 1; x1 += step) {
        for (let x2 = x1 + minW; x2 <= w - 1; x2 += step) {
          const boxW = x2 - x1;
          const area = boxW * boxH;
          const areaRatio = area / (w * h);

          // Real documents & IDs can occupy anywhere from 3% to 94% of the camera frame
          if (areaRatio < 0.03 || areaRatio > 0.94) continue;

          const top = horizScore(x1, x2, y1);
          const bot = horizScore(x1, x2, y2);
          const left = vertScore(y1, y2, x1);
          const right = vertScore(y1, y2, x2);

          const avgEdge = (top + bot + left + right) / 4;
          const minEdge = Math.min(top, bot, left, right);

          // Soft thresholding so distance photos with lower edge sharpness are not skipped
          if (avgEdge < 6 || minEdge < 2) continue;

          // Geometric edge mean ensures balanced bounding quad
          const geomEdge = Math.pow(Math.max(1, top) * Math.max(1, bot) * Math.max(1, left) * Math.max(1, right), 0.25);

          // Contrast against surrounding perimeter background
          const insideLum = querySum(intGray, x1, y1, x2, y2) / area;
          const bgContrast = Math.abs(insideLum - bgMeanLum);
          const contrastBonus = 1.0 + Math.min(0.8, bgContrast / 100);

          // Paper / laminate luminance prior
          const lumScore = insideLum > 140 ? 1.25 : (insideLum > 100 ? 1.05 : 0.9);

          // Area prior to prevent trapping on tiny internal text lines
          const sizeBonus = Math.pow(areaRatio, 0.25);

          const totalScore = (geomEdge * 0.5 + minEdge * 0.3 + avgEdge * 0.2) * contrastBonus * lumScore * sizeBonus;

          if (totalScore > bestScore) {
            bestScore = totalScore;
            candidate = { x1, y1, x2, y2 };
          }
        }
      }
    }
  }

  const hasDetected = bestScore > 0;
  let { x1, y1, x2, y2 } = candidate;

  if (hasDetected) {
    // 6. Stage 2: Fine 1-pixel Resolution Edge Refinement
    // Refine Top Edge (y1) to exact peak
    let bestTop = -1;
    let bestY1 = y1;
    for (let dy = -6; dy <= 6; dy++) {
      const ny = y1 + dy;
      if (ny >= 1 && ny < y2 - 10) {
        const val = horizScore(x1, x2, ny);
        if (val > bestTop) {
          bestTop = val;
          bestY1 = ny;
        }
      }
    }
    y1 = bestY1;

    // Refine Bottom Edge (y2) to exact peak
    let bestBot = -1;
    let bestY2 = y2;
    for (let dy = -6; dy <= 6; dy++) {
      const ny = y2 + dy;
      if (ny > y1 + 10 && ny < h) {
        const val = horizScore(x1, x2, ny);
        if (val > bestBot) {
          bestBot = val;
          bestY2 = ny;
        }
      }
    }
    y2 = bestY2;

    // Refine Left Edge (x1) to exact peak
    let bestLeft = -1;
    let bestX1 = x1;
    for (let dx = -6; dx <= 6; dx++) {
      const nx = x1 + dx;
      if (nx >= 1 && nx < x2 - 10) {
        const val = vertScore(y1, y2, nx);
        if (val > bestLeft) {
          bestLeft = val;
          bestX1 = nx;
        }
      }
    }
    x1 = bestX1;

    // Refine Right Edge (x2) to exact peak
    let bestRight = -1;
    let bestX2 = x2;
    for (let dx = -6; dx <= 6; dx++) {
      const nx = x2 + dx;
      if (nx > x1 + 10 && nx < w) {
        const val = vertScore(y1, y2, nx);
        if (val > bestRight) {
          bestRight = val;
          bestX2 = nx;
        }
      }
    }
    x2 = bestX2;
  }

  // 7. Stage 3: Local Vertex Angle Refinement (Accounts for perspective tilt)
  const refineVertex = (cx: number, cy: number): Point => {
    if (!hasDetected) return { x: cx, y: cy };
    let maxCorner = -1;
    let pt: Point = { x: cx, y: cy };
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const cScore = sobelH[ny * w + nx] + sobelV[ny * w + nx];
          if (cScore > maxCorner) {
            maxCorner = cScore;
            pt = { x: nx, y: ny };
          }
        }
      }
    }
    return pt;
  };

  const tlPt = refineVertex(x1, y1);
  const trPt = refineVertex(x2, y1);
  const blPt = refineVertex(x1, y2);
  const brPt = refineVertex(x2, y2);

  // 8. Convert to Percentage Coordinates (0 - 100%)
  const toPercent = (pt: Point): Point => ({
    x: Math.round(Math.max(0, Math.min(100, (pt.x / w) * 100)) * 10) / 10,
    y: Math.round(Math.max(0, Math.min(100, (pt.y / h) * 100)) * 10) / 10
  });

  const rawBox: QuadCrop = hasDetected ? {
    tl: toPercent(tlPt),
    tr: toPercent(trPt),
    bl: toPercent(blPt),
    br: toPercent(brPt)
  } : DEFAULT_CROP;

  // Validate geometry - if points are collapsed or inverted, return default full image
  if (
    !hasDetected ||
    rawBox.tr.x <= rawBox.tl.x + 3 ||
    rawBox.bl.y <= rawBox.tl.y + 3 ||
    rawBox.br.x <= rawBox.bl.x + 3 ||
    rawBox.br.y <= rawBox.tr.y + 3
  ) {
    return {
      cropBox: DEFAULT_CROP,
      rawBox: DEFAULT_CROP,
      hasDetectedSubject: false,
      confidence: 0
    };
  }

  // 9. Expand outward by margin percentage
  const cropBox = expandCropWithMargin(rawBox, marginPercent);

  return {
    cropBox,
    rawBox,
    hasDetectedSubject: true,
    confidence: Math.min(1, Math.round(bestScore / 100 * 10) / 10)
  };
}
