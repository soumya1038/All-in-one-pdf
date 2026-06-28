# DocuFlow - Troubleshooting Guide

## Common Issues and Solutions

### Installation Issues

#### Issue: `npm install` fails
**Solution:**
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and package-lock.json
rmdir /s /q node_modules
del package-lock.json

# Reinstall
npm install
```

#### Issue: Native module compilation errors (Sharp, etc.)
**Solution:**
```bash
# Install Windows build tools
npm install --global windows-build-tools

# Or install Visual Studio Build Tools manually
# Then rebuild
npm rebuild
```

---

### Development Server Issues

#### Issue: `npm run dev` fails with "Cannot find module"
**Solution:**
```bash
# Make sure all dependencies are installed
npm install

# Check TypeScript compilation
npm run typecheck

# If specific module is missing, install it
npm install [missing-module]
```

#### Issue: Electron window doesn't open
**Solution:**
1. Check terminal for errors in main process
2. Look for port conflicts (5173 should be free)
3. Try:
```bash
# Kill any running processes
taskkill /f /im electron.exe

# Restart
npm run dev
```

#### Issue: Hot reload not working
**Solution:**
- Electron main process changes require full restart
- Renderer (React) changes should hot reload
- If stuck, stop and restart `npm run dev`

---

### TypeScript Issues

#### Issue: Type errors in IDE but code runs fine
**Solution:**
```bash
# Run typecheck to see all errors
npm run typecheck

# Restart TypeScript server in VS Code
# Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

#### Issue: `window.electron` not recognized
**Solution:**
- Make sure `src/global.d.ts` exists
- Restart TypeScript server
- Check that types are imported correctly

#### Issue: Cannot find module '@/*'
**Solution:**
- Check `tsconfig.json` has correct path mappings
- Check `electron-vite.config.ts` has resolve aliases
- Restart development server

---

### Runtime Issues

#### Issue: IPC call returns error immediately
**Solution:**
1. Check terminal for main process errors
2. Verify IPC channel name matches in:
   - `src/types/IPC.types.ts` (IpcChannel enum)
   - `electron/preload/index.ts` (API implementation)
   - `electron/main/ipc/*.handler.ts` (Handler registration)

3. Check handler is registered in `electron/main/ipc/index.ts`

#### Issue: File upload not working
**Solution:**
- In Electron, file paths work differently
- Use `file.path` property for uploaded files
- Check FileService is copying files correctly
- Verify temp directory is created

#### Issue: Drag-drop not working
**Solution:**
- Check DragDropZone component is receiving files
- Verify `onFilesDropped` callback is passed
- Check browser console for errors
- Test with simple file upload first

---

### Build Issues

#### Issue: `npm run build` fails
**Solution:**
```bash
# Clean build directories
rmdir /s /q dist
rmdir /s /q dist-electron

# Rebuild
npm run build
```

#### Issue: Production build is huge
**Solution:**
- Check `electron-builder` config excludes dev dependencies
- Run build analyzer:
```bash
npm run build -- --analyze
```

#### Issue: Installer creation fails
**Solution:**
- Check `electron-builder.yml` configuration
- Verify app icons exist in `assets/icons/`
- Ensure output directory has write permissions

---

### UI Issues

#### Issue: Styles not applying
**Solution:**
1. Check Tailwind CSS is processing:
   - `index.css` imports Tailwind directives
   - `tailwind.config.js` content paths are correct

2. Check browser DevTools for CSS:
   - Are classes being generated?
   - Are there conflicting styles?

3. Restart dev server (sometimes needed for Tailwind)

#### Issue: Modal not closing
**Solution:**
- Check `closeModal` is being called
- Verify Escape key handler is working
- Check modal state in Zustand DevTools

#### Issue: Drag-drop indicators not showing
**Solution:**
- Check CSS classes are applied correctly
- Verify `isDragging` state is updating
- Check z-index isn't causing issues

---

### State Management Issues

#### Issue: State not updating
**Solution:**
```typescript
// Zustand state must be immutable
// ❌ Wrong
state.documents.push(newDoc);

// ✅ Correct
set({ documents: [...state.documents, newDoc] });
```

