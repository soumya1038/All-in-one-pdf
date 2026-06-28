# DocuFlow - Quick Start Guide

## Getting Started

### 1. Install Dependencies

Open terminal in project directory and run:

```bash
npm install
```

This will install all dependencies listed in package.json (~200+ packages, may take a few minutes).

### 2. Verify Installation

Check that everything installed correctly:

```bash
npm run typecheck
```

Should complete without errors.

### 3. Start Development Server

```bash
npm run dev
```

This starts:
- Vite dev server for React (port 5173)
- Electron main process
- Hot module reload enabled

The app window should open automatically with the basic layout visible.

---

## Project Architecture Quick Reference

### Communication Flow

```
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│   Renderer   │   IPC    │     Main     │   Node   │   Services   │
│   (React)    │ ────────>│   Process    │ ────────>│  (Business)  │
│              │<────────│  (Electron)  │<────────│    Logic     │
└──────────────┘          └──────────────┘          └──────────────┘
     UI Layer              Bridge Layer            Processing Layer
```

### Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main React app, view routing |
| `src/store/appStore.ts` | Zustand state management |
| `src/types/IPC.types.ts` | Contract between renderer and main |
| `electron/main/index.ts` | Electron entry point |
| `electron/preload/index.ts` | IPC bridge (security boundary) |
| `electron/main/ipc/*.handler.ts` | IPC request handlers |
| `electron/main/services/*.service.ts` | Business logic |

### Making IPC Calls from React

```typescript
// In any React component:
const result = await window.electron.uploadFiles(['/path/to/file.pdf']);

if (result.success) {
  console.log('Documents:', result.data);
} else {
  console.error('Error:', result.error.message);
}
```

All IPC methods return `Result<T>` type - always check `success` field.

---

## Development Workflow

### Adding a New Feature

1. **Define types** in `src/types/` if needed
2. **Add IPC channel** to `IPC.types.ts` if main process interaction needed
3. **Create service method** in `electron/main/services/`
4. **Add IPC handler** in `electron/main/ipc/`
5. **Build UI component** in `src/components/`
6. **Connect to store** in `src/store/appStore.ts`
7. **Use in screen** in `src/screens/`

### Example: Adding PDF Merge UI

1. Service already exists: `PdfService.merge()` (needs implementation)
2. IPC already registered: `IpcChannel.PDF_MERGE`
3. Create component: `src/components/pdf/MergeButton.tsx`
4. Call IPC:
   ```typescript
   const handleMerge = async () => {
     const result = await window.electron.mergePdfs(documentIds, outputPath);
     // Handle result
   };
   ```

---

## Implementing Core Features

### Priority Order (Recommended)

1. **UI Components** (Phase 2)
   - Button, Modal, Input - these are reused everywhere
   - Start here to build the UI toolkit

2. **Home Screen** (Phase 3a)
   - File upload with drag-drop
   - Display uploaded documents
   - Navigate to document list

3. **Document List** (Phase 3b)
   - Show documents as grid/list
   - Drag-to-reorder
   - Delete documents

4. **PDF Merge** (Phase 3c)
   - Implement `PdfService.merge()` with pdf-lib
   - Add "Merge" button in document list
   - Show processing progress
   - Download result

5. **Other PDF Operations** (Phase 3d)
   - Compress, Convert, Split, Protect
   - Follow same pattern as merge

6. **Scanner** (Phase 3e)
   - Install `node-wia` or `twain-js`
   - Implement ScannerService
   - Build scanner UI

---

## Common Tasks

### Add a new Zustand state slice

Edit `src/store/appStore.ts`:

```typescript
interface AppState {
  // ... existing state
  myNewState: string;
  setMyNewState: (value: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // ... existing state
  myNewState: '',
  setMyNewState: (value) => set({ myNewState: value }),
}));
```

### Use state in component

```typescript
import { useAppStore } from '../store/appStore';

function MyComponent() {
  const myState = useAppStore((state) => state.myNewState);
  const setMyState = useAppStore((state) => state.setMyNewState);

  return <button onClick={() => setMyState('new value')}>Click</button>;
}
```

### Add new IPC channel

1. Add channel name to `IpcChannel` enum in `src/types/IPC.types.ts`
2. Add method signature to `IpcApi` interface
3. Implement in `electron/preload/index.ts`
4. Add handler in appropriate `electron/main/ipc/*.handler.ts`

### Style a component with Tailwind

Use design system tokens from `tailwind.config.js`:

```tsx
<button className="bg-accent hover:bg-accent-hover text-text-on-accent px-4 py-2 rounded-md transition-fast">
  Click Me
</button>
```

---

## Debugging

### Electron DevTools

When running `npm run dev`:
- **Renderer DevTools** - Opens automatically (React DevTools available)
- **Main Process logs** - Check terminal where `npm run dev` is running

### Common Issues

**"Module not found" error**
- Run `npm install` again
- Check import paths use correct casing

**Electron window not opening**
- Check terminal for main process errors
- Try deleting `node_modules` and `npm install` again

**TypeScript errors**
- Run `npm run typecheck` to see all errors
- Make sure all `*.types.ts` files are saved

**IPC call not working**
- Check channel name matches in `IPC.types.ts`, `preload/index.ts`, and handler
- Check handler is registered in `electron/main/ipc/index.ts`
- Check terminal for main process errors

---

## Building for Production

### Create installer

```bash
npm run build
npm run dist
```

Output in `release/` folder:
- `DocuFlow Setup.exe` - NSIS installer
- `DocuFlow.msi` - MSI installer

### Test production build

Before distributing:
1. Install the .exe on a clean Windows machine
2. Test all features
3. Check file sizes are reasonable
4. Verify temp directory cleanup on close

---

## Next Immediate Steps

1. Run `npm install`
2. Run `npm run dev` to see the app
3. Start building Button component in `src/components/ui/Button.tsx`
4. Then build Modal component
5. Then build Input component
6. Then implement HomeScreen with file upload

The foundation is complete. Time to build features! 🚀
