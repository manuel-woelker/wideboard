import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_RESIZE_HANDLES,
  applyFrameLayout,
  createResizeHandle,
  resizeFrame,
  type FrameRect,
  type MinimumSize,
  type PointerDelta,
  type ResizeHandlePosition
} from './elementFrame';
import { createBoardImageRecord, type ImageElement, type ImageRecord } from './imageElement';
import { createBoardLinkRecord, type LinkElement, type LinkRecord } from './linkElement';
import { createBoardNoteRecord, type NoteElement, type NoteRecord } from './noteElement';
import { WIDEBOARD_NOTE_CLIPBOARD_MIME } from './engine/boardEvents';
import type {
  BoardElement,
  BoardImageElement,
  BoardLinkElement,
  BoardNoteElement,
  BoardState
} from './engine/boardEngineTypes';
import {
  BoardEngine,
  type BoardEngineHistorySnapshot,
  type BoardEngineUpdate
} from './engine/BoardEngine';
import type { BoardCommand } from './engine/boardEvents';
export type {
  BoardElement,
  BoardImageElement as ImageElement,
  BoardLinkElement as LinkElement,
  BoardNoteElement as NoteElement
};

export interface BoardComponentProps {
  boardId?: string;
  initialElements?: BoardElement[];
  onEngineReady?: (engine: BoardEngine) => void;
  onBoardPointerMove?: (point: { x: number; y: number }) => void;
  remotePointers?: Array<{ participantId: string; name: string; x: number; y: number }>;
}

const MIN_NOTE_SIZE: MinimumSize = {
  width: 120,
  height: 80
};
const DEFAULT_IMAGE_SIZE: MinimumSize = {
  width: 320,
  height: 240
};
const DEFAULT_LINK_SIZE: MinimumSize = {
  width: 340,
  height: 220
};
const IMAGE_INSERT_OFFSET = 24;
const ALL_ORIGINS_RAW_PROXY = 'https://api.allorigins.win/raw?url=';

const GRID_SIZE = 38;

const DEFAULT_ELEMENT: NoteElement = {
  id: 'note-1',
  kind: 'note',
  x: 120,
  y: 100,
  width: 260,
  height: 180,
  text: 'Double-click or type to edit this note.'
};

type DebugOverlayTab = 'raw_state' | 'last_update' | 'undo_stack';

function cloneBoardState(state: Readonly<BoardState>): BoardState {
  const interaction =
    state.interaction.mode === 'dragging_selection'
      ? {
          ...state.interaction,
          origin: { ...state.interaction.origin },
          elementIds: [...state.interaction.elementIds],
          startPositions: Object.fromEntries(
            Object.entries(state.interaction.startPositions).map(([id, position]) => [
              id,
              { ...position }
            ])
          )
        }
      : { mode: 'idle' as const };

  return {
    elements: Object.fromEntries(
      Object.entries(state.elements).map(([id, element]) => [id, { ...element }])
    ),
    elementOrder: [...state.elementOrder],
    selection: [...state.selection],
    viewport: { ...state.viewport },
    interaction
  };
}

function toStableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const objectValue = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(objectValue)
      .sort()
      .map((key) => [key, toStableValue(objectValue[key])])
  );
}

function toStableJson(value: unknown): string {
  return JSON.stringify(toStableValue(value), null, 2);
}

interface BoardRecord {
  id: string;
  kind: 'note' | 'image' | 'link';
  node: HTMLDivElement;
  note?: NoteRecord;
  image?: ImageRecord;
  link?: LinkRecord;
  scheduleAutoFit: () => void;
}

class BoardRenderer {
  private readonly host: HTMLDivElement;
  private readonly engine: BoardEngine;

  private readonly records = new Map<string, BoardRecord>();
  private renderedElementOrder: string[] = [];
  private unsubscribeFromEngine: (() => void) | null = null;
  private pendingSyncOptions: { resetEditing?: boolean } | null = null;

  private activeNoteId: string | null = null;

  private noteSequence = 1;
  private imageSequence = 1;
  private linkSequence = 1;

  private lastCopiedNote: NoteElement | null = null;

  private panOffset: PointerDelta = { x: 0, y: 0 };

  private zoom = 1;

  private marqueeNode: HTMLDivElement | null = null;
  private suppressContextMenuOnce = false;

  private readonly selectionFrameNode: HTMLDivElement;

  private readonly selectionResizeHandles: ReadonlyArray<{
    position: ResizeHandlePosition;
    node: HTMLDivElement;
  }>;

  public constructor(host: HTMLDivElement, initialElements: BoardElement[]) {
    this.host = host;
    this.engine = new BoardEngine({
      initialElements
    });
    this.host.style.position = 'relative';
    this.host.style.width = '100%';
    this.host.style.height = '100%';
    this.host.style.overflow = 'hidden';
    this.host.style.backgroundColor = '#d6f4ff';
    this.host.style.backgroundImage =
      'linear-gradient(rgba(20, 84, 133, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(20, 84, 133, 0.12) 1px, transparent 1px), radial-gradient(circle at 16% 0%, #ecfbff 0%, #d6f4ff 42%, #bdddf5 100%)';
    this.host.style.backgroundSize = `${GRID_SIZE}px ${GRID_SIZE}px, ${GRID_SIZE}px ${GRID_SIZE}px, 100% 100%`;
    this.selectionFrameNode = document.createElement('div');
    this.selectionFrameNode.dataset.testid = 'board-selection-frame';
    this.selectionFrameNode.style.position = 'absolute';
    this.selectionFrameNode.style.pointerEvents = 'none';
    this.selectionFrameNode.style.border = '2px solid rgba(20, 84, 133, 0.65)';
    this.selectionFrameNode.style.zIndex = '12';
    this.selectionFrameNode.style.display = 'none';

    this.selectionResizeHandles = ALL_RESIZE_HANDLES.map((position) => ({
      position,
      node: createResizeHandle(position)
    }));

    this.selectionResizeHandles.forEach(({ position, node }) => {
      node.addEventListener('pointerdown', (event) => {
        this.beginSelectionResize(event, position);
      });
      node.style.pointerEvents = 'auto';
      this.selectionFrameNode.append(node);
    });

    this.host.append(this.selectionFrameNode);

    this.noteSequence = this.deriveInitialNoteSequence(initialElements);
    this.imageSequence = this.deriveInitialImageSequence(initialElements);
    this.linkSequence = this.deriveInitialLinkSequence(initialElements);

    this.host.addEventListener('pointerdown', this.handlePanStart, { capture: true });
    this.host.addEventListener('wheel', this.handleZoom, { passive: false });
    this.host.addEventListener('contextmenu', this.handleContextMenu);
    window.addEventListener('copy', this.handleCopy);
    window.addEventListener('paste', this.handlePaste);
    this.host.addEventListener('dragover', this.handleDragOver);
    this.host.addEventListener('drop', this.handleDrop);
    window.addEventListener('keydown', this.handleKeyDown);

    this.unsubscribeFromEngine = this.engine.subscribe(
      () => {
        const options = this.pendingSyncOptions ?? {};
        this.pendingSyncOptions = null;
        this.syncFromEngineState(options);
      },
      {
        emitCurrent: true
      }
    );

    const firstElementId = this.engine.getState().elementOrder[0];
    if (firstElementId) {
      this.dispatchAndSync({
        type: 'select',
        ids: [firstElementId]
      });
    }
  }