#### Issue: State resets unexpectedly
**Solution:**
- Check if component is remounting
- Verify no accidental `clearDocuments()` calls
- Check state initialization in store

---

### Performance Issues

#### Issue: App is slow with many documents
**Solution:**
1. Check thumbnail generation isn't blocking
2. Verify large files aren't loaded into memory
3. Consider pagination/virtualization for document list
4. Check DevTools performance profiler

#### Issue: Drag-drop is laggy
**Solution:**
1. Reduce document card complexity
2. Use `transform` instead of position changes
3. Optimize thumbnail sizes
4. Check @dnd-kit documentation for performance tips

---

### Debugging Tips

### Enable DevTools
```typescript
// In electron/main/window.ts
webPreferences: {
  devTools: true, // Always enable for debugging
}

// In electron/main/index.ts
mainWindow.webContents.openDevTools(); // Auto-open
```

### Debug Main Process
```typescript
// Add console.log statements
console.log('Handler called:', data);

// Check terminal output where npm run dev is running
```

### Debug Renderer Process
```typescript
// Use browser DevTools console
console.log('Component rendered:', props);

// Add breakpoints in Sources tab
// Use React DevTools extension
```

### Debug IPC Communication
```typescript
// In preload
console.log('IPC call:', channel, args);

// In handler
console.log('IPC received:', event, args);
console.log('IPC response:', result);
```

### Check Zustand State
```typescript
// In any component
const state = useAppStore.getState();
console.log('Current state:', state);

// Or install Zustand DevTools
```

---

## Getting Help

### Check Documentation
1. This project:
   - `README.md` - Setup instructions
   - `QUICK_START.md` - Development guide
   - `BUILD_STATUS.md` - Project status
   - `DOCUFLOW_PROJECT_GUIDE.md` - Full specification

2. External docs:
   - [Electron Docs](https://www.electronjs.org/docs/latest/)
   - [React Docs](https://react.dev/)
   - [Tailwind Docs](https://tailwindcss.com/docs)
   - [Zustand Docs](https://docs.pmnd.rs/zustand/)
   - [@dnd-kit Docs](https://docs.dndkit.com/)

### Check Issues
- Look at terminal output for main process errors
- Check browser console for renderer errors
- Look at network tab (shouldn't have any requests)
- Check application tab for storage issues

### Last Resort
```bash
# Nuclear option: complete reset
rmdir /s /q node_modules
rmdir /s /q dist
rmdir /s /q dist-electron
del package-lock.json

npm install
npm run dev
```

---

## Common Error Messages

### "Cannot find module 'electron'"
- Solution: Run `npm install`

### "Port 5173 is already in use"
- Solution: Kill existing process or change port in config

### "Failed to create temp directory"
- Solution: Check Windows permissions for temp folder

### "Scanner not found"
- Solution: Scanner functionality needs native module (not yet implemented)

### "PDF operation not implemented"
- Solution: PDF operations need pdf-lib implementation (coming next)

### "Access denied"
- Solution: Check file permissions, run as administrator if needed

---

## Development Best Practices

### Before Committing
```bash
# Check types
npm run typecheck

# Check linting
npm run lint

# Format code
npm run format

# Test build
npm run build
```

### When Adding Features
1. Define types first in `src/types/`
2. Add IPC channel if needed
3. Implement service in `electron/main/services/`
4. Add IPC handler in `electron/main/ipc/`
5. Create UI component in `src/components/`
6. Test thoroughly

### When Debugging
1. Check TypeScript errors first
2. Check terminal for main process errors
3. Check browser console for renderer errors
4. Add console.log statements strategically
5. Use breakpoints in DevTools

---

## Still Stuck?

If you can't resolve an issue:

1. **Document the problem:**
   - What were you trying to do?
   - What happened instead?
   - What error messages appeared?
   - What have you tried?

2. **Check the code:**
   - Are there TypeScript errors?
   - Are imports correct?
   - Is state being updated correctly?

3. **Ask for help:**
   - Provide the error message
   - Show relevant code
   - Explain what you've tried

The codebase is well-structured and follows best practices, so most issues are configuration-related or missing implementations (like PDF operations). 🔧
