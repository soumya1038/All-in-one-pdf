# DocuFlow - Architecture Diagram

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                           │
│                     (React + TypeScript)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Home    │  │ Document │  │  Output  │  │Processing│       │
│  │  Screen  │→│   List   │→│  Options │→│  Screen  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│       │             │               │              │            │
│       └─────────────┴───────────────┴──────────────┘            │
│                          │                                       │
│                     ┌────▼────┐                                 │
│                     │ Zustand │ ← State Management              │
│                     │  Store  │                                 │
│                     └────┬────┘                                 │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                    ═══════╪═══════  IPC Bridge (Preload)
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    ELECTRON MAIN PROCESS                         │
│                      (Node.js + Electron)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │  IPC Handlers   │  │    Services     │  │    Utilities   │ │
│  ├─────────────────┤  ├─────────────────┤  ├────────────────┤ │
│  │ • file.handler  │  │ • FileService   │  │ • tempDir      │ │
│  │ • pdf.handler   │→│ • PdfService    │  │ • validator    │ │
│  │ • scanner.h     │  │ • ScannerSvc    │  │ • logger       │ │
│  │ • output.h      │  │ • OutputService │  │                │ │
│  │ • system.h      │  │                 │  │                │ │
│  └─────────────────┘  └────────┬────────┘  └────────────────┘ │
│                                 │                                │
│                          ┌──────▼──────┐                        │
│                          │  Libraries  │                        │
│                          ├─────────────┤                        │
│                          │ • pdf-lib   │                        │
│                          │ • sharp     │                        │
│                          │ • pdfjs     │                        │
│                          │ • node-wia  │                        │
│                          └─────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  File System │
                    ├─────────────┤
                    │ • Original  │
                    │ • Temp Dir  │
                    │ • Output    │
                    └─────────────┘
```

---

## Component Hierarchy

```
App
├── MainLayout
│   ├── Titlebar (custom)
│   ├── Sidebar
│   │   └── ShortcutButton (×6)
│   └── Content Area
│       ├── HomeScreen
│       │   ├── DragDropZone
│       │   ├── Button (Browse)
│       │   └── RecentFilesList
│       │
│       ├── DocumentListScreen
│       │   ├── Header (with actions)
│       │   ├── DocumentGrid (DndContext)
│       │   │   └── DocumentCard (×N, sortable)
│       │   └── Footer (actions)
│       │
│       ├── OutputScreen
│       │   ├── Header
│       │   ├── Form
│       │   │   ├── Input (filename)
│       │   │   ├── Select (format)
│       │   │   ├── Input (target size)
│       │   │   └── Checkbox (options)
│       │   └── Footer (actions)
│       │
│       ├── ProcessingScreen
│       │   ├── ProgressBar
│       │   ├── StepIndicators
│       │   └── Button (cancel)
│       │
│       └── SuccessScreen
│           ├── SuccessIcon
│           ├── FileInfo
│           └── Actions
│
├── ScannerModal
│   ├── ScannerList
│   ├── SettingsPanel
│   └── Actions
│
└── Toaster (notifications)
```

---

## Data Flow

### File Upload Flow

```
User drops file
    │
    ▼
DragDropZone
    │
    ▼
useFileUpload hook
    │
    ├─→ Validate file type/size
    │
    ├─→ window.electron.uploadFiles() ──────┐
    │                                        │
    │                                   IPC Bridge
    │                                        │
    │   ┌────────────────────────────────────┘
    │   │
    │   ▼
    │ file.handler
    │   │
    │   ├─→ FileService.createDocument()
    │   │       │
    │   │       ├─→ Copy to temp dir
    │   │       ├─→ Generate thumbnail
    │   │       └─→ Create DocumentItem
    │   │
    │   └─→ Return Result<DocumentItem[]>
    │
    ▼
Add to Zustand store
    │
    ▼
Navigate to DocumentList
```

### Processing Flow

```
User clicks "Process"
    │
    ▼
OutputScreen
    │
    ├─→ Collect all options
    │
    └─→ Navigate to ProcessingScreen
            │
            ▼
        Start processing
            │
            ├─→ window.electron.processOutput() ──────┐
            │                                          │
            │                                     IPC Bridge
            │                                          │
            │   ┌──────────────────────────────────────┘
            │   │
            │   ▼
            │ output.handler
            │   │
            │   ├─→ OutputService.process()
            │   │       │
            │   │       ├─→ Apply edits
            │   │       ├─→ Compress (if needed)
            │   │       ├─→ Convert format
            │   │       ├─→ Merge (if enabled)
            │   │       ├─→ Protect (if enabled)
            │   │       └─→ Save output
            │   │
            │   └─→ Return Result<ProcessingResult>
            │
            ▼
        Update progress
            │
            ▼
        Navigate to SuccessScreen
