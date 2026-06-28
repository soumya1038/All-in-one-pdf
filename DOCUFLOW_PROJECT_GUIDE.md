# DocuFlow — Complete Project Guide
### Windows Document Management Desktop App
> For use with Claude Sonnet 4.5 in VS Code · Version 1.0

---

## Table of Contents

1. [App Overview & Vision](#1-app-overview--vision)
2. [Tech Stack](#2-tech-stack)
3. [Theme & Visual Design System](#3-theme--visual-design-system)
4. [UI/UX Guidelines](#4-uiux-guidelines)
5. [Feature Specifications](#5-feature-specifications)
6. [Architecture Rules](#6-architecture-rules)
7. [Code Style Rules](#7-code-style-rules)
8. [What NOT To Do](#8-what-not-to-do)
9. [Edge Cases & Error Handling](#9-edge-cases--error-handling)
10. [Safety Checklist (Post-Build)](#10-safety-checklist-post-build)
11. [File & Folder Structure](#11-file--folder-structure)
12. [Claude AI Prompt Rules (for VS Code)](#12-claude-ai-prompt-rules-for-vs-code)

---

## 1. App Overview & Vision

**App Name:** DocuFlow
**Platform:** Windows (Electron + React + TypeScript)
**Target Users:** Individuals and small office users who need fast, offline-capable document handling — no cloud dependency, no subscription.

### Core Philosophy
> "Every operation in three clicks or less."

The app operates on two tracks simultaneously:
- **Shortcut Track** — Power users pick a single action (Scan, Compress, Merge, Convert) right from the home screen.
- **Guided Track** — New users follow a step-by-step wizard that walks through every feature in a logical flow.

Both tracks converge at the same document preview and editing workspace. The user should never feel lost — every screen has a clear back path and a clear forward action.

### What Makes This App Different
- Works fully offline. No file is ever sent to a cloud server.
- Scanner integration built-in (WIA/TWAIN via native bridge).
- Intelligent compression that distributes size targets proportionally across documents.
- Drag-and-drop reordering at every stage, not just at upload.

---

## 2. Tech Stack

### Primary Stack
| Layer | Technology | Reason |
|---|---|---|
| Shell | **Electron 30+** | Native Windows feel, filesystem access, scanner bridge |
| UI Framework | **React 18 + TypeScript** | Component reuse, type safety, VS Code IntelliSense |
| Styling | **Tailwind CSS 3** | Utility-first, consistent spacing, no CSS conflicts |
| PDF Engine | **pdf-lib** | Pure JS PDF creation, merge, compress |
| PDF Preview | **pdfjs-dist** | Render PDF pages as canvas for preview |
| Image Processing | **Sharp** (Node side) | Resize, compress, filter images via native binary |
| Scanner Bridge | **node-wia** or **twain-js** | WIA (Windows Image Acquisition) native calls |
| Drag & Drop | **@dnd-kit/core** | Accessible, modern drag-and-drop |
| State Management | **Zustand** | Lightweight, no boilerplate |
| File Dialogs | **Electron dialog API** | Native Windows open/save dialogs |
| Toasts / Alerts | **react-hot-toast** | Lightweight notification system |
| Icons | **Lucide React** | Clean, consistent icon set |
| Build Tool | **Vite + electron-vite** | Fast HMR in development |
| Packaging | **electron-builder** | Windows .exe / .msi installer output |

### Dev Tools
- **ESLint + Prettier** — Enforced via `.eslintrc` and `.prettierrc`
- **Husky + lint-staged** — Pre-commit hooks
- **Vitest** — Unit tests
- **Playwright** — E2E tests on Electron window

---

## 3. Theme & Visual Design System

### Brand Identity
DocuFlow is a **precision tool** — the visual language should feel like a well-made physical scanner: matte, minimal, intentional. Not clinical, not flashy. Think: a high-end office supply store's aesthetic.

### Color Palette

```
--color-bg-base:       #F7F6F4   /* Warm off-white — main background */
--color-bg-surface:    #FFFFFF   /* Cards, panels, modals */
--color-bg-sunken:     #EEECEA   /* Input backgrounds, document wells */
--color-border:        #D9D6D1   /* Dividers, outlines */
--color-border-focus:  #3D5AFE   /* Focus rings — accessibility */

--color-accent:        #2563EB   /* Primary blue — action buttons */
--color-accent-hover:  #1D4ED8   /* Hover state */
--color-accent-light:  #DBEAFE   /* Chip backgrounds, highlights */

--color-success:       #16A34A   /* Scan OK, convert complete */
--color-warning:       #D97706   /* Size mismatch warning */
--color-error:         #DC2626   /* Scanner not found, corrupt file */
--color-error-light:   #FEE2E2   /* Error chip background */

--color-text-primary:  #1C1917   /* Headings, labels */
--color-text-secondary:#57534E   /* Descriptions, metadata */
--color-text-muted:    #A8A29E   /* Disabled, placeholder */
--color-text-on-accent:#FFFFFF   /* Button labels on blue */
```

### Typography

```
Display / Headings:   "Inter" — weight 600–700, tight tracking (-0.02em)
Body / Labels:        "Inter" — weight 400–500, normal tracking
Monospace (sizes):    "JetBrains Mono" — file sizes, page counts, dimensions
```

Font Scale:
```
--text-xs:    11px / 1.4  — captions, metadata
--text-sm:    13px / 1.5  — secondary labels
--text-base:  15px / 1.6  — body, descriptions
--text-lg:    18px / 1.4  — section headings
--text-xl:    24px / 1.2  — page titles
--text-2xl:   32px / 1.1  — hero/empty state headings
```

### Spacing System (4px base grid)
```
--space-1:   4px
--space-2:   8px
--space-3:   12px
--space-4:   16px
--space-5:   20px
--space-6:   24px
--space-8:   32px
--space-10:  40px
--space-12:  48px
--space-16:  64px
```

### Border Radius
```
--radius-sm:   4px    — inputs, chips
--radius-md:   8px    — cards, modals
--radius-lg:   12px   — document thumbnails
--radius-xl:   16px   — main panels
--radius-full: 9999px — badges, pill buttons
```

### Shadow System
```
--shadow-sm:   0 1px 2px rgba(0,0,0,0.06)
--shadow-md:   0 4px 12px rgba(0,0,0,0.08)
--shadow-lg:   0 12px 32px rgba(0,0,0,0.12)
--shadow-drag: 0 16px 40px rgba(0,0,0,0.18)  /* dragging a document */
```

### Motion
```
--duration-fast:   120ms  — hover states
--duration-normal: 200ms  — panel transitions
--duration-slow:   350ms  — modal enter/exit
--ease-default:    cubic-bezier(0.4, 0, 0.2, 1)
--ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1)  /* drag drop settle */
```

---

## 4. UI/UX Guidelines

### Layout Principles
- **Sidebar is fixed** — 220px wide, always visible, shows app name, shortcut actions, and navigation.
- **Main content area** — fills remaining width, scrollable vertically.
- **No horizontal scroll** — ever. Responsive within the window width.
- **Minimum window size** — 900px × 600px. Set this in Electron `minWidth`/`minHeight`.

### Component Rules

**Buttons**
- Primary (blue fill) — one per screen maximum
- Secondary (outlined) — secondary actions
- Ghost (text only) — destructive/cancel actions
- Always include a `title` attribute for hover tooltip
- Disabled state must visually differ — 40% opacity + `cursor-not-allowed`

**Modals / Popups**
- Max-width: 480px for simple dialogs, 720px for document previews
- Always have: title, content, and action row (cancel on left, primary on right)
- Backdrop click closes non-critical modals (except mid-scan)
- Press `Escape` to close all modals
- Focus trap inside modal while open

**Loading States**
- Skeleton screens for document thumbnails (not spinners in empty space)
- Full-overlay spinner ONLY for scanner operations (blocking hardware)
- Progress bars for conversion/compression (show percentage + estimated time)

**Drag & Drop Zones**
- Dashed border (#D9D6D1) at rest
- Blue filled border + light blue background on drag-over
- Show file type icons on hover preview
- Animate accepted files "sliding in" to the document list (200ms ease)

**Document Thumbnails in List**
- Fixed size: 120px × 160px (portrait A4 ratio)
- White background with subtle shadow
- Page count badge (top-right corner) for multi-page documents
- File size in monospace font below thumbnail
- Hover: show drag handle (left) + action dots (right)

### Navigation Flow Map

```
┌─────────────────────────────────────┐
│           HOME SCREEN               │
│  [Upload/Drop]   [Shortcuts Bar]    │
│    ↓                  ↓             │
│  [Document List]  [Single Action]   │
│    ↓                                │
│  [Preview & Edit] ←→ [Add More]     │
│    ↓                                │
│  [Output Options]                   │
│    ↓                                │
│  [Processing / Progress]            │
│    ↓                                │
│  [Success / Save / Open]            │
└─────────────────────────────────────┘
```

### Keyboard Shortcuts
| Action | Shortcut |
|---|---|
| Upload files | `Ctrl + O` |
| Scan | `Ctrl + Shift + S` |
| Merge PDF | `Ctrl + M` |
| Compress PDF | `Ctrl + Shift + C` |
| Convert | `Ctrl + E` |
| Undo (reorder) | `Ctrl + Z` |
| Delete selected | `Delete` |
| Preview | `Space` (on focused doc) |
| Close modal | `Escape` |
| Save output | `Ctrl + S` |

---

## 5. Feature Specifications

---

### 5.1 Home Screen

**Layout:**
- Top: App logo + app name (left), minimize/close controls (right — custom Electron titlebar)
- Left sidebar: shortcut buttons listed vertically
- Center: Large drag-and-drop upload zone with icon, instruction text, and "or click to browse" link
- Below drop zone: Recent files list (last 5 operations, stored locally)

**Shortcut Buttons (sidebar):**
- 📄 Scan Document
- 🗜️ Compress PDF
- 🔀 Merge PDFs
- 🔄 Convert Format
- ✂️ Split PDF *(added feature)*
- 🔒 Protect PDF (add password) *(added feature)*

Each shortcut button shows a label, icon, and keyboard shortcut badge.

---

### 5.2 Upload / Drag & Drop

**Accepted Types:**
```
.pdf, .jpg, .jpeg, .png, .bmp, .tiff, .tif, .webp,
.docx, .doc, .xlsx, .xls, .pptx, .ppt, .txt
```

**Behavior:**
- Multiple files at once supported
- Each file validated for type + readable before entering the list
- Files are copied to a temp directory — original files are NEVER modified
- If an unsupported type is dropped: show toast error per file, accept the others
- If total input > 500MB: warn the user before proceeding
- Show file-type-specific icon in the drop zone while dragging over (PDF icon, image icon, etc.)

**After Upload → Transition:**
- "Continue" button appears (primary, bottom-right)
- "Clear All" appears (ghost, bottom-left)
- Animated slide-up transition to Document List screen

---

### 5.3 Scanner Integration

**Trigger:** Click "Scan Document" shortcut OR "Scan" inside the Add More popup.

**Flow:**
```
Open Scanner Dialog
  ↓
[Checking for scanner...]  ← show spinner
  ↓ (if no scanner found)
  → Error: "No scanner detected. Make sure your scanner is connected and drivers are installed."
     [Open Device Manager] [Cancel]
  ↓ (if scanner found)
Display scanner name + "Place document on scanner"
  [Scan] [Cancel]
  ↓ (on Scan)
Full overlay spinner: "Scanning... Do not remove document"
  ↓ (on success)
Document added to list with thumbnail preview
  ↓ (on error)
Show error with specific reason + [Retry] [Cancel]
```

**Scanner Error Cases to Handle:**
- No scanner connected
- Scanner busy / in use by another app
- Paper jam detected
- Document feeder empty
- Scan was cancelled by hardware button
- Timeout (> 60 seconds)
- Low quality scan (blank page detection — if 95%+ pixels are white, warn user)

**Scanner Settings (inside scan popup, collapsible):**
- Resolution: 75 / 150 / 300 / 600 dpi (default: 300)
- Color mode: Color / Grayscale / Black & White
- Paper size: A4 / Letter / Legal / Auto

---

### 5.4 Document List Screen

**Layout:**
- Header: "Your Documents (N)" + "Add More" button
- Document grid: horizontal scroll row of thumbnails OR vertical list (user toggleable)
- Each thumbnail: page preview, filename, file size (monospace), page count
- Footer: Total size indicator, Output Options section

**Drag-to-Reorder:**
- Using `@dnd-kit/core`
- Drag handle visible on hover (left side of card)
- While dragging: card scales to 1.05, shadow increases, others shift to make space
- After drop: spring animation to settle position
- Reorder history tracked (Ctrl+Z undoes last reorder)

**Document Card Actions (on click):**
Opens Preview Window with:
- Full-size page view (navigable if multi-page)
- Toolbar: Edit | Delete | Print | Download page

**Edit Mode (within Preview):**
- **Crop:** Draw selection box, apply
- **Rotate:** 90° CW / CCW buttons
- **Filters:** Brightness, Contrast, Sharpen, Grayscale, B&W toggle
- **Signature:** Draw pad (mouse/touch) or upload image signature, position by drag
- **Annotate:** Text box add, color picker, font size *(added feature)*
- **Apply** saves changes to temp copy (non-destructive to original)

**Add More Button:**
Opens popup with:
- 📁 Browse Files
- 📷 Scan Document
- ❌ Cancel

---

### 5.5 Output Options Panel

Displayed below the document list.

**Fields:**

| Option | Input Type | Notes |
|---|---|---|
| Output filename | Text input | Auto-filled: "DocuFlow_Output_[date]" |
| Output format | Dropdown | PDF / JPEG / PNG / TIFF / DOCX |
| Target file size | Number + unit (KB/MB) | Optional — leave blank to skip compression |
| PDF page size | Dropdown | A4 / Letter / Legal / Custom |
| DPI (for image output) | Dropdown | 72 / 150 / 300 / 600 |
| PDF protection | Toggle | Enables password field if on |
| Merge as single PDF | Toggle | On by default when multiple files |

**Action Buttons (footer):**
- `[Cancel]` — returns to home, clears session
- `[Convert & Save]` — primary action, triggers processing

---

### 5.6 Intelligent Compression Engine

**Trigger:** When target size < actual total size.

**Algorithm:**
1. Calculate total actual size and target size.
2. Compute required compression ratio: `ratio = target / actual`
3. For each document, assess compressibility:
   - Images with high detail: low compressibility score
   - Scanned B&W text: high compressibility score
   - Already-compressed JPEGs: low score
   - Vector PDFs: moderate score
4. Sort by compressibility score (descending).
5. Distribute size budget: highly compressible files get compressed more, low-compressibility files compressed less — total meets target.
6. If mathematically impossible (target too small): warn user with minimum achievable size, offer to proceed with that minimum.

**User-Facing:**
- Show per-document compression % in a breakdown panel before final save
- Show estimated quality preview (visual indicator: Good / Fair / Reduced)
- Allow manual override: user can drag a slider per document

---

### 5.7 Processing Screen

**Steps shown with progress:**
```
✓ Validating documents
⏳ Applying edits...       [████████░░] 80%
  Compressing... (2/5)
  Converting format...
  Saving output...
```

- Cancel button available during processing
- If cancelled mid-way: temp files cleaned up, user returned to Document List
- On complete: success screen with file path, file size, "Open File" and "Open Folder" buttons

---

### 5.8 Split PDF *(Added Feature)*

- User selects a single PDF
- Preview shows all pages as thumbnails
- User selects split points (click between pages)
- Output: multiple PDFs named `[original]_part1.pdf`, `[original]_part2.pdf`, etc.
- Optionally extract individual pages as images

---

### 5.9 PDF Password Protection *(Added Feature)*

- User sets owner password (prevents editing) and/or user password (prevents opening)
- AES-256 encryption via `pdf-lib`
- Warn: "If you forget this password, the file cannot be recovered."

---

## 6. Architecture Rules

### Electron Process Separation
```
Main Process (Node.js):
  - File system access
  - Scanner (WIA/TWAIN) bridge
  - pdf-lib operations
  - Sharp image processing
  - IPC handlers

Renderer Process (React):
  - All UI
  - State management (Zustand)
  - Sends IPC messages to main process
  - NEVER accesses fs or native APIs directly
```

**Rule:** The renderer process communicates with the main process ONLY through typed IPC channels defined in `src/preload/api.ts`. No `require('fs')` or `require('electron')` in renderer code ever.

### IPC Channel Naming Convention
```
docuflow:[noun]:[verb]
Examples:
  docuflow:file:upload
  docuflow:file:delete
  docuflow:scanner:list
  docuflow:scanner:scan
  docuflow:pdf:merge
  docuflow:pdf:compress
  docuflow:pdf:convert
  docuflow:pdf:split
  docuflow:pdf:protect
```

### State Structure (Zustand)
```typescript
interface AppState {
  documents: DocumentItem[];       // all loaded docs in session
  outputOptions: OutputOptions;    // current output config
  processingStatus: ProcessingStatus | null;
  scannerStatus: ScannerStatus;
  recentFiles: RecentFile[];       // persisted via electron-store
  ui: UIState;                     // modal open/close, active view, etc.
}
```

### Temp File Management
- All working files live in `os.tmpdir()/docuflow-session-[uuid]/`
- Session directory created on app start
- Session directory deleted on app close (even on crash — register cleanup handler)
- Original uploaded files are NEVER written to — always work on copies

---

## 7. Code Style Rules

### TypeScript
- **Strict mode ON** — `"strict": true` in tsconfig
- No `any` type — use `unknown` and narrow it
- All IPC message payloads must have explicit interfaces
- No implicit returns in async functions

### React
- Functional components only — no class components
- Custom hooks for all business logic (scanner, compression, file handling)
- No inline styles — Tailwind classes only
- Props interfaces named `[ComponentName]Props`
- All `useEffect` cleanup functions must handle component unmount

### File Naming
```
Components:     PascalCase.tsx       DocumentCard.tsx
Hooks:          camelCase.ts         useScanner.ts
Utils:          camelCase.ts         calculateCompression.ts
IPC handlers:   camelCase.ts         handlePdfMerge.ts
Types:          PascalCase.types.ts  Document.types.ts
Constants:      SCREAMING_SNAKE.ts   SCANNER_ERRORS.ts
```

### Comments
- JSDoc on every exported function
- Inline comments for non-obvious logic only
- TODO comments must include: `// TODO(yourname): description — issue #N`
- No commented-out code in committed files

### Error Handling
```typescript
// All async operations must use Result type pattern:
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: AppError };

// Never throw bare strings — always use typed errors:
interface AppError {
  code: ErrorCode;
  message: string;        // user-facing message
  detail?: string;        // technical detail for logs
  recoverable: boolean;
}
```

---

## 8. What NOT To Do

### ❌ Never Do These

**Data & Files**
- ❌ Never modify the user's original file — always work on a temp copy
- ❌ Never send any file or metadata to any external server or API
- ❌ Never store passwords in plaintext — hash or do not store at all
- ❌ Never delete files without explicit user confirmation

**UI/UX**
- ❌ Never show a blank/white screen during loading — always show skeleton or spinner
- ❌ Never auto-close a modal that has user-entered data without confirming
- ❌ Never show technical error codes to the user — translate to plain English
- ❌ Never disable the Cancel button during operations
- ❌ Never open a save dialog without a suggested filename pre-filled
- ❌ Never allow the user to be stuck with no way back
- ❌ Never use more than one primary (blue) button on a single screen
- ❌ Never use red for anything other than destructive/error actions

**Code**
- ❌ Never use `eval()` anywhere
- ❌ Never enable `nodeIntegration: true` in Electron webPreferences
- ❌ Never expose the entire `electron` or `fs` API through the preload — only expose typed IPC functions
- ❌ Never catch an error silently (`catch (e) {}` with no handling)
- ❌ Never use synchronous file operations (`fs.readFileSync`) on the main thread for large files
- ❌ Never hardcode file paths — use `path.join` and `app.getPath()`
- ❌ Never store session data in `localStorage` — use `electron-store` for persistence

**Scanner**
- ❌ Never attempt a scan without first confirming a scanner is connected
- ❌ Never leave the scan overlay open if the scan process crashes — always resolve to success or error state

**Performance**
- ❌ Never load full-resolution images into the renderer for thumbnails — generate low-res previews via Sharp in the main process
- ❌ Never process multiple large files on the renderer thread — always IPC to main

---

## 9. Edge Cases & Error Handling

### File Upload Edge Cases
| Case | Behavior |
|---|---|
| Duplicate file uploaded | Show warning: "This file is already in the list" — let user choose to add anyway or skip |
| Corrupted PDF | Show error on that file, accept others: "This PDF appears to be damaged and could not be read." |
| Password-protected PDF | Show a password prompt modal |
| File name with special characters | Sanitize filename on copy to temp dir, preserve original name for output |
| File > 2GB | Reject immediately: "This file is too large. DocuFlow supports files up to 2 GB." |
| 0-byte file | Reject: "This file appears to be empty." |
| File deleted after upload (while app open) | On processing, detect and show: "Document '[name]' was removed from its original location. DocuFlow kept a safe copy." |

### Scanner Edge Cases
| Case | Behavior |
|---|---|
| Scan produces blank page | Show warning: "The scanned page appears blank. Do you want to retry?" |
| Multiple scanners detected | Show dropdown to select scanner before scan dialog |
| Scanner disconnected mid-scan | Error with spinner dismissed: "Scanner disconnected during scan. Please reconnect and try again." |
| Auto-feeder runs out of pages | Notify: "Scanner ran out of pages. Pages scanned so far have been saved." |
| Low DPI produces unreadable result | Warn after scan if estimated DPI < 150: "This scan may be low quality. Consider rescanning at 300 DPI." |

### Compression Edge Cases
| Case | Behavior |
|---|---|
| Target size is 0 or negative | Reject: "Please enter a size greater than 0." |
| Target size exceeds actual size | Inform: "Target size is larger than the current file. No compression needed — saving as-is." |
| Target size impossibly small (< 10% of actual) | Warn: "This compression level will significantly reduce quality. The minimum achievable size is [X]. Proceed?" |
| Single image document can't compress further | Skip that document and redistribute budget, notify user in summary |

### Conversion Edge Cases
| Case | Behavior |
|---|---|
| Converting PDF with embedded fonts to DOCX | Warn: "Layout may not be preserved perfectly when converting to Word format." |
| Converting scanned image PDF to DOCX | Warn: "This PDF contains scanned images. Text recognition (OCR) is not available — the Word document will contain images, not editable text." |
| Output file already exists at save path | Ask: "A file named [name] already exists. Replace / Save as new / Cancel" |

---

## 10. Safety Checklist (Post-Build)

Run through every item before considering the app release-ready.

### 🔐 Security
- [ ] `nodeIntegration` is `false` in all `BrowserWindow` instances
- [ ] `contextIsolation` is `true` in all `BrowserWindow` instances
- [ ] `preload.ts` only exposes typed IPC functions — no raw `electron` or `fs` object
- [ ] All IPC inputs are validated in main process before processing
- [ ] File paths from renderer are sanitized and checked before use
- [ ] No external network requests — confirm with network profiler
- [ ] No plaintext passwords stored anywhere
- [ ] Temp files are deleted on app close — tested with simulated crash
- [ ] Content Security Policy set in Electron: `default-src 'self'`

### 🗂️ File Safety
- [ ] Original uploaded files are never modified — confirmed by hash check before and after
- [ ] Temp directory is isolated per session with UUID
- [ ] Temp directory cleanup verified: close app → temp dir gone
- [ ] File size validation working: files > 2GB rejected
- [ ] Corrupted PDF handling tested: app does not crash
- [ ] 0-byte file handling tested

### 🖨️ Scanner
- [ ] App starts normally when no scanner connected
- [ ] Scan dialog shows correct error when no scanner found
- [ ] Scanner disconnection mid-scan handled gracefully
- [ ] Blank page detection working
- [ ] Multiple scanner selection working (if multiple connected)
- [ ] Scan cancellation works and cleans up

### 🎨 UI/UX
- [ ] Minimum window size (900×600) enforced — content not broken at minimum
- [ ] All keyboard shortcuts working
- [ ] All modals closeable with Escape
- [ ] Focus trap active in all modals (tab doesn't escape)
- [ ] No horizontal scrollbar appears at any window width ≥ 900px
- [ ] Loading states shown for all async operations > 300ms
- [ ] Cancel button works in every processing screen
- [ ] All error messages are in plain English (no stack traces, no error codes)
- [ ] Empty state shown when document list is empty (not blank space)
- [ ] Drag-and-drop reorder tested with 1, 2, 5, and 20+ documents

### ♿ Accessibility
- [ ] All interactive elements reachable via keyboard
- [ ] All images and icons have `alt` text or `aria-label`
- [ ] Color is not the only way information is conveyed (icons + text labels used)
- [ ] Focus ring visible on all focusable elements
- [ ] Contrast ratio ≥ 4.5:1 for all text (check with browser DevTools)
- [ ] Screen reader tested: VoiceOver / NVDA announces modals and status changes

### ⚡ Performance
- [ ] App opens in < 3 seconds on mid-range hardware
- [ ] Thumbnail generation does not block UI (runs in main process)
- [ ] Merging 20 PDFs does not freeze UI (progress shown)
- [ ] Memory usage stays below 500MB during normal operation
- [ ] No memory leaks: open/close document list 10 times — memory stable
- [ ] Large file (100MB PDF) handled without crash

### 🧪 Testing
- [ ] Unit tests cover: compression algorithm, file validation, filename sanitization
- [ ] E2E tests cover: upload flow, scan flow (mocked), compress flow, convert flow
- [ ] Tested on Windows 10 (21H2+) and Windows 11
- [ ] Tested with non-ASCII filenames (Chinese, Arabic, etc.)
- [ ] Tested with very long filenames (> 200 characters)
- [ ] Tested with file paths containing spaces and special characters

### 📦 Build & Packaging
- [ ] `electron-builder` config targets Windows (.exe installer + .msi)
- [ ] App icon set for all sizes (16, 32, 48, 64, 128, 256px)
- [ ] App version displayed in About dialog
- [ ] Installer tested: installs, runs, and uninstalls cleanly
- [ ] No dev dependencies bundled in production build
- [ ] Source maps excluded from production build

---

## 11. File & Folder Structure

```
docuflow/
├── electron/
│   ├── main/
│   │   ├── index.ts              # Electron main entry
│   │   ├── window.ts             # BrowserWindow config
│   │   ├── ipc/
│   │   │   ├── file.handler.ts
│   │   │   ├── scanner.handler.ts
│   │   │   ├── pdf.handler.ts
│   │   │   └── index.ts          # Register all handlers
│   │   ├── services/
│   │   │   ├── scanner.service.ts
│   │   │   ├── compression.service.ts
│   │   │   ├── conversion.service.ts
│   │   │   ├── merge.service.ts
│   │   │   └── file.service.ts
│   │   └── utils/
│   │       ├── tempDir.ts
│   │       ├── fileValidator.ts
│   │       └── logger.ts
│   └── preload/
│       └── api.ts                # Typed IPC bridge
├── src/
│   ├── components/
│   │   ├── ui/                   # Reusable: Button, Modal, Toast, Input
│   │   ├── document/             # DocumentCard, DocumentList, DocumentPreview
│   │   ├── scanner/              # ScanDialog, ScannerStatus
│   │   ├── output/               # OutputOptions, CompressionPreview
│   │   └── layout/               # Sidebar, Titlebar, MainLayout
│   ├── screens/
│   │   ├── HomeScreen.tsx
│   │   ├── DocumentListScreen.tsx
│   │   ├── OutputScreen.tsx
│   │   └── ProcessingScreen.tsx
│   ├── hooks/
│   │   ├── useScanner.ts
│   │   ├── useDocuments.ts
│   │   ├── useCompression.ts
│   │   └── useFileUpload.ts
│   ├── store/
│   │   └── appStore.ts           # Zustand store
│   ├── types/
│   │   ├── Document.types.ts
│   │   ├── Scanner.types.ts
│   │   ├── Output.types.ts
│   │   └── IPC.types.ts
│   ├── constants/
│   │   ├── ACCEPTED_TYPES.ts
│   │   ├── SCANNER_ERRORS.ts
│   │   └── KEYBOARD_SHORTCUTS.ts
│   └── utils/
│       ├── formatFileSize.ts
│       ├── sanitizeFilename.ts
│       └── calculateCompression.ts
├── assets/
│   ├── icons/                    # App icons (all sizes)
│   └── fonts/
├── tests/
│   ├── unit/
│   └── e2e/
├── .cursorrules                  # Claude behavior rules (below)
├── electron-builder.yml
├── vite.config.ts
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc
└── package.json
```

---

## 12. Claude AI Prompt Rules (for VS Code)

Save the following as `.cursorrules` in your project root. This controls how Claude Sonnet 4.5 behaves when generating code for this project.

```
# DocuFlow .cursorrules
# Windows Document Management Desktop App

## Stack
- Electron 30 + React 18 + TypeScript (strict)
- Tailwind CSS 3 (no inline styles)
- Zustand for state
- pdf-lib for PDF operations
- Sharp (main process only) for image processing
- @dnd-kit/core for drag-and-drop
- electron-vite + Vite for build

## Architecture Rules
- Renderer process: React UI only. NO direct fs/electron/node imports.
- Main process: All file ops, scanner, pdf-lib, sharp run here.
- IPC channels: Named "docuflow:[noun]:[verb]". Typed in src/types/IPC.types.ts.
- Preload: Only expose typed IPC functions. Never expose raw objects.
- Temp files: All work in os.tmpdir()/docuflow-session-[uuid]/. Never touch originals.

## Code Rules
- TypeScript strict mode. No `any`. Use Result<T> pattern for all async ops.
- Functional React components only. No class components.
- All hooks in src/hooks/. No business logic in components.
- All errors must be typed AppError with code, message, detail, recoverable.
- JSDoc on every exported function.
- No commented-out code.

## Security Rules
- nodeIntegration: false always.
- contextIsolation: true always.
- No eval() anywhere.
- Validate all IPC inputs in main process before use.
- No external network calls.

## Style Rules
- Colors from CSS variables in design system (see DOCUFLOW_PROJECT_GUIDE.md).
- Tailwind utility classes only — no style={} props.
- Inter font for all text. JetBrains Mono for sizes/numbers/filenames.
- Primary blue (#2563EB) used for ONE primary button per screen max.
- Error states: red. Success: green. Warning: amber.

## When generating components:
- Always include loading, error, and empty states.
- Always include keyboard accessibility (onKeyDown for Enter/Space on clickable divs).
- Always add aria-label to icon-only buttons.
- Always clean up useEffect subscriptions.

## When generating IPC handlers:
- Always validate input shape in main process.
- Always return Result<T> type.
- Always log errors to electron-log with detail field.
- Always clean up temp resources if operation fails.

## Do NOT generate:
- Any code that modifies original uploaded files.
- Any fetch() or axios call to external URLs.
- Any use of localStorage (use electron-store instead).
- Any synchronous file reads on large files in main thread.
- Any bare catch(e) {} blocks.
- Any hardcoded file paths (use path.join + app.getPath).
```

---

*DocuFlow Project Guide v1.0 — Built for Claude Sonnet 4.5 in VS Code*
*Last updated: June 2026*