  private dispatchAndSync(command: BoardCommand, options: { resetEditing?: boolean } = {}) {
    this.runEngineMutation(() => this.engine.execute(command), options);
  }

  private runEngineMutation(
    mutate: () => number,
    options: { resetEditing?: boolean } = {}
  ): boolean {
    const previousRevision = this.engine.getRevision();
    this.pendingSyncOptions = options;
    const nextRevision = mutate();
    const didMutate = nextRevision !== previousRevision;
    if (!didMutate) {
      this.pendingSyncOptions = null;
    }

    return didMutate;
  }

  private getEngineElementsInOrder() {
    const state = this.engine.getState();
    return state.elementOrder.map((id) => state.elements[id]);
  }

  private getEngineElement(id: string) {
    return this.engine.getState().elements[id];
  }

  private syncRecordModel(record: BoardRecord, element: BoardElement) {
    if (record.kind === 'note') {
      if (element.kind !== 'note' || !record.note) {
        return;
      }
      const isActivelyEditing = record.note.editor.isContentEditable;
      if (
        record.note.editor.textContent !== element.text &&
        (!isActivelyEditing || document.activeElement !== record.note.editor)
      ) {
        record.note.editor.textContent = element.text;
      }
      record.note.model = element;
      return;
    }

    if (element.kind !== 'image' || !record.image) {
      if (record.kind !== 'link' || element.kind !== 'link' || !record.link) {
        return;
      }
      record.link.applyModel(element);
      return;
    }
    record.image.model = element;
  }

  private getEditingSnapshot() {
    const editingRecord = Array.from(this.records.values()).find((record) => {
      return record.kind === 'note' && Boolean(record.note?.editor.isContentEditable);
    });
    if (!editingRecord || editingRecord.kind !== 'note' || !editingRecord.note) {
      return null;
    }

    return {
      id: editingRecord.id,
      hadFocus: document.activeElement === editingRecord.note.editor
    };
  }

  private syncFromEngineState(options: { resetEditing?: boolean } = {}) {
    const editingSnapshot = this.getEditingSnapshot();
    const state = this.engine.getState();
    this.panOffset = {
      x: state.viewport.panX,
      y: state.viewport.panY
    };
    this.zoom = state.viewport.zoom;
    const knownIds = new Set(state.elementOrder);

    this.records.forEach((record, id) => {
      if (knownIds.has(id)) {
        return;
      }

      record.node.remove();
      this.records.delete(id);
    });

    state.elementOrder.forEach((id) => {
      const element = state.elements[id];
      const existing = this.records.get(id);
      if (!existing) {
        if (element.kind === 'note') {
          this.createNote(element);
        } else if (element.kind === 'image') {
          this.createImage(element);
        } else {
          this.createLink(element);
        }
        return;
      }

      this.syncRecordModel(existing, element);
      this.applyFrameWithPan(existing.node, element);
      existing.scheduleAutoFit();
    });

    if (
      this.renderedElementOrder.length !== state.elementOrder.length ||
      this.renderedElementOrder.some((id, index) => state.elementOrder[index] !== id)
    ) {
      state.elementOrder.forEach((id) => {
        const record = this.records.get(id);
        if (!record) {
          return;
        }

        this.host.append(record.node);
      });
      this.renderedElementOrder = [...state.elementOrder];
    }

    this.setSelectionStyles(state.selection, this.activeNoteId, options.resetEditing ?? false);
    if (!options.resetEditing && editingSnapshot) {
      const editingRecord = this.records.get(editingSnapshot.id);
      if (editingRecord?.kind === 'note' && editingRecord.note) {
        editingRecord.note.setEditingEnabled(true);
        if (editingSnapshot.hadFocus) {
          editingRecord.note.editor.focus();
        }
      }
    }
    this.refreshAllLayouts();
  }

  private setSelectionStyles(
    noteIdList: string[],
    preferredActiveNoteId: string | null = null,
    resetEditing = true
  ) {
    const selectedNoteIds = new Set<string>();
    noteIdList.forEach((noteId) => {
      if (this.records.has(noteId)) {
        selectedNoteIds.add(noteId);
      }
    });

    if (preferredActiveNoteId && selectedNoteIds.has(preferredActiveNoteId)) {
      this.activeNoteId = preferredActiveNoteId;
    } else if (this.activeNoteId && selectedNoteIds.has(this.activeNoteId)) {
      this.activeNoteId = this.activeNoteId;
    } else {
      this.activeNoteId = selectedNoteIds.values().next().value ?? null;
    }

    this.records.forEach((record, recordId) => {
      const isSelected = selectedNoteIds.has(recordId);

      record.node.dataset.selected = isSelected ? 'true' : 'false';
      record.node.style.outline = isSelected ? '2px solid rgba(20, 84, 133, 0.42)' : 'none';
      record.node.style.outlineOffset = isSelected ? '0px' : '';
      if (resetEditing) {
        record.note?.setEditingEnabled(false);
      }
    });
  }

  public destroy() {
    this.host.removeEventListener('pointerdown', this.handlePanStart, { capture: true });
    this.host.removeEventListener('wheel', this.handleZoom);
    this.host.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('copy', this.handleCopy);
    window.removeEventListener('paste', this.handlePaste);
    this.host.removeEventListener('dragover', this.handleDragOver);
    this.host.removeEventListener('drop', this.handleDrop);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.unsubscribeFromEngine?.();
    this.unsubscribeFromEngine = null;
    this.pendingSyncOptions = null;
    this.records.clear();
    this.renderedElementOrder = [];
    this.selectionFrameNode.remove();
    this.host.replaceChildren();
  }

  public getEngine() {
    return this.engine;
  }

  public createTextNoteAt(position: PointerDelta) {
    const createdElement: NoteElement = {
      id: this.generateNoteId(),
      kind: 'note',
      ...this.boundPosition(position, { width: 260, height: 170 }),
      width: 260,
      height: 170,
      text: 'New note'
    };
    this.dispatchAndSync({
      type: 'addElement',
      element: createdElement
    });
    this.setSelection([createdElement.id], createdElement.id);
    this.enableEditingForNoteById(createdElement.id, {
      selectAll: true
    });
  }

  public clearActiveNote() {
    this.setSelection([]);
  }

