import { dirname, join } from 'node:path';
import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { DocumentPatch } from '@shared/documents';
import { EXPORT_TARGETS, type ExportRequest } from '@shared/portable';
import { Channel, fail, ok, type IpcResult } from '@shared/ipc';
import { DocumentError } from '../documents/DocumentHandler';
import type { Application } from '../composition';

/** Wraps a handler so every channel returns the same result envelope and a
 *  thrown error can never crash the main process or hang the renderer. */
const guard =
  <TArgs extends unknown[], TValue>(handler: (...args: TArgs) => Promise<TValue>) =>
  async (...args: TArgs): Promise<IpcResult<TValue>> => {
    try {
      return ok(await handler(...args));
    } catch (error) {
      if (error instanceof DocumentError) {
        return fail(error.code, error.message, error.detail);
      }
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'EACCES' || code === 'EPERM') {
        return fail('permission-denied', 'Windows refused access to that file.');
      }
      return fail(
        'unknown',
        'Something went wrong.',
        error instanceof Error ? error.message : String(error)
      );
    }
  };

export const registerIpc = (application: Application): void => {
  const { documents, recents, samples } = application;

  ipcMain.handle(
    Channel.documentOpenDialog,
    guard(async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(window!, {
        title: 'Open a document',
        properties: ['openFile', 'multiSelections'],
        filters: documents.dialogFilters()
      });
      if (result.canceled || result.filePaths.length === 0) return [];
      return Promise.all(result.filePaths.map((path) => documents.open(path)));
    })
  );

  ipcMain.handle(
    Channel.documentOpenPath,
    guard(async (_event, filePath: string) => documents.open(filePath))
  );

  ipcMain.handle(
    Channel.documentSave,
    guard(async (_event, filePath: string, patch: DocumentPatch) =>
      documents.save(filePath, patch)
    )
  );

  ipcMain.handle(
    Channel.documentSaveAs,
    guard(async (event, filePath: string, patch: DocumentPatch, suggestedName: string) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const handler = application.registry.resolve(filePath);
      const result = await dialog.showSaveDialog(window!, {
        title: 'Save a copy',
        defaultPath: suggestedName,
        filters: [
          { name: handler.capabilities.label, extensions: [...handler.extensions] }
        ]
      });
      if (result.canceled || !result.filePath) {
        throw new DocumentError('cancelled', 'Save cancelled.');
      }
      await copyThenPatch(application, filePath, result.filePath, patch);
      return documents.open(result.filePath);
    })
  );

  ipcMain.handle(
    Channel.documentRevealInFolder,
    guard(async (_event, filePath: string) => {
      shell.showItemInFolder(filePath);
      return true;
    })
  );

  ipcMain.handle(
    Channel.documentSupportedFormats,
    guard(async () => documents.formats())
  );

  ipcMain.handle(
    Channel.appDefaultAppsSettings,
    guard(async () => {
      // Windows will not let an application make itself the default handler —
      // the UserChoice key has been hash-protected since Windows 8, and an app
      // that writes it gets reset. Opening the Settings page Docket is
      // registered on is the honest version of "set as default": one click,
      // made by the person who owns the machine.
      //
      // The URI is a constant, never anything read out of a document.
      await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Docket');
      return true;
    })
  );

  ipcMain.handle(
    Channel.documentExport,
    guard(async (event, request: ExportRequest) => {
      const descriptor = EXPORT_TARGETS.find((entry) => entry.target === request.target);
      if (!descriptor) {
        throw new DocumentError('write-failed', `Docket cannot convert to ${request.target}.`);
      }

      const window = BrowserWindow.fromWebContents(event.sender);
      const suggested = join(
        dirname(request.document.source.filePath),
        `${request.suggestedName}.${descriptor.extension}`
      );

      const result = await dialog.showSaveDialog(window!, {
        title: `Convert to ${descriptor.label}`,
        defaultPath: suggested,
        filters: [{ name: descriptor.label, extensions: [descriptor.extension] }]
      });
      if (result.canceled || !result.filePath) {
        throw new DocumentError('cancelled', 'Conversion cancelled.');
      }

      // Refuse to write over the file being converted: the source is still
      // open, and overwriting it would destroy the original in one click.
      if (
        result.filePath.toLowerCase() === request.document.source.filePath.toLowerCase()
      ) {
        throw new DocumentError(
          'write-failed',
          'That is the file you are converting.',
          'Choose a different name so the original survives.'
        );
      }

      return application.exports.writeTo(result.filePath, request);
    })
  );

  ipcMain.handle(
    Channel.recentsList,
    guard(async (_event, limit?: number) => recents.list(limit))
  );

  ipcMain.handle(
    Channel.recentsRemove,
    guard(async (_event, filePath: string) => {
      await recents.remove(filePath);
      return recents.list();
    })
  );

  ipcMain.handle(
    Channel.recentsClear,
    guard(async () => {
      await recents.clear();
      return recents.list();
    })
  );

  ipcMain.handle(
    Channel.recentsTogglePin,
    guard(async (_event, filePath: string) => recents.togglePin(filePath))
  );

  ipcMain.handle(
    'samples:ensure',
    guard(async () => samples.ensure())
  );

  ipcMain.handle(
    Channel.windowMinimize,
    guard(async (event) => {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
      return true;
    })
  );

  ipcMain.handle(
    Channel.windowToggleMaximize,
    guard(async (event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return false;
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      return window.isMaximized();
    })
  );

  ipcMain.handle(
    Channel.windowClose,
    guard(async (event) => {
      BrowserWindow.fromWebContents(event.sender)?.close();
      return true;
    })
  );
};

/** Save-a-copy writes the untouched original to the new path first, then
 *  applies the patch there — so a failed patch cannot damage the source. */
const copyThenPatch = async (
  application: Application,
  sourcePath: string,
  targetPath: string,
  patch: DocumentPatch
): Promise<void> => {
  const { copyFile } = await import('node:fs/promises');
  await copyFile(sourcePath, targetPath);
  await application.documents.save(targetPath, patch);
};