```

---

## State Management (Zustand)

```
AppState
├── documents: DocumentItem[]
│   ├── id: string
│   ├── filename: string
│   ├── type: DocumentType
│   ├── size: number
│   ├── pageCount: number
│   ├── thumbnailPath: string
│   ├── tempPath: string
│   └── edits: DocumentEdit[]
│
├── outputOptions: OutputOptions
│   ├── filename: string
│   ├── format: OutputFormat
│   ├── targetSize: number
│   ├── pdfPageSize: PdfPageSize
│   ├── imageDpi: ImageDpi
│   ├── protection: PdfProtection
│   └── mergeAsSingle: boolean
│
├── processingStatus: ProcessingStatus
│   ├── step: ProcessingStep
│   ├── progress: number (0-100)
│   ├── currentFile: string
│   └── error: string
│
├── scannerStatus: ScannerState
│   ├── status: ScannerStatus
│   ├── devices: ScannerDevice[]
│   ├── selectedDevice: ScannerDevice
│   └── settings: ScanSettings
│
├── recentFiles: RecentFile[]
│   └── (persisted via electron-store)
│
└── ui: UIState
    ├── currentView: AppView
    ├── modal: ModalState
    ├── selectedDocumentId: string
    ├── isLoading: boolean
    └── loadingMessage: string
```

---

## IPC Channel Map

```
Renderer ←────────────→ Main Process

File Operations:
  uploadFiles()       → FILE_UPLOAD       → FileService.createDocument()
  deleteFile()        → FILE_DELETE       → FileService.deleteDocument()
  validateFile()      → FILE_VALIDATE     → validateFile()
  getThumbnail()      → FILE_GET_THUMBNAIL → FileService.generateThumbnail()

Scanner Operations:
  listScanners()      → SCANNER_LIST      → ScannerService.listDevices()
  checkScanner()      → SCANNER_CHECK     → ScannerService.checkDevice()
  scan()              → SCANNER_SCAN      → ScannerService.scan()

PDF Operations:
  mergePdfs()         → PDF_MERGE         → PdfService.merge()
  compressPdf()       → PDF_COMPRESS      → PdfService.compress()
  convertPdf()        → PDF_CONVERT       → PdfService.convert()
  splitPdf()          → PDF_SPLIT         → PdfService.split()
  protectPdf()        → PDF_PROTECT       → PdfService.protect()

Output Operations:
  processOutput()     → OUTPUT_PROCESS    → OutputService.process()
  saveOutput()        → OUTPUT_SAVE       → OutputService.save()

System Operations:
  getRecentFiles()    → SYSTEM_GET_RECENT → electron-store
  clearTemp()         → SYSTEM_CLEAR_TEMP → cleanupTempDir()
  openFile()          → SYSTEM_OPEN_FILE  → shell.openPath()
  openFolder()        → SYSTEM_OPEN_FOLDER → shell.openPath()
```

---

## Security Architecture

```
┌─────────────────────────────────┐
│      Renderer Process           │
│   (Isolated Sandbox)            │
│                                 │
│  • No Node.js access            │
│  • No Electron access           │
│  • No filesystem access         │
│  • Only window.electron API     │
└─────────────┬───────────────────┘
              │
              │ Typed IPC only
              │
┌─────────────▼───────────────────┐
│      Preload Script             │
│   (Security Bridge)             │
│                                 │
│  • contextBridge.exposeInMain   │
│  • Typed API only               │
│  • No raw objects exposed       │
└─────────────┬───────────────────┘
              │
              │ IPC channels
              │
┌─────────────▼───────────────────┐
│      Main Process               │
│   (Full Node.js access)         │
│                                 │
│  • All IPC inputs validated     │
│  • File paths sanitized         │
│  • Temp directory isolated      │
│  • Original files never touched │
└─────────────────────────────────┘
```

---

## File System Layout

```
System Temp Directory
└── docuflow-session-{uuid}/
    ├── {doc-id}_document.pdf
    ├── {doc-id}_thumb.jpg
    ├── {doc-id}_document2.pdf
    └── ...

User's Documents
├── original_file1.pdf  (never modified)
├── original_file2.pdf  (never modified)
└── ...

Output Location (user chooses)
└── DocuFlow_Output_2024-01-01.pdf
```

---

## Technology Stack Map

```
Presentation Layer (UI)
├── React 18          → Component framework
├── TypeScript        → Type safety
├── Tailwind CSS 3    → Styling
├── Lucide React      → Icons
├── @dnd-kit          → Drag and drop
└── react-hot-toast   → Notifications

State Layer
└── Zustand           → State management

Communication Layer
├── Electron IPC      → Process communication
└── contextBridge     → Security bridge

Business Logic Layer
├── FileService       → File operations
├── PdfService        → PDF operations
├── ScannerService    → Scanner operations
└── OutputService     → Output processing

Infrastructure Layer
├── Electron 30       → Desktop shell
├── Node.js 18        → Runtime
├── pdf-lib           → PDF manipulation
├── Sharp             → Image processing
├── pdfjs-dist        → PDF rendering
├── node-wia          → Scanner access
└── electron-store    → Persistent storage

Build Layer
├── Vite              → Dev server
├── electron-vite     → Build tool
├── electron-builder  → Packaging
└── TypeScript        → Compilation
```

---

## This diagram shows the complete architecture of DocuFlow! 🎯