  public beginMarqueeSelection(event: PointerEvent) {
    if (event.button !== 0 || event.target !== this.host) {
      return false;
    }

    event.preventDefault();

    const hostBounds = this.host.getBoundingClientRect();
    const origin = {
      x: event.clientX - hostBounds.left,
      y: event.clientY - hostBounds.top
    };

    const marquee = document.createElement('div');
    marquee.dataset.testid = 'board-marquee-selection';
    marquee.style.position = 'absolute';
    marquee.style.pointerEvents = 'none';
    marquee.style.zIndex = '15';
    marquee.style.border = '1px dashed rgba(20, 84, 133, 0.75)';
    marquee.style.background = 'rgba(121, 219, 255, 0.18)';

    this.host.append(marquee);
    this.marqueeNode = marquee;

    this.updateMarquee(origin, origin);
    let didMove = false;
    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const current = {
        x: moveEvent.clientX - hostBounds.left,
        y: moveEvent.clientY - hostBounds.top
      };
      this.updateMarquee(origin, current);

      didMove = didMove || Math.hypot(current.x - origin.x, current.y - origin.y) >= 3;
      if (!didMove) {
        return;
      }

      this.setSelection(this.getIntersectingNoteIds(origin, current));
    };

    const onPointerUp = () => {
      if (!didMove) {
        this.clearActiveNote();
      }

      this.marqueeNode?.remove();
      this.marqueeNode = null;

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (
        pointerId !== null &&
        typeof this.host.releasePointerCapture === 'function' &&
        this.host.hasPointerCapture(pointerId)
      ) {
        this.host.releasePointerCapture(pointerId);
      }
    };

    if (pointerId !== null && typeof this.host.setPointerCapture === 'function') {
      this.host.setPointerCapture(pointerId);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return true;
  }

  private boundPosition(position: PointerDelta, size: MinimumSize): PointerDelta {
    const hostWidth = this.host.clientWidth;
    const hostHeight = this.host.clientHeight;

    return {
      x: Math.max(0, Math.min(position.x, Math.max(0, hostWidth - size.width))),
      y: Math.max(0, Math.min(position.y, Math.max(0, hostHeight - size.height)))
    };
  }

  private deriveInitialNoteSequence(elements: BoardElement[]) {
    const maxExistingId = elements
      .map((element) => {
        if (element.kind !== 'note') {
          return 0;
        }

        const match = /^note-(\d+)$/u.exec(element.id);
        return match ? Number.parseInt(match[1], 10) : 0;
      })
      .reduce((maxId, currentId) => Math.max(maxId, currentId), 0);

    return maxExistingId + 1;
  }

  private deriveInitialImageSequence(elements: BoardElement[]) {
    const maxExistingId = elements
      .map((element) => {
        if (element.kind !== 'image') {
          return 0;
        }

        const match = /^image-(\d+)$/u.exec(element.id);
        return match ? Number.parseInt(match[1], 10) : 0;
      })
      .reduce((maxId, currentId) => Math.max(maxId, currentId), 0);

    return maxExistingId + 1;
  }

  private deriveInitialLinkSequence(elements: BoardElement[]) {
    const maxExistingId = elements
      .map((element) => {
        if (element.kind !== 'link') {
          return 0;
        }

        const match = /^link-(\d+)$/u.exec(element.id);
        return match ? Number.parseInt(match[1], 10) : 0;
      })
      .reduce((maxId, currentId) => Math.max(maxId, currentId), 0);

    return maxExistingId + 1;
  }

  private generateNoteId() {
    while (this.engine.getState().elements[`note-${this.noteSequence}`]) {
      this.noteSequence += 1;
    }

    const id = `note-${this.noteSequence}`;
    this.noteSequence += 1;
    return id;
  }

  private generateImageId() {
    while (this.engine.getState().elements[`image-${this.imageSequence}`]) {
      this.imageSequence += 1;
    }

    const id = `image-${this.imageSequence}`;
    this.imageSequence += 1;
    return id;
  }

  private generateLinkId() {
    while (this.engine.getState().elements[`link-${this.linkSequence}`]) {
      this.linkSequence += 1;
    }

    const id = `link-${this.linkSequence}`;
    this.linkSequence += 1;
    return id;
  }

  /* 📖 # Why keep pan + zoom in board space?
  Dragging and resizing should update the model in its own coordinate system,
  so we only scale during rendering and divide pointer deltas by zoom.
  */
  private applyFrameWithPan(node: HTMLElement, frame: FrameRect) {
    applyFrameLayout(node, {
      ...frame,
      x: (frame.x + this.panOffset.x) * this.zoom,
      y: (frame.y + this.panOffset.y) * this.zoom,
      width: frame.width * this.zoom,
      height: frame.height * this.zoom
    });
  }

  private updatePanBackground() {
    const offset = `${this.panOffset.x * this.zoom}px ${this.panOffset.y * this.zoom}px`;
    this.host.style.backgroundPosition = `${offset}, ${offset}, center`;
    this.host.style.backgroundSize = `${GRID_SIZE * this.zoom}px ${GRID_SIZE * this.zoom}px, ${
      GRID_SIZE * this.zoom
    }px ${GRID_SIZE * this.zoom}px, 100% 100%`;
  }

  private refreshAllLayouts() {
    this.updatePanBackground();
    this.records.forEach((record) => {
      const model = this.getEngineElement(record.id);
      if (!model) {
        return;
      }
      this.applyFrameWithPan(record.node, model);
    });
    this.refreshSelectionFrame();
  }

  private scheduleAutoFitAll() {
    this.records.forEach((record) => {
      record.scheduleAutoFit();
    });
  }

  private isEventInsideHost(event: Event) {
    const target = event.target;
    return target instanceof Node && this.host.contains(target);
  }

  private shouldHandleBoardClipboard(event: ClipboardEvent) {
    if (this.isEventInsideHost(event)) {
      return true;
    }

    const activeElement = document.activeElement;
    if (!activeElement || activeElement === document.body) {
      return true;
    }

    return this.host.contains(activeElement);
  }

  private shouldHandleBoardKeyboard() {
    const activeElement = document.activeElement;
    if (!activeElement || activeElement === document.body) {
      return true;
    }

    return this.host.contains(activeElement);
  }

  private isTextEditingElement(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName;
    return (
      target.isContentEditable ||
      target.getAttribute('contenteditable') === 'true' ||
      tagName === 'INPUT' ||
      tagName === 'TEXTAREA'
    );
  }

  private shouldAllowDefaultTextDelete(event: KeyboardEvent) {
    if (this.isTextEditingElement(event.target)) {
      return true;
    }

    return this.isTextEditingElement(document.activeElement);
  }

  private getActiveNoteRecord(): NoteRecord | null {
    if (!this.activeNoteId) {
      return null;
    }

    const record = this.records.get(this.activeNoteId);
    if (!record || record.kind !== 'note') {
      return null;
    }

    return record.note ?? null;
  }

  private getSelectedElements() {
    return this.engine
      .getState()
      .selection.map((id) => this.getEngineElement(id))
      .filter((element): element is BoardElement => Boolean(element));
  }

  private getSelectedBounds() {
    const selectedElements = this.getSelectedElements();
    if (selectedElements.length === 0) {
      return null;
    }

    const left = Math.min(...selectedElements.map((element) => element.x));
    const top = Math.min(...selectedElements.map((element) => element.y));
    const right = Math.max(...selectedElements.map((element) => element.x + element.width));
    const bottom = Math.max(...selectedElements.map((element) => element.y + element.height));

    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }

