// Public API: re-export core modules
export {
  parsePatch,
  applyPatch,
  reconstructBase,
  filesTouchedByPatches,
} from "./src/core/patch.ts";

export {
  indexChanges,
  formatIndexedChanges,
  validateMeta,
  generateSubPatches,
} from "./src/core/split.ts";

export { myersDiff, simpleDiff } from "./src/core/diff.ts";

export type {
  Hunk,
  HunkLine,
  FileContents,
  ChangeItem,
  IndexedChange,
  SplitMeta,
  DiffLine,
} from "./src/core/types.ts";

export { PatchError } from "./src/core/types.ts";
