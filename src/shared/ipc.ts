/** Every channel name in one place, so the preload bridge and the main-process
 *  router cannot drift apart silently. */
export const Channel = {
  documentOpenDialog: 'document:open-dialog',
  documentOpenPath: 'document:open-path',
  documentSave: 'document:save',
  documentSaveAs: 'document:save-as',
  documentRevealInFolder: 'document:reveal',
  documentSupportedFormats: 'document:formats',

  documentExport: 'document:export',

  recentsList: 'recents:list',
  recentsRemove: 'recents:remove',
  recentsClear: 'recents:clear',
  recentsTogglePin: 'recents:toggle-pin',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowStateChanged: 'window:state-changed',

  appOpenExternalRequest: 'app:open-external-request'
} as const;

export type ChannelName = (typeof Channel)[keyof typeof Channel];

/** Shape of an IPC failure the renderer can render without guessing. */
export interface IpcFailure {
  readonly ok: false;
  readonly code:
    | 'not-found'
    | 'unsupported-format'
    | 'read-failed'
    | 'write-failed'
    | 'permission-denied'
    | 'cancelled'
    | 'unknown';
  readonly message: string;
  readonly detail?: string;
}

export interface IpcSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

export const ok = <T>(value: T): IpcSuccess<T> => ({ ok: true, value });
export const fail = (
  code: IpcFailure['code'],
  message: string,
  detail?: string
): IpcFailure => ({ ok: false, code, message, detail });
