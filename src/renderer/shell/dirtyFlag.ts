/** Whether the open form holds unsaved work. Plain module state: it must not trigger renders. */
let dirty = false;
export const isDirty = (): boolean => dirty;
export const setDirtyFlag = (d: boolean): void => {
  dirty = d;
};
