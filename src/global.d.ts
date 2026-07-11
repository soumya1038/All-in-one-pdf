import { IpcApi } from './types/IPC.types';

declare global {
  interface Window {
    electron: IpcApi;
  }
}

export {};
