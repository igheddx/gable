import type { GableApi } from '../shared/ipc';

declare global {
  interface Window {
    gable: GableApi;
  }
}
export {};
