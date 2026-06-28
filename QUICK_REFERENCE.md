# DocuFlow - Quick Reference Card

## 🚀 Getting Started (First Time)

```bash
cd "d:\Projects\VS code\All in one PDF maker"
npm install        # Install all dependencies (includes canvas)
npm run dev        # Start development server
```

**App will open in Electron window with full UI!**

---

## ✅ What Works Right Now (80% Complete)

### Fully Functional
- ✅ Drag-drop file upload
- ✅ PDF thumbnails (first page preview)
- ✅ Image thumbnails  
- ✅ PDF page count detection
- ✅ Drag-to-reorder documents
- ✅ **PDF merging (REAL)** 🎉
- ✅ Save dialog
- ✅ Open file/folder
- ✅ All UI screens
- ✅ Keyboard shortcuts

### Not Yet Implemented
- ❌ Compression
- ❌ Format conversion
- ❌ PDF splitting
- ❌ Password protection
- ❌ Scanner (needs native module)
- ❌ Document editing

---

## 📁 Key Files to Know

### Main Process (Node.js)
```
electron/main/
├── index.ts                    # Entry point
├── services/
│   ├── file.service.ts        # File & thumbnail operations
│   ├── pdf.service.ts         # PDF merge, page count ✨
│   └── output.service.ts      # Output processing ✨
└── utils/
    └── pdfThumbnail.ts        # PDF thumbnail generator ✨
```

### Renderer (React)
```
src/
├── screens/
│   ├── HomeScreen.tsx         # Upload interface
│   ├── DocumentListScreen.tsx # Document grid with drag-drop
│   ├── OutputScreen.tsx       # Configuration
│   ├── ProcessingScreen.tsx   # Progress display ✨
│   └── SuccessScreen.tsx      # Results ✨
└── components/
    ├── ui/                    # Reusable components
    └── document/
        └── DocumentCard.tsx   # Shows thumbnails ✨
```

---

## 🎯 Common Tasks

### Add New PDF Operation

1. **Add method to PdfService:**
```typescript
// electron/main/services/pdf.service.ts
async yourOperation(params): Promise<Result<Output>> {
  // Your pdf-lib code here
}
```

2. **Add IPC channel:**
```typescript
// src/types/IPC.types.ts
export enum IpcChannel {
  PDF_YOUR_OP = 'docuflow:pdf:yourOp',
}
```

3. **Add to IpcApi interface:**
```typescript
yourOperation: (params) => Promise<Result<Output>>;
```

4. **Register handler:**
```typescript
// electron/main/ipc/pdf.handler.ts
ipcMain.handle(IpcChannel.PDF_YOUR_OP, async (_, params) => {
  return await pdfService.yourOperation(params);
});
```

5. **Expose in preload:**
```typescript
// electron/preload/index.ts
yourOperation: (params) => ipcRenderer.invoke(IpcChannel.PDF_YOUR_OP, params),
```

6. **Call from React:**
```typescript
const result = await window.electron.yourOperation(params);
if (result.success) { /* ... */ }
```

### Add New UI Component

1. Create in `src/components/ui/YourComponent.tsx`
2. Follow design system (Tailwind classes)
3. Add TypeScript props interface
4. Export default

### Add New Screen

1. Create in `src/screens/YourScreen.tsx`
2. Add to `AppView` enum in `src/types/UI.types.ts`
3. Add case in `App.tsx` renderScreen()
4. Navigate with `setView(AppView.YOUR_SCREEN)`

---

## 🐛 Debugging

### Main Process Errors
```bash
# Check terminal where `npm run dev` is running
# Errors from Electron main process appear here
```

### Renderer Errors
```
Open DevTools in Electron window
Console tab shows React errors
```

### IPC Issues
```typescript
// Add logging in handler
console.log('Handler received:', params);

// Add logging in renderer
console.log('Calling IPC:', params);
console.log('IPC result:', result);
```

---

## 📚 Important Documentation

