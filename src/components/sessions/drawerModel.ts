/**
 * Sessions drawer list assembly: turns the selected machine's
 * `buildDrawerItems` output into a list of render BLOCKS matching the desktop
 * layered-panel skin — plain rows (section labels and state cards), project
 * cards (header + child rows in one bordered card), and collection panels
 * (tinted panel containing member project cards).
 *
 * The drawer shows ONE machine, the one its tab strip has selected (desktop
 * parity: packages/core-ui/sidebar-app/machine-tabs.tsx), filtered to the
 * workspace that machine's workspace tile has selected, then to the Space its
 * Space row has selected.
 */

import {
  buildDrawerItems,
  stateCardItem,
  type CollectionHeaderItem,
  type DrawerItem,
  type ProjectHeaderItem,
  type WorktreeFolderHeaderItem,
} from '../../contract/grouping';
import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import { StateCardCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import { filterSummaryForSpace } from '../../spaces/spaceFilter';
import { filterSummaryForWorkspace } from '../../workspaces/workspaceFilter';

export type ProjectCardBlock = {
  header: ProjectHeaderItem;
  children: DrawerItem[];
  /** Worktrees layout: the open project's worktrees in no folder, drawn inside its block. */
  worktrees?: ProjectCardBlock[];
  /** Worktrees layout: the open project's worktree folders, each with its shown members. */
  worktreeFolders?: WorktreeFolderBlock[];
};

export type WorktreeFolderBlock = {
  header: WorktreeFolderHeaderItem;
  members: ProjectCardBlock[];
};

/** Every project card of a block, nested worktrees included. */
export function cardsOfBlock(block: DrawerBlock): ProjectCardBlock[] {
  const roots = block.kind === 'project' ? [block.card] : block.kind === 'collection' ? block.projects : [];
  return roots.flatMap((card) => [
    card,
    ...(card.worktrees ?? []),
    ...(card.worktreeFolders ?? []).flatMap((folder) => folder.members),
  ]);
}

export type DrawerBlock =
  | { kind: 'row'; listKey: string; machineId: string; item: DrawerItem }
  | { kind: 'project'; listKey: string; machineId: string; card: ProjectCardBlock }
  | {
      kind: 'collection';
      listKey: string;
      machineId: string;
      header: CollectionHeaderItem;
      projects: ProjectCardBlock[];
    };

export type DrawerCollapseInput = {
  expandedProjectsByMachine: Record<string, string[]>;
  expandedCollectionsByMachine: Record<string, string[]>;
  expandedGroupsByMachine: Record<string, string[]>;
  collapsedSessionKindsByMachine: Record<string, string[]>;
  collapsedCoordinatorsByMachine?: Record<string, string[]>;
  expandedCoordinatorOlderByMachine?: Record<string, string[]>;
  expandedParkedSessionKeysByMachine?: Record<string, string[]>;
  expandedDraftSessionKeysByMachine?: Record<string, string[]>;
  expandedWorktreeFoldersByMachine?: Record<string, string[]>;
};

export type DrawerListInput = {
  nowMs?: number;
  /** The open session's attachSessionKey (`<machineId>:<sessionId>`), if any. */
  selectedSessionKey?: string | null;
  /** Enabled machines only; empty means the "no machines" state card. */
  machines: MachineRecord[];
  /** The machine whose content the drawer renders; null falls back to the first. */
  selectedMachineId: string | null;
  inventoriesByMachineId: Record<string, MachineInventory>;
  /** Resolved Space id for the selected machine (a Space id, or "other"). */
  selectedSpaceId: string;
  /** Resolved workspace id for the selected machine; null when it has no workspaces. */
  selectedWorkspaceId: string | null;
  collapse: DrawerCollapseInput;
  /** The Worktrees layout (Settings › Sessions list). */
  worktreesLayout?: boolean;
};

function rowBlock(machineId: string, item: DrawerItem): DrawerBlock {
  return { kind: 'row', listKey: `${machineId}:${item.key}`, machineId, item };
}

function isProjectChild(item: DrawerItem): boolean {
  return (
    item.type === 'PROJECT_EMPTY' ||
    item.type === 'GROUP_HEADER' ||
    item.type === 'SESSION' ||
    item.type === 'SESSION_KIND_LABEL' ||
    item.type === 'COORDINATOR_OLDER'
  );
}

/**
 * The mobile Sessions page starts at the project list: the "Projects" header row is gone.
 *
 * CDXC:Sessions 2026-10-08 DECISION:
 * User: "Please remove the 'Projects' header in the sessions list and instead make holding on the machine itself at the top do what the 3 dots button next to Projects does." The list draws no section header rows; the machine menu (long press on the machine tab or the page title) carries the actions the header's ⋮ button had.
 */
function withoutSectionLabels(items: DrawerItem[]): DrawerItem[] {
  return items.filter((item) => item.type !== 'SECTION_LABEL');
}

/** Group the flat builder output into card/panel blocks. */
export function blocksFromItems(machineId: string, items: DrawerItem[]): DrawerBlock[] {
  const blocks: DrawerBlock[] = [];
  let index = 0;

  const collectCard = (header: ProjectHeaderItem): ProjectCardBlock => {
    const children: DrawerItem[] = [];
    while (index < items.length && isProjectChild(items[index])) {
      children.push(items[index]);
      index++;
    }
    return { header, children };
  };

  /** A project's card, then the worktrees and worktree folders the builder put after it. */
  const collectFamily = (header: ProjectHeaderItem): ProjectCardBlock => {
    const card = collectCard(header);
    while (index < items.length) {
      const next = items[index];
      if (next.type === 'WORKTREE_FOLDER_HEADER' && next.projectKey === header.projectKey) {
        index++;
        (card.worktreeFolders ??= []).push({ header: next, members: [] });
        continue;
      }
      if (next.type !== 'PROJECT_HEADER' || next.worktreeNest?.parentProjectKey !== header.projectKey) break;
      index++;
      const member = collectCard(next);
      const folder = card.worktreeFolders?.[card.worktreeFolders.length - 1];
      if (next.worktreeNest.folderId !== null && folder?.header.folderId === next.worktreeNest.folderId) {
        folder.members.push(member);
      } else {
        (card.worktrees ??= []).push(member);
      }
    }
    return card;
  };

  while (index < items.length) {
    const item = items[index];
    if (item.type === 'COLLECTION_HEADER') {
      index++;
      const projects: ProjectCardBlock[] = [];
      while (index < items.length) {
        const member = items[index];
        if (member.type !== 'PROJECT_HEADER' || member.collectionColor === undefined) break;
        index++;
        projects.push(collectFamily(member));
      }
      blocks.push({
        kind: 'collection',
        listKey: `${machineId}:${item.key}`,
        machineId,
        header: item,
        projects,
      });
      continue;
    }
    if (item.type === 'PROJECT_HEADER') {
      index++;
      blocks.push({
        kind: 'project',
        listKey: `${machineId}:${item.key}`,
        machineId,
        card: collectFamily(item),
      });
      continue;
    }
    blocks.push(rowBlock(machineId, item));
    index++;
  }
  return blocks;
}

function machineBlocks(
  machine: MachineRecord,
  inventory: MachineInventory | undefined,
  selectedSpaceId: string,
  selectedWorkspaceId: string | null,
  collapse: DrawerCollapseInput,
  nowMs: number,
  selectedSessionKey: string | null,
  worktreesLayout: boolean,
): DrawerBlock[] {
  const label = machineDisplayLabel(machine);
  if (inventory === undefined || (inventory.summary === null && !inventory.hasLoaded)) {
    return [
      rowBlock(
        machine.id,
        stateCardItem(
          'connecting',
          StateCardCopy.connecting.title,
          StateCardCopy.connecting.body(label),
          StateCardCopy.connecting.actionHint,
        ),
      ),
    ];
  }
  if (inventory.summary === null) {
    return [
      rowBlock(
        machine.id,
        stateCardItem(
          'failure',
          StateCardCopy.failure.title,
          inventory.lastError ?? StateCardCopy.failure.fallbackBody,
          StateCardCopy.failure.actionHint,
        ),
      ),
    ];
  }
  const items = withoutSectionLabels(
    buildDrawerItems({
      machineId: machine.id,
      nowMs,
      activeSessionId: selectedSessionKey?.startsWith(`${machine.id}:`)
        ? selectedSessionKey.slice(machine.id.length + 1)
        : null,
      expandedDraftSessionKeys: new Set(collapse.expandedDraftSessionKeysByMachine?.[machine.id] ?? []),
      summary: filterSummaryForSpace(
        selectedWorkspaceId === null
          ? inventory.summary
          : filterSummaryForWorkspace(inventory.summary, selectedWorkspaceId),
        selectedSpaceId,
      ),
      expandedProjectKeys: new Set(collapse.expandedProjectsByMachine[machine.id] ?? []),
      expandedCollectionIds: new Set(collapse.expandedCollectionsByMachine[machine.id] ?? []),
      expandedGroupKeys: new Set(collapse.expandedGroupsByMachine[machine.id] ?? []),
      collapsedSessionKindKeys: new Set(collapse.collapsedSessionKindsByMachine[machine.id] ?? []),
      expandedParkedSessionKeys: new Set(collapse.expandedParkedSessionKeysByMachine?.[machine.id] ?? []),
      collapsedCoordinatorKeys: new Set(collapse.collapsedCoordinatorsByMachine?.[machine.id] ?? []),
      expandedCoordinatorOlderKeys: new Set(collapse.expandedCoordinatorOlderByMachine?.[machine.id] ?? []),
      worktreesLayout,
      expandedWorktreeFolderKeys: new Set(collapse.expandedWorktreeFoldersByMachine?.[machine.id] ?? []),
      projectIdsWithSessions: new Set(inventory.summary.sessions.map((session) => session.projectId)),
    }),
  );
  if (items.length === 0) {
    return [
      rowBlock(
        machine.id,
        stateCardItem('empty', StateCardCopy.empty.title, StateCardCopy.empty.body, StateCardCopy.empty.actionHint),
      ),
    ];
  }
  return blocksFromItems(machine.id, items);
}

export function buildDrawerList(input: DrawerListInput): DrawerBlock[] {
  const { machines, selectedMachineId, inventoriesByMachineId, selectedSpaceId, selectedWorkspaceId, collapse } = input;
  if (machines.length === 0) {
    return [
      rowBlock(
        '',
        stateCardItem(
          'noMachines',
          StateCardCopy.noMachines.title,
          StateCardCopy.noMachines.body,
          StateCardCopy.noMachines.actionHint,
        ),
      ),
    ];
  }
  const machine = machines.find((entry) => entry.id === selectedMachineId) ?? machines[0];
  return machineBlocks(
    machine,
    inventoriesByMachineId[machine.id],
    selectedSpaceId,
    selectedWorkspaceId,
    collapse,
    input.nowMs ?? Date.now(),
    input.selectedSessionKey ?? null,
    input.worktreesLayout === true,
  );
}

/**
 * `sidebarHideProjectsWithoutSessions`: the list without projects that have no session in any state,
 * and how many it left out, for the Show all projects row (`sidebar_view/assemble.rs` on desktop).
 *
 * CDXC:Sidebar 2026-10-31 DECISION:
 * User (Q851, "show all row"; Q856): the phone follows the computer's switch and has the same row. With `showAll` they come back in their own places and the row stays, as the way back.
 */
export function hideProjectsWithoutSessions(
  blocks: DrawerBlock[],
  summary: GhostexMobileSummary | null | undefined,
  showAll: boolean,
): { blocks: DrawerBlock[]; emptyProjects: number } {
  if (summary?.sidebarHideProjectsWithoutSessions !== true) return { blocks, emptyProjects: 0 };
  const withSessions = new Set(summary.sessions.map((session) => session.projectId));
  // Worktrees layout: a worktree in a folder always stays, and so does a project one of whose worktrees stays.
  const hasSessions = (card: ProjectCardBlock): boolean =>
    withSessions.has(card.header.projectId) ||
    card.header.inWorktreeFolder === true ||
    card.header.keptByWorktree === true;
  let emptyProjects = 0;
  // A left-out card counts with its nested worktrees, and a collapsed parent with the ones it hides.
  const leftOut = (card: ProjectCardBlock): number => 1 + (card.worktrees?.length ?? 0);
  const withKeptWorktrees = (card: ProjectCardBlock): ProjectCardBlock => {
    emptyProjects += card.header.hiddenEmptyWorktrees ?? 0;
    if (card.worktrees === undefined) return card;
    const worktrees = card.worktrees.filter(hasSessions);
    emptyProjects += card.worktrees.length - worktrees.length;
    return { ...card, worktrees };
  };
  const kept: DrawerBlock[] = [];
  for (const block of blocks) {
    if (block.kind === 'project') {
      if (hasSessions(block.card)) kept.push({ ...block, card: withKeptWorktrees(block.card) });
      else emptyProjects += leftOut(block.card) + (block.card.header.hiddenEmptyWorktrees ?? 0);
    } else if (block.kind === 'collection') {
      const projects: ProjectCardBlock[] = [];
      for (const card of block.projects) {
        if (hasSessions(card)) projects.push(withKeptWorktrees(card));
        else emptyProjects += leftOut(card) + (card.header.hiddenEmptyWorktrees ?? 0);
      }
      if (projects.length > 0) kept.push({ ...block, projects });
    } else {
      kept.push(block);
    }
  }
  return { blocks: showAll ? blocks : kept, emptyProjects };
}
