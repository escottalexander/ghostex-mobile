/**
 * The worktree folders document (`sidebarWorktreeFolders`: named groups of one parent project's
 * worktrees, which the Worktrees layout draws under that parent) and the edits its menus make. Each
 * edit returns the whole new state, which is sent back whole to gxserver's
 * `/api/updateSidebarWorktreeFolders`; gxserver checks the same limits on every update.
 *
 * SEE-ALSO: packages/gx-core/src/project_docs/worktree_folder_edits.rs (the same edits on the
 * desktop), server/src/sidebar_worktree_folders.rs (storage and validation).
 */

export type GhostexWorktreeFolder = {
  folderId: string;
  title: string;
  parentProjectId: string;
  /** A worktree project id is in at most one folder. */
  worktreeProjectIds: string[];
};

export type GhostexWorktreeFoldersState = {
  folders: GhostexWorktreeFolder[];
  nextFolderNumber: number;
};

/** The most folders one parent project holds. */
export const MAX_WORKTREE_FOLDERS_PER_PARENT = 20;
/** The longest folder name, in characters, after trimming. */
export const MAX_WORKTREE_FOLDER_TITLE_CHARS = 80;

export type WorktreeFolderEdit = { state: GhostexWorktreeFoldersState; error: null } | { state: null; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The wire state as a normalized, safely mutable copy; empty when absent or malformed. */
export function cloneWorktreeFoldersState(raw: unknown): GhostexWorktreeFoldersState {
  const state: GhostexWorktreeFoldersState = { folders: [], nextFolderNumber: 1 };
  if (!isObject(raw)) return state;
  if (Array.isArray(raw.folders)) {
    const seen = new Set<string>();
    for (const entry of raw.folders) {
      if (!isObject(entry)) continue;
      const folderId = trimmed(entry.folderId);
      const title = trimmed(entry.title);
      const parentProjectId = trimmed(entry.parentProjectId);
      if (folderId.length === 0 || title.length === 0 || parentProjectId.length === 0 || seen.has(folderId)) continue;
      seen.add(folderId);
      const worktreeProjectIds: string[] = [];
      if (Array.isArray(entry.worktreeProjectIds)) {
        for (const id of entry.worktreeProjectIds) {
          const projectId = trimmed(id);
          if (projectId.length > 0 && !worktreeProjectIds.includes(projectId)) worktreeProjectIds.push(projectId);
        }
      }
      state.folders.push({ folderId, title, parentProjectId, worktreeProjectIds });
    }
  }
  if (typeof raw.nextFolderNumber === 'number' && Number.isFinite(raw.nextFolderNumber)) {
    state.nextFolderNumber = Math.max(1, Math.floor(raw.nextFolderNumber));
  }
  return state;
}

/** The folder holding worktree project `projectId`, if any. */
export function folderOfWorktree(
  state: GhostexWorktreeFoldersState | null | undefined,
  projectId: string,
): GhostexWorktreeFolder | null {
  return state?.folders.find((folder) => folder.worktreeProjectIds.includes(projectId)) ?? null;
}

/** The folders under parent project `parentProjectId`, in document order. */
export function foldersOfParent(
  state: GhostexWorktreeFoldersState | null | undefined,
  parentProjectId: string,
): GhostexWorktreeFolder[] {
  return state?.folders.filter((folder) => folder.parentProjectId === parentProjectId) ?? [];
}

function folderTitle(title: string): { title: string; error: null } | { title: null; error: string } {
  const value = title.trim();
  if (value.length === 0) return { title: null, error: 'Enter a name for the group.' };
  if ([...value].length > MAX_WORKTREE_FOLDER_TITLE_CHARS) {
    return { title: null, error: `A group name is at most ${MAX_WORKTREE_FOLDER_TITLE_CHARS} characters.` };
  }
  return { title: value, error: null };
}

const MISSING_FOLDER = 'That group no longer exists.';

/** `worktreeProjectId` taken out of whichever folder holds it. An emptied folder stays. */
export function removeWorktreeFromFolder(raw: unknown, worktreeProjectId: string): GhostexWorktreeFoldersState {
  const state = cloneWorktreeFoldersState(raw);
  for (const folder of state.folders) {
    folder.worktreeProjectIds = folder.worktreeProjectIds.filter((id) => id !== worktreeProjectId);
  }
  return state;
}

/**
 * A new folder under `parentProjectId` holding only `worktreeProjectId`, which leaves any folder it
 * was in. The folder's id is `f<nextFolderNumber>` (the next free one), and the counter moves on.
 */
export function createFolderWithWorktree(
  raw: unknown,
  parentProjectId: string,
  title: string,
  worktreeProjectId: string,
): WorktreeFolderEdit {
  const name = folderTitle(title);
  if (name.title === null) return { state: null, error: name.error };
  const current = cloneWorktreeFoldersState(raw);
  if (foldersOfParent(current, parentProjectId).length >= MAX_WORKTREE_FOLDERS_PER_PARENT) {
    return { state: null, error: `A project holds at most ${MAX_WORKTREE_FOLDERS_PER_PARENT} groups.` };
  }
  const state = removeWorktreeFromFolder(current, worktreeProjectId);
  let number = Math.max(1, state.nextFolderNumber);
  while (state.folders.some((folder) => folder.folderId === `f${number}`)) number += 1;
  state.folders.push({
    folderId: `f${number}`,
    title: name.title,
    parentProjectId,
    worktreeProjectIds: [worktreeProjectId],
  });
  state.nextFolderNumber = number + 1;
  return { state, error: null };
}

/** `worktreeProjectId` moved into folder `folderId`, out of any other. Unchanged when it is there already. */
export function moveWorktreeToFolder(raw: unknown, folderId: string, worktreeProjectId: string): WorktreeFolderEdit {
  const current = cloneWorktreeFoldersState(raw);
  const target = current.folders.find((folder) => folder.folderId === folderId);
  if (target === undefined) return { state: null, error: MISSING_FOLDER };
  if (target.worktreeProjectIds.includes(worktreeProjectId)) return { state: current, error: null };
  const state = removeWorktreeFromFolder(current, worktreeProjectId);
  state.folders.find((folder) => folder.folderId === folderId)?.worktreeProjectIds.push(worktreeProjectId);
  return { state, error: null };
}

/** Folder `folderId` with a new name. */
export function renameFolder(raw: unknown, folderId: string, title: string): WorktreeFolderEdit {
  const name = folderTitle(title);
  if (name.title === null) return { state: null, error: name.error };
  const state = cloneWorktreeFoldersState(raw);
  const folder = state.folders.find((entry) => entry.folderId === folderId);
  if (folder === undefined) return { state: null, error: MISSING_FOLDER };
  folder.title = name.title;
  return { state, error: null };
}

/** Folder `folderId` gone. Its worktrees are simply in no folder; nothing else changes. */
export function deleteFolder(raw: unknown, folderId: string): GhostexWorktreeFoldersState {
  const state = cloneWorktreeFoldersState(raw);
  state.folders = state.folders.filter((folder) => folder.folderId !== folderId);
  return state;
}