  private refreshSelectionFrame() {
    const bounds = this.getSelectedBounds();
    if (!bounds) {
      this.selectionFrameNode.style.display = 'none';
      return;
    }

    this.selectionFrameNode.style.display = 'block';
    applyFrameLayout(this.selectionFrameNode, {
      x: (bounds.x + this.panOffset.x) * this.zoom,
      y: (bounds.y + this.panOffset.y) * this.zoom,
      width: bounds.width * this.zoom,
      height: bounds.height * this.zoom
    });
  }

  private placeCaretAtClientPoint(editor: HTMLDivElement, clientX: number, clientY: number) {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const documentWithCaretRange = document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const documentWithCaretPosition = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number
      ) => {
        offsetNode: Node;
        offset: number;
      } | null;
    };

    const caretPosition = documentWithCaretPosition.caretPositionFromPoint?.(clientX, clientY);
    if (caretPosition && editor.contains(caretPosition.offsetNode)) {
      const range = document.createRange();
      range.setStart(caretPosition.offsetNode, caretPosition.offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    const caretRange = documentWithCaretRange.caretRangeFromPoint?.(clientX, clientY);
    if (caretRange && editor.contains(caretRange.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(caretRange);
      return;
    }

    const fallbackRange = document.createRange();
    fallbackRange.selectNodeContents(editor);
    fallbackRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(fallbackRange);
  }

  private beginSelectionDrag(
    event: PointerEvent,
    noteId: string,
    options: {
      enableEditingOnTap?: (tapEvent: PointerEvent) => void;
    } = {}
  ) {
    if (event.button !== 0) {
      return;
    }

    const currentSelection = this.engine.getState().selection;
    if (!currentSelection.includes(noteId)) {
      this.selectSingleNote(noteId);
    } else {
      this.setSelection(currentSelection, noteId);
    }

    const selectedIds = this.engine.getState().selection;
    if (selectedIds.length === 0) {
      return;
    }

    const origin = { x: event.clientX, y: event.clientY };
    let hasStartedDrag = false;
    let appliedDelta: PointerDelta = { x: 0, y: 0 };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const rawDelta: PointerDelta = {
        x: moveEvent.clientX - origin.x,
        y: moveEvent.clientY - origin.y
      };

      if (!hasStartedDrag && Math.hypot(rawDelta.x, rawDelta.y) < 3) {
        return;
      }

      if (!hasStartedDrag) {
        hasStartedDrag = true;
        window.getSelection()?.removeAllRanges();
      }

      moveEvent.preventDefault();

      const delta = {
        x: rawDelta.x / this.zoom,
        y: rawDelta.y / this.zoom
      };

      const stepDelta = {
        x: delta.x - appliedDelta.x,
        y: delta.y - appliedDelta.y
      };
      appliedDelta = delta;
      this.dispatchAndSync({
        type: 'moveElements',
        ids: selectedIds,
        delta: stepDelta
      });

      this.refreshSelectionFrame();
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (!hasStartedDrag) {
        options.enableEditingOnTap?.(upEvent);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  private beginSelectionResize(event: PointerEvent, handle: ResizeHandlePosition) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const selected = this.getSelectedElements();
    const startBounds = this.getSelectedBounds();
    if (selected.length === 0 || !startBounds) {
      return;
    }

    const startingFrames = new Map(
      selected.map((element) => [
        element.id,
        {
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height
        }
      ])
    );

    const minimumWidth = Math.max(
      1,
      ...selected.map(
        (element) => (startBounds.width * MIN_NOTE_SIZE.width) / Math.max(element.width, 1)
      )
    );
    const minimumHeight = Math.max(
      1,
      ...selected.map(
        (element) => (startBounds.height * MIN_NOTE_SIZE.height) / Math.max(element.height, 1)
      )
    );

    const origin = { x: event.clientX, y: event.clientY };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = {
        x: (moveEvent.clientX - origin.x) / this.zoom,
        y: (moveEvent.clientY - origin.y) / this.zoom
      };
      const nextBounds = resizeFrame(startBounds, delta, handle, {
        width: minimumWidth,
        height: minimumHeight
      });
      const scaleX = nextBounds.width / startBounds.width;
      const scaleY = nextBounds.height / startBounds.height;
      const nextById = new Map<string, BoardElement>();

      selected.forEach((current) => {
        const frame = startingFrames.get(current.id);
        if (!frame) {
          return;
        }

        nextById.set(current.id, {
          ...current,
          x: nextBounds.x + (frame.x - startBounds.x) * scaleX,
          y: nextBounds.y + (frame.y - startBounds.y) * scaleY,
          width: frame.width * scaleX,
          height: frame.height * scaleY
        });
      });
      const nextElements = this.getEngineElementsInOrder().map((element) => {
        return nextById.get(element.id) ?? element;
      });
      this.dispatchAndSync({
        type: 'setElements',
        elements: nextElements
      });
      selected.forEach((element) => {
        this.records.get(element.id)?.scheduleAutoFit();
      });

      this.refreshSelectionFrame();
    };

    const onPointerUp = () => {
      selected.forEach((element) => {
        this.records.get(element.id)?.scheduleAutoFit();
      });
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  private shouldAllowDefaultTextCopy(note: NoteRecord) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }

    const anchor = selection.anchorNode;
    if (!anchor) {
      return false;
    }

    return note.editor.contains(anchor);
  }

  private getViewportBoardCenterPosition() {
    return {
      x: this.host.clientWidth / 2 / this.zoom - this.panOffset.x,
      y: this.host.clientHeight / 2 / this.zoom - this.panOffset.y
    };
  }

  private getImageFiles(transfer: Pick<DataTransfer, 'files' | 'items'> | null | undefined) {
    if (!transfer) {
      return [];
    }

    const files = Array.from(transfer.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length > 0) {
      return files;
    }

    return Array.from(transfer.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
  }

  private containsFileDropType(dataTransfer: DataTransfer | null | undefined) {
    if (!dataTransfer) {
      return false;
    }

    if (dataTransfer.files && dataTransfer.files.length > 0) {
      return true;
    }

    return Array.from(dataTransfer.types ?? []).includes('Files');
  }

  private addImageFilesAtPosition(files: File[], boardPosition: PointerDelta) {
    if (files.length === 0 || typeof URL.createObjectURL !== 'function') {
      return;
    }

    const createdIds: string[] = [];
    files.forEach((file, index) => {
      const src = URL.createObjectURL(file);
      const boundedPosition = this.boundPosition(
        {
          x: boardPosition.x + IMAGE_INSERT_OFFSET * index,
          y: boardPosition.y + IMAGE_INSERT_OFFSET * index
        },
        DEFAULT_IMAGE_SIZE
      );

      const element: ImageElement = {
        id: this.generateImageId(),
        kind: 'image',
        x: boundedPosition.x,
        y: boundedPosition.y,
        width: DEFAULT_IMAGE_SIZE.width,
        height: DEFAULT_IMAGE_SIZE.height,
        src,
        alt: file.name || 'Pasted image'
      };

      this.dispatchAndSync({
        type: 'addElement',
        element
      });
      createdIds.push(element.id);
    });

    const lastCreatedId = createdIds.at(-1);
    if (lastCreatedId) {
      this.selectSingleNote(lastCreatedId);
    }
  }

  private getClipboardUrl(clipboard: DataTransfer | null | undefined) {
    const rawText = clipboard?.getData('text/plain')?.trim();
    if (!rawText) {
      return null;
    }

    try {
      const url = new URL(rawText);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null;
      }
      return url.href;
    } catch {
      return null;
    }
  }

  private extractOpenGraphMeta(content: string, baseUrl: string) {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(content, 'text/html');
    const readMeta = (key: string) => {
      const node =
        documentNode.querySelector(`meta[property="${key}"]`) ??
        documentNode.querySelector(`meta[name="${key}"]`);
      const value = node?.getAttribute('content')?.trim();
      return value || null;
    };

    const resolveUrl = (value: string | null) => {
      if (!value) {
        return undefined;
      }

      try {
        return new URL(value, baseUrl).href;
      } catch {
        return undefined;
      }
    };

    const title = readMeta('og:title') ?? documentNode.title?.trim() ?? undefined;
    const description = readMeta('og:description') ?? undefined;
    const imageSrc = resolveUrl(readMeta('og:image'));

    if (!title && !description && !imageSrc) {
      return null;
    }

    return {
      title,
      description,
      imageSrc
    };
  }

  private async fetchLinkPreview(url: string) {
    const fetchCandidates = [url, `${ALL_ORIGINS_RAW_PROXY}${encodeURIComponent(url)}`];
    for (const candidate of fetchCandidates) {
      try {
        const response = await fetch(candidate);
        if (!response.ok) {
          continue;
        }
        const html = await response.text();
        const metadata = this.extractOpenGraphMeta(html, url);
        if (metadata) {
          return metadata;
        }
      } catch {
        // Try the next candidate URL.
      }
    }

    return null;
  }

  private async addLinkAtPosition(url: string, boardPosition: PointerDelta) {
    const boundedPosition = this.boundPosition(boardPosition, DEFAULT_LINK_SIZE);
    const id = this.generateLinkId();
    const element: LinkElement = {
      id,
      kind: 'link',
      x: boundedPosition.x,
      y: boundedPosition.y,
      width: DEFAULT_LINK_SIZE.width,
      height: DEFAULT_LINK_SIZE.height,
      url,
      title: url
    };
    this.dispatchAndSync({
      type: 'addElement',
      element
    });
    this.selectSingleNote(id);

    const preview = await this.fetchLinkPreview(url);
    if (!preview) {
      return;
    }

    const nextElements = this.getEngineElementsInOrder().map((current) => {
      if (current.id !== id || current.kind !== 'link') {
        return current;
      }

      return {
        ...current,
        title: preview.title ?? current.title,
        description: preview.description,
        imageSrc: preview.imageSrc,
        height: preview.imageSrc
          ? Math.max(current.height, DEFAULT_LINK_SIZE.height)
          : current.height
      };
    });

    this.dispatchAndSync({
      type: 'setElements',
      elements: nextElements
    });
  }

  private handleCopy = (event: ClipboardEvent) => {
    if (!this.shouldHandleBoardClipboard(event)) {
      return;
    }

    const note = this.getActiveNoteRecord();
    if (!note || this.shouldAllowDefaultTextCopy(note)) {
      return;
    }

    const payload = {
      kind: 'note',
      text: note.model.text,
      width: note.model.width,
      height: note.model.height,
      x: note.model.x,
      y: note.model.y
    };

    const clipboard = event.clipboardData;
    if (!clipboard) {
      this.lastCopiedNote = { ...note.model };
      return;
    }

    clipboard.setData(WIDEBOARD_NOTE_CLIPBOARD_MIME, JSON.stringify(payload));
    clipboard.setData('text/plain', note.model.text);
    this.lastCopiedNote = { ...note.model };
    event.preventDefault();
  };

  private handlePaste = (event: ClipboardEvent) => {
    if (!this.shouldHandleBoardClipboard(event)) {
      return;
    }

    const clipboard = event.clipboardData;
    const imageFiles = this.getImageFiles(clipboard);
    if (imageFiles.length > 0) {
      this.addImageFilesAtPosition(imageFiles, this.getViewportBoardCenterPosition());
      event.preventDefault();
      return;
    }

    const rawPayload = clipboard?.getData(WIDEBOARD_NOTE_CLIPBOARD_MIME);
    if (!rawPayload && !this.lastCopiedNote) {
      const pastedUrl = this.getClipboardUrl(clipboard);
      if (!pastedUrl) {
        return;
      }

      event.preventDefault();
      void this.addLinkAtPosition(pastedUrl, this.getViewportBoardCenterPosition());
      return;
    }

    let source: NoteElement | null = null;
    if (rawPayload) {
      try {
        const parsed = JSON.parse(rawPayload) as Partial<NoteElement> & { kind?: string };
        if (parsed.kind === 'note' && typeof parsed.text === 'string') {
          source = {
            id: this.generateNoteId(),
            kind: 'note',
            x: typeof parsed.x === 'number' ? parsed.x : 0,
            y: typeof parsed.y === 'number' ? parsed.y : 0,
            width: typeof parsed.width === 'number' ? parsed.width : 260,
            height: typeof parsed.height === 'number' ? parsed.height : 170,
            text: parsed.text
          };
        }
      } catch {
        source = null;
      }
    }

    if (!source && this.lastCopiedNote) {
      source = {
        ...this.lastCopiedNote,
        id: this.generateNoteId()
      };
    }

    if (!source) {
      return;
    }

    const offset = 24;
    const position = this.boundPosition(
      { x: source.x + offset, y: source.y + offset },
      { width: source.width, height: source.height }
    );

    const createdElement: NoteElement = {
      id: source.id,
      kind: 'note',
      x: position.x,
      y: position.y,
      width: source.width,
      height: source.height,
      text: source.text
    };
    this.dispatchAndSync({
      type: 'addElement',
      element: createdElement
    });
    this.selectSingleNote(createdElement.id);
    this.enableEditingForNoteById(createdElement.id, {
      selectAll: true
    });
    event.preventDefault();
  };

  private handleDragOver = (event: DragEvent) => {
    if (!this.isEventInsideHost(event)) {
      return;
    }

    if (!this.containsFileDropType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  private handleDrop = (event: DragEvent) => {
    if (!this.isEventInsideHost(event)) {
      return;
    }

    const imageFiles = this.getImageFiles(event.dataTransfer);
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();

    const bounds = this.host.getBoundingClientRect();
    const boardPosition = this.toBoardPosition({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    });

    this.addImageFilesAtPosition(imageFiles, boardPosition);
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    const normalizedKey = event.key.toLowerCase();
    const isDelete = event.key === 'Delete';
    const isAccelerator = event.ctrlKey || event.metaKey;
    const isUndo = isAccelerator && !event.shiftKey && normalizedKey === 'z';
    const isRedo =
      isAccelerator && (normalizedKey === 'y' || (event.shiftKey && normalizedKey === 'z'));
    if (!isDelete && !isUndo && !isRedo) {
      return;
    }

    if (!this.shouldHandleBoardKeyboard() || this.shouldAllowDefaultTextDelete(event)) {
      return;
    }

    if (isDelete && this.engine.getState().selection.length === 0) {
      return;
    }

    event.preventDefault();
    this.runEngineMutation(() => {
      if (isUndo) {
        return this.engine.undo();
      }

      if (isRedo) {
        return this.engine.redo();
      }

      return this.engine.handleKeyboard({
        type: 'keyboard',
        phase: 'down',
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey
      });
    });
  };

  private handlePanStart = (event: PointerEvent) => {
    if (event.button !== 1 && event.button !== 2) {
      return;
    }

    if (!this.isEventInsideHost(event)) {
      return;
    }

    const isRightButtonPan = event.button === 2;
    if (isRightButtonPan) {
      this.suppressContextMenuOnce = false;
    } else {
      event.preventDefault();
    }

    const origin = { x: event.clientX, y: event.clientY };
    let appliedDelta: PointerDelta = { x: 0, y: 0 };
    let hasDragged = false;
    this.host.style.cursor = 'grabbing';

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (
        !hasDragged &&
        Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) >= 3
      ) {
        hasDragged = true;
        if (isRightButtonPan) {
          this.suppressContextMenuOnce = true;
        }
      }

      if (!hasDragged) {
        return;
      }

      if (isRightButtonPan) {
        moveEvent.preventDefault();
      }

      const delta = {
        x: (moveEvent.clientX - origin.x) / this.zoom,
        y: (moveEvent.clientY - origin.y) / this.zoom
      };
      const stepDelta = {
        x: delta.x - appliedDelta.x,
        y: delta.y - appliedDelta.y
      };
      appliedDelta = delta;
      this.dispatchAndSync({
        type: 'panViewport',
        delta: stepDelta
      });
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      this.host.style.cursor = 'default';
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  private handleContextMenu = (event: MouseEvent) => {
    if (!this.isEventInsideHost(event)) {
      return;
    }

    if (this.suppressContextMenuOnce) {
      this.suppressContextMenuOnce = false;
      event.preventDefault();
    }
  };

  private handleZoom = (event: WheelEvent) => {
    if (!this.isEventInsideHost(event)) {
      return;
    }

    event.preventDefault();

    const bounds = this.host.getBoundingClientRect();
    const pointer = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    };

    const didMutate = this.runEngineMutation(() => {
      return this.engine.handleWheel({
        type: 'wheel',
        point: pointer,
        deltaX: event.deltaX,
        deltaY: event.deltaY
      });
    });
    if (didMutate) {
      this.scheduleAutoFitAll();
    }
  };

  public toBoardPosition(position: PointerDelta): PointerDelta {
    return {
      x: position.x / this.zoom - this.panOffset.x,
      y: position.y / this.zoom - this.panOffset.y
    };
  }

  private getIntersectingNoteIds(origin: PointerDelta, current: PointerDelta) {
    const left = Math.min(origin.x, current.x);
    const right = Math.max(origin.x, current.x);
    const top = Math.min(origin.y, current.y);
    const bottom = Math.max(origin.y, current.y);

    const state = this.engine.getState();
    return state.elementOrder
      .map((id) => state.elements[id])
      .filter((element) => {
        const noteLeft = (element.x + this.panOffset.x) * this.zoom;
        const noteTop = (element.y + this.panOffset.y) * this.zoom;
        const noteRight = noteLeft + element.width * this.zoom;
        const noteBottom = noteTop + element.height * this.zoom;

        return noteLeft <= right && noteRight >= left && noteTop <= bottom && noteBottom >= top;
      })
      .map((element) => element.id);
  }

  private updateMarquee(origin: PointerDelta, current: PointerDelta) {
    const marquee = this.marqueeNode;
    if (!marquee) {
      return;
    }

    const left = Math.min(origin.x, current.x);
    const top = Math.min(origin.y, current.y);
    const width = Math.abs(current.x - origin.x);
    const height = Math.abs(current.y - origin.y);

    marquee.style.left = `${left}px`;
    marquee.style.top = `${top}px`;
    marquee.style.width = `${width}px`;
    marquee.style.height = `${height}px`;
  }

  private selectSingleNote(noteId: string) {
    this.setSelection([noteId], noteId);
  }

  /* 📖 # Why render handles on the combined selection frame?
  Multi-selection should feel like manipulating one grouped shape.
  Drawing handles on the selection bounds keeps resize/drag affordances in a single, predictable place.
  */
  private setSelection(noteIds: Iterable<string>, preferredActiveNoteId: string | null = null) {
    const noteIdList = Array.from(noteIds);
    if (preferredActiveNoteId) {
      this.activeNoteId = preferredActiveNoteId;
    }
    this.dispatchAndSync(
      {
        type: 'select',
        ids: noteIdList
      },
      {
        resetEditing: true
      }
    );
  }

  private setSelectionPreservingEditing(
    noteIds: Iterable<string>,
    preferredActiveNoteId: string | null = null
  ) {
    const noteIdList = Array.from(noteIds);
    if (preferredActiveNoteId) {
      this.activeNoteId = preferredActiveNoteId;
    }
    this.dispatchAndSync(
      {
        type: 'select',
        ids: noteIdList
      },
      {
        resetEditing: false
      }
    );
  }

  private getSelectionIds() {
    return [...this.engine.getState().selection];
  }

  private enableEditingForNoteById(noteId: string, options: { selectAll?: boolean } = {}) {
    requestAnimationFrame(() => {
      const record = this.records.get(noteId);
      if (record?.kind === 'note' && record.note) {
        this.enableNoteEditing(record.note);
        if (options.selectAll) {
          const selection = window.getSelection();
          if (!selection) {
            return;
          }

          const range = document.createRange();
          range.selectNodeContents(record.note.editor);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });
  }

  private commitNoteText(noteId: string, text: string) {
    const nextElements = this.getEngineElementsInOrder().map((engineElement) => {
      if (engineElement.id !== noteId || engineElement.kind !== 'note') {
        return engineElement;
      }

      return {
        ...engineElement,
        text
      };
    });
    this.dispatchAndSync({
      type: 'setElements',
      elements: nextElements
    });
  }

  private enableNoteEditing(
    note: NoteRecord,
    options: {
      caretClientPoint?: {
        x: number;
        y: number;
      };
    } = {}
  ) {
    note.setEditingEnabled(true);
    note.editor.focus();
    if (options.caretClientPoint) {
      this.placeCaretAtClientPoint(
        note.editor,
        options.caretClientPoint.x,
        options.caretClientPoint.y
      );
    }
  }

  private createNote(element: NoteElement): BoardRecord {
    const note = createBoardNoteRecord(element, {
      applyLayout: (node, frame) => this.applyFrameWithPan(node, frame),
      callbacks: {
        getSelection: () => this.getSelectionIds(),
        setSelectionPreservingEditing: (ids, preferredActiveNoteId) => {
          this.setSelectionPreservingEditing(ids, preferredActiveNoteId);
        },
        beginSelectionDrag: (event, noteId, options) => {
          this.beginSelectionDrag(event, noteId, options);
        },
        enableEditing: (noteRecord, options) => {
          this.enableNoteEditing(noteRecord, options);
        },
        updateNoteText: (noteId, text) => {
          this.commitNoteText(noteId, text);
        }
      }
    });

    const record: BoardRecord = {
      id: note.model.id,
      kind: 'note',
      node: note.node,
      note,
      scheduleAutoFit: () => note.scheduleAutoFit()
    };
    this.host.append(note.node);
    this.applyFrameWithPan(note.node, note.model);
    note.scheduleAutoFit();
    this.records.set(note.model.id, record);
    return record;
  }

  private createImage(element: ImageElement): BoardRecord {
    const image = createBoardImageRecord(element, {
      applyLayout: (node, frame) => this.applyFrameWithPan(node, frame),
      callbacks: {
        beginSelectionDrag: (event, elementId) => {
          this.beginSelectionDrag(event, elementId);
        }
      }
    });

    const record: BoardRecord = {
      id: image.model.id,
      kind: 'image',
      node: image.node,
      image,
      scheduleAutoFit: () => {}
    };

    this.host.append(image.node);
    this.applyFrameWithPan(image.node, image.model);
    this.records.set(image.model.id, record);

    return record;
  }

  private createLink(element: LinkElement): BoardRecord {
    const link = createBoardLinkRecord(element, {
      applyLayout: (node, frame) => this.applyFrameWithPan(node, frame),
      callbacks: {
        beginSelectionDrag: (event, elementId) => {
          this.beginSelectionDrag(event, elementId);
        }
      }
    });

    const record: BoardRecord = {
      id: link.model.id,
      kind: 'link',
      node: link.node,
      link,
      scheduleAutoFit: () => {}
    };

    this.host.append(link.node);
    this.applyFrameWithPan(link.node, link.model);
    this.records.set(link.model.id, record);

    return record;
  }
}

export function BoardComponent({
  boardId = 'welcome',
  initialElements,
  onEngineReady,
  onBoardPointerMove,
  remotePointers = []
}: BoardComponentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isDebugOverlayOpen, setIsDebugOverlayOpen] = useState(false);
  const [activeDebugTab, setActiveDebugTab] = useState<DebugOverlayTab>('raw_state');
  const [debugBoardState, setDebugBoardState] = useState<BoardState | null>(null);
  const [debugLastUpdate, setDebugLastUpdate] = useState<BoardEngineUpdate | null>(null);
  const [debugHistory, setDebugHistory] = useState<BoardEngineHistorySnapshot>({
    cursor: -1,
    entries: []
  });
  const elementSnapshotRef = useRef<BoardElement[]>(
    initialElements?.map((item) => ({ ...item })) ?? [{ ...DEFAULT_ELEMENT }]
  );

  const debugRawStateText = useMemo(() => {
    if (activeDebugTab !== 'raw_state' || !debugBoardState) {
      return '';
    }

    return toStableJson(debugBoardState);
  }, [activeDebugTab, debugBoardState]);

  const debugLastUpdateText = useMemo(() => {
    if (activeDebugTab !== 'last_update' || !debugLastUpdate) {
      return '';
    }

    return toStableJson(debugLastUpdate);
  }, [activeDebugTab, debugLastUpdate]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const renderer = new BoardRenderer(host, elementSnapshotRef.current);
    rendererRef.current = renderer;
    const engine = renderer.getEngine();
    setDebugBoardState(cloneBoardState(engine.getState()));
    setDebugHistory(engine.getHistorySnapshot());
    const unsubscribeFromDebugUpdates = engine.subscribe((update) => {
      setDebugBoardState(cloneBoardState(engine.getState()));
      setDebugHistory(engine.getHistorySnapshot());
      setDebugLastUpdate({
        revision: update.revision,
        deltas: JSON.parse(JSON.stringify(update.deltas))
      });
    });

    onEngineReady?.(engine);

    return () => {
      rendererRef.current = null;
      unsubscribeFromDebugUpdates();
      renderer.destroy();
    };
  }, [onEngineReady]);

  const noteCursor =
    'url(\'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="28" height="32" viewBox="0 0 28 32"%3E%3Cpath d="M4 1h20a3 3 0 0 1 3 3v15l-8 11H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z" fill="%23dff7ff" stroke="%23194467" stroke-width="2"/%3E%3Cpath d="M19 19h8l-8 11z" fill="%23b7dff7"/%3E%3C/svg%3E\') 4 2, crosshair';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      {/* 📖 # Why keep toolbar UI in React while notes render imperatively?
      The toolbar changes infrequently and benefits from declarative React handlers,
      while note movement and resizing stay in the imperative renderer for direct DOM updates.
      */}
      <div
        role="toolbar"
        aria-label="Board tools"
        data-testid="board-toolbar"
        style={{
          position: 'absolute',
          top: '50%',
          left: '1rem',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.55rem',
          padding: '0.65rem',
          borderRadius: '12px',
          background: 'rgba(22, 52, 84, 0.84)',
          boxShadow: '0 14px 30px rgba(14, 45, 82, 0.3)',
          zIndex: '20'
        }}
      >
        <button
          type="button"
          data-testid="create-note-action"
          aria-pressed={isAddingNote}
          onClick={() => setIsAddingNote((value) => !value)}
          style={{
            border: 'none',
            borderRadius: '8px',
            padding: '0.5rem 0.72rem',
            background: isAddingNote ? '#79dbff' : '#d7f3ff',
            color: '#123c63',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          + Note
        </button>
      </div>
      <div
        data-testid="board-debug-controls"
        style={{
          position: 'absolute',
          right: '1rem',
          bottom: '1rem',
          zIndex: '30'
        }}
      >
        <button
          type="button"
          data-testid="board-debug-toggle"
          aria-pressed={isDebugOverlayOpen}
          onClick={() => setIsDebugOverlayOpen((value) => !value)}
          style={{
            border: 'none',
            borderRadius: '999px',
            padding: '0.55rem 0.85rem',
            background: isDebugOverlayOpen ? '#1a446b' : '#173d5f',
            color: '#ecf8ff',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: '0 8px 18px rgba(16, 46, 76, 0.34)'
          }}
        >
          Debug
        </button>
      </div>
      {isDebugOverlayOpen ? (
        <section
          aria-label="Board debug overlay"
          data-testid="board-debug-overlay"
          style={{
            position: 'absolute',
            right: '1rem',
            bottom: '4rem',
            width: 'min(30rem, calc(100% - 2rem))',
            maxHeight: '65vh',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '12px',
            border: '1px solid rgba(22, 55, 88, 0.45)',
            background: 'rgba(248, 253, 255, 0.97)',
            boxShadow: '0 22px 44px rgba(13, 45, 74, 0.3)',
            overflow: 'hidden',
            zIndex: '31'
          }}
        >
          <header
            style={{
              display: 'flex',
              gap: '0.45rem',
              padding: '0.5rem',
              borderBottom: '1px solid rgba(22, 55, 88, 0.2)'
            }}
          >
            <button
              type="button"
              data-testid="board-debug-tab-raw-state"
              aria-pressed={activeDebugTab === 'raw_state'}
              onClick={() => setActiveDebugTab('raw_state')}
              style={{
                border: 'none',
                borderRadius: '8px',
                padding: '0.4rem 0.55rem',
                background: activeDebugTab === 'raw_state' ? '#0e567d' : '#dceefa',
                color: activeDebugTab === 'raw_state' ? '#f1faff' : '#1b486f',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Raw state
            </button>
            <button
              type="button"
              data-testid="board-debug-tab-last-update"
              aria-pressed={activeDebugTab === 'last_update'}
              onClick={() => setActiveDebugTab('last_update')}
              style={{
                border: 'none',
                borderRadius: '8px',
                padding: '0.4rem 0.55rem',
                background: activeDebugTab === 'last_update' ? '#0e567d' : '#dceefa',
                color: activeDebugTab === 'last_update' ? '#f1faff' : '#1b486f',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Last update
            </button>
            <button
              type="button"
              data-testid="board-debug-tab-undo-stack"
              aria-pressed={activeDebugTab === 'undo_stack'}
              onClick={() => setActiveDebugTab('undo_stack')}
              style={{
                border: 'none',
                borderRadius: '8px',
                padding: '0.4rem 0.55rem',
                background: activeDebugTab === 'undo_stack' ? '#0e567d' : '#dceefa',
                color: activeDebugTab === 'undo_stack' ? '#f1faff' : '#1b486f',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Undo stack
            </button>
          </header>
          <div
            style={{
              padding: '0.6rem',
              overflow: 'auto',
              fontFamily: '"Cascadia Mono", "Consolas", monospace',
              fontSize: '0.76rem',
              lineHeight: 1.4
            }}
          >
            {activeDebugTab === 'raw_state' ? (
              <pre data-testid="board-debug-raw-state-panel" style={{ margin: 0 }}>
                {debugRawStateText}
              </pre>
            ) : null}
            {activeDebugTab === 'last_update' ? (
              debugLastUpdate ? (
                <pre data-testid="board-debug-last-update-panel" style={{ margin: 0 }}>
                  {debugLastUpdateText}
                </pre>
              ) : (
                <p data-testid="board-debug-last-update-empty" style={{ margin: 0 }}>
                  No board updates captured yet.
                </p>
              )
            ) : null}
            {activeDebugTab === 'undo_stack' ? (
              <div data-testid="board-debug-undo-stack-panel">
                {debugHistory.entries.length === 0 ? (
                  <p data-testid="board-debug-undo-stack-empty" style={{ margin: 0 }}>
                    No undo history yet.
                  </p>
                ) : (
                  <>
                    <p
                      data-testid="board-debug-undo-stack-position"
                      style={{ margin: '0 0 0.5rem' }}
                    >
                      Position: {debugHistory.cursor} / {debugHistory.entries.length - 1}
                    </p>
                    <ol
                      data-testid="board-debug-undo-stack-list"
                      style={{ margin: 0, paddingLeft: '1.25rem' }}
                    >
                      {debugHistory.entries.map((entry) => {
                        const isCurrent = entry.index === debugHistory.cursor;
                        return (
                          <li
                            key={`history-entry-${entry.index}`}
                            data-testid={`board-debug-undo-stack-entry-${entry.index}`}
                            data-current={isCurrent ? 'true' : 'false'}
                            style={{
                              padding: '0.3rem 0.4rem',
                              borderRadius: '6px',
                              background: isCurrent ? 'rgba(41, 159, 214, 0.2)' : 'transparent'
                            }}
                          >
                            #{entry.index} {entry.meta.kind}
                            {entry.meta.groupId ? ` (${entry.meta.groupId})` : ''} | forward:
                            {' ' + entry.forward.length} | backward: {entry.backward.length}
                          </li>
                        );
                      })}
                    </ol>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      <div
        ref={hostRef}
        data-testid="board-component"
        data-board-id={boardId}
        onPointerMove={(event) => {
          const renderer = rendererRef.current;
          if (!renderer || !onBoardPointerMove) {
            return;
          }

          const bounds = event.currentTarget.getBoundingClientRect();
          const boardPosition = renderer.toBoardPosition({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top
          });
          onBoardPointerMove(boardPosition);
        }}
        onPointerDown={(event) => {
          const renderer = rendererRef.current;
          if (!renderer) {
            return;
          }

          if (!isAddingNote) {
            if (event.target === event.currentTarget) {
              renderer.beginMarqueeSelection(event.nativeEvent);
            }
            return;
          }

          if (event.target !== event.currentTarget) {
            return;
          }

          const bounds = event.currentTarget.getBoundingClientRect();
          const boardPosition = renderer.toBoardPosition({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top
          });
          renderer.createTextNoteAt(boardPosition);
          setIsAddingNote(false);
        }}
        style={{ width: '100%', height: '100vh', cursor: isAddingNote ? noteCursor : 'default' }}
      >
        {debugBoardState
          ? remotePointers.map((pointer) => {
              const x = (pointer.x + debugBoardState.viewport.panX) * debugBoardState.viewport.zoom;
              const y = (pointer.y + debugBoardState.viewport.panY) * debugBoardState.viewport.zoom;
              return (
                <div
                  key={pointer.participantId}
                  style={{
                    position: 'absolute',
                    left: `${x}px`,
                    top: `${y}px`,
                    width: 0,
                    height: 0,
                    pointerEvents: 'none',
                    zIndex: 25
                  }}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    style={{
                      position: 'absolute',
                      left: '-1px',
                      top: '-1px',
                      width: '20px',
                      height: '20px',
                      overflow: 'visible'
                    }}
                  >
                    <path
                      d="M2.5 2.5L2.5 16.8L6.7 12.8L10.3 19L12.9 17.6L9.4 11.7L15.8 11.7L2.5 2.5Z"
                      fill="#ff4f4f"
                      stroke="#b82424"
                      strokeWidth="1.1"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span
                    style={{
                      position: 'absolute',
                      left: '14px',
                      top: '10px',
                      padding: '0.15rem 0.4rem',
                      borderRadius: '0.4rem',
                      background: 'rgba(255, 79, 79, 0.92)',
                      color: '#fff',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      fontFamily: 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif'
                    }}
                  >
                    {pointer.name}
                  </span>
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}
