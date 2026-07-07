import { IpcApi } from './types/IPC.types';

declare global {
  interface Window {
    electron: IpcApi;
    cv?: any;
    Module?: any;
  }
}

export {};
