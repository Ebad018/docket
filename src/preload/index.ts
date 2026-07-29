import { contextBridge, ipcRenderer } from 'electron';
import type {
  DocumentKind,
  DocumentPatch,
  FormatCapabilities,
  OpenDocument,
  RecentEntry,
  SaveResult
} from '@shared/documents';
import type { ExportRequest, ExportResult } from '@shared/portable';
import { Channel, type IpcResult } from '@shared/ipc';

export interface FormatDescriptor {
  readonly kind: DocumentKind;
  readonly extensions: string[];
  readonly capabilities: FormatCapabilities;
  readonly writable: boolean;
}

export interface WindowState {
  readonly maximized: boolean;
  readonly focused: boolean;
}

/**
 * The whole surface the renderer is allowed to touch. Node stays in the main
 * process; the renderer gets these functions and nothing else.
 */
const api = {
  documents: {
    openDialog: (): Promise<IpcResult<OpenDocument[]>> =>
      ipcRenderer.invoke(Channel.documentOpenDialog),
    openPath: (filePath: string): Promise<IpcResult<OpenDocument>> =>
      ipcRenderer.invoke(Channel.documentOpenPath, filePath),
    save: (filePath: string, patch: DocumentPatch): Promise<IpcResult<SaveResult>> =>
      ipcRenderer.invoke(Channel.documentSave, filePath, patch),
    saveAs: (
      filePath: string,
      patch: DocumentPatch,
      suggestedName: string
    ): Promise<IpcResult<OpenDocument>> =>
      ipcRenderer.invoke(Channel.documentSaveAs, filePath, patch, suggestedName),
    revealInFolder: (filePath: string): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(Channel.documentRevealInFolder, filePath),
    formats: (): Promise<IpcResult<FormatDescriptor[]>> =>
      ipcRenderer.invoke(Channel.documentSupportedFormats),
    /** Converts an already-extracted canonical document into another format. */
    exportAs: (request: ExportRequest): Promise<IpcResult<ExportResult>> =>
      ipcRenderer.invoke(Channel.documentExport, request)
  },
  recents: {
    list: (limit?: number): Promise<IpcResult<RecentEntry[]>> =>
      ipcRenderer.invoke(Channel.recentsList, limit),
    remove: (filePath: string): Promise<IpcResult<RecentEntry[]>> =>
      ipcRenderer.invoke(Channel.recentsRemove, filePath),
    clear: (): Promise<IpcResult<RecentEntry[]>> => ipcRenderer.invoke(Channel.recentsClear),
    togglePin: (filePath: string): Promise<IpcResult<RecentEntry[]>> =>
      ipcRenderer.invoke(Channel.recentsTogglePin, filePath)
  },
  samples: {
    ensure: (): Promise<IpcResult<string[]>> => ipcRenderer.invoke('samples:ensure')
  },
  window: {
    minimize: () => ipcRenderer.invoke(Channel.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(Channel.windowToggleMaximize),
    close: () => ipcRenderer.invoke(Channel.windowClose),
    onStateChanged: (listener: (state: WindowState) => void) => {
      const wrapped = (_event: unknown, state: WindowState) => listener(state);
      ipcRenderer.on(Channel.windowStateChanged, wrapped);
      return () => {
        ipcRenderer.off(Channel.windowStateChanged, wrapped);
      };
    }
  },
  shell: {
    /** Paths passed to the .exe by Explorer, or by a second launch. */
    onOpenPaths: (listener: (paths: string[]) => void) => {
      const wrapped = (_event: unknown, paths: string[]) => listener(paths);
      ipcRenderer.on('app:open-paths', wrapped);
      return () => {
        ipcRenderer.off('app:open-paths', wrapped);
      };
    }
  },
  platform: process.platform
};

export type DocketApi = typeof api;

contextBridge.exposeInMainWorld('docket', api);