- **DOCUFLOW_PROJECT_GUIDE.md** - Full specification
- **BUILD_STATUS.md** - Current progress
- **TESTING.md** - How to test features
- **IMPLEMENTATION_SUMMARY.md** - What was implemented
- **TROUBLESHOOTING.md** - Common issues
- **QUICK_START.md** - Development guide

---

## 🔧 Useful Commands

```bash
# Development
npm run dev              # Start with hot reload
npm run typecheck        # Check TypeScript errors
npm run lint             # Run ESLint
npm run format           # Format with Prettier

# Production
npm run build            # Build for production
npm run dist             # Create installer
```

---

## 💡 Key Concepts

### Result Pattern
```typescript
// All async operations return Result<T>
const result = await someOperation();

if (result.success) {
  // result.data is available
  console.log(result.data);
} else {
  // result.error is available
  console.error(result.error.message);
}
```

### IPC Flow
```
React Component
    ↓ (call)
window.electron.method()
    ↓ (IPC)
preload/index.ts
    ↓ (invoke)
ipcMain.handle()
    ↓ (call)
Service Method
    ↓ (return)
Result<T> back to React
```

### State Management
```typescript
// Get state
const documents = useAppStore((state) => state.documents);

// Update state
const addDocument = useAppStore((state) => state.addDocument);
addDocument(newDoc);
```

---

## 🎨 Design System Quick Reference

### Colors
- `bg-accent` - Blue (#2563EB)
- `text-text-primary` - Dark (#1C1917)
- `border-border` - Gray (#D9D6D1)
- `bg-success` - Green (#16A34A)
- `bg-error` - Red (#DC2626)

### Spacing (4px grid)
- `p-1` = 4px
- `p-2` = 8px  
- `p-4` = 16px
- `p-6` = 24px
- `p-8` = 32px

### Buttons
```tsx
<Button variant="primary">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
```

---

## 🚀 Next Features to Implement

### Priority 1: Compression
```typescript
// In pdf.service.ts
async compress(pdfPath: string, targetSize: number): Promise<Result<string>> {
  // Use pdf-lib to reduce size
  // Implement intelligent compression
}
```

### Priority 2: PDF to Images
```typescript
// Use pdfjs-dist
async convertToImages(pdfPath: string): Promise<Result<string[]>> {
  // Render each page
  // Save as PNG/JPEG
}
```

### Priority 3: Images to PDF
```typescript
// Use pdf-lib
async convertToPdf(imagePaths: string[]): Promise<Result<string>> {
  // Create PDF pages
  // Add images
}
```

---

## ⚡ Performance Tips

- Thumbnails generate async (don't block)
- Large PDFs processed in main process
- UI stays responsive during operations
- Temp files cleaned up automatically

---

## 🎯 Testing Checklist

Quick test to verify everything works:

1. ✅ `npm run dev` - App opens
2. ✅ Drag 2 PDFs - Thumbnails appear
3. ✅ Check page counts - Show correctly
4. ✅ Click Continue - Navigate to list
5. ✅ Drag to reorder - Works smoothly
6. ✅ Click Continue - Navigate to options
7. ✅ Click Process - Save dialog appears
8. ✅ Choose location - Processing starts
9. ✅ Wait for complete - Success screen
10. ✅ Click Open File - PDF opens with all pages

**All 10 steps should work!** 🎉

---

## 📞 Quick Help

**Issue:** TypeScript errors
→ Run `npm run typecheck`

**Issue:** Canvas won't install
→ Install build tools, see TROUBLESHOOTING.md

**Issue:** Thumbnails don't show
→ Check terminal for errors, canvas might not be installed

**Issue:** Merge doesn't work
→ Check file types, must be PDFs

**Issue:** Save dialog doesn't appear
→ Check terminal for errors in output.service.ts

---

## 🎓 Code Style

- Use `async/await` not `.then()`
- Return `Result<T>` from services
- Use TypeScript strict mode (no `any`)
- Add JSDoc to exported functions
- Use Tailwind classes, no inline styles
- Components in PascalCase, files camelCase

---

**You're ready to continue building!** 🚀

The foundation is solid, patterns are established, and the next features will be straightforward to add following these patterns.
