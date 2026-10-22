/** Component showcase is available in development and in test builds only; release builds omit it. */
export const SHOWCASE_ENABLED: boolean = import.meta.env.DEV || import.meta.env.VITE_SHOWCASE === '1';
