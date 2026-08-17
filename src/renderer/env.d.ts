/// <reference types="vite/client" />

import type { DocketApi } from '../preload';

declare global {
  interface Window {
    readonly docket: DocketApi;
  }

  /** Stamped in from package.json by electron-vite at build time. */
  const __APP_VERSION__: string;
}

export {};
