/// <reference types="vite/client" />

import type { DocketApi } from '../preload';

declare global {
  interface Window {
    readonly docket: DocketApi;
  }
}

export {};
