# DocuFlow

Windows Document Management Desktop App built with Electron + React + TypeScript

## Features

- 📄 Scan documents directly from scanner
- 🗜️ Intelligent PDF compression
- 🔀 Merge multiple PDFs
- 🔄 Convert between formats (PDF, Image, DOCX)
- ✂️ Split PDFs
- 🔒 Password-protect PDFs
- Fully offline - no cloud dependency

## Tech Stack

- **Electron 30+** - Desktop application shell
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS 3** - Styling
- **Zustand** - State management
- **pdf-lib** - PDF manipulation
- **Sharp** - Image processing
- **Vite** - Build tool

## Setup

### Prerequisites

- Node.js 18+ installed
- npm, yarn, or pnpm package manager
- Windows OS (for scanner integration)

### Installation

1. Clone or navigate to project directory:
```bash
cd "d:\Projects\VS code\All in one PDF maker"
```

2. Install dependencies:
```bash
npm install
```

3. Run in development mode:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
npm run dist
```

The installer will be created in the `release/` directory.

## Project Structure

```
docuflow/
├── electron/           # Electron main process
│   ├── main/          # Main process entry
│   │   ├── ipc/       # IPC handlers
│   │   ├── services/  # Business logic services
│   │   └── utils/     # Utilities
│   └── preload/       # Preload script (IPC bridge)
├── src/               # React renderer process
│   ├── components/    # React components
│   ├── screens/       # App screens/views
│   ├── hooks/         # Custom hooks
│   ├── store/         # Zustand state
│   ├── types/         # TypeScript types
│   ├── constants/     # Constants
│   └── utils/         # Utilities
└── assets/            # Static assets
```

## Development Notes

- Main process runs in Node.js (has filesystem access)
- Renderer process runs React (isolated from Node.js)
- Communication via typed IPC channels in `src/types/IPC.types.ts`
- All file operations work on temp copies - originals never modified
- Temp directory auto-cleaned on app close

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run dist` - Package as Windows installer (.exe / .msi)
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run typecheck` - Check TypeScript types

## Security

- `nodeIntegration: false` - Renderer cannot access Node.js directly
- `contextIsolation: true` - Isolates preload script
- Typed IPC API - Only allowed operations exposed
- No external network calls
- CSP enabled

## License

MIT
