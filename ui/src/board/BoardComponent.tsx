import { useEffect, useRef, useState } from 'react';
import {
  ALL_RESIZE_HANDLES,
  applyFrameLayout,
  createResizeHandle,
  resizeFrame,
  type MinimumSize,
  type PointerDelta,
  type ResizeHandlePosition
} from './elementFrame';
import { createNoteRecord, type NoteElement, type NoteRecord } from './noteElement';
export type { NoteElement } from './noteElement';

export type BoardElement = NoteElement;

export interface BoardComponentProps {
  boardId?: string;
  initialElements?: BoardElement[];
}

const MIN_NOTE_SIZE: MinimumSize = {
  width: 120,
  height: 80
};

const DEFAULT_ELEMENT: NoteElement = {
  id: 'note-1',
  kind: 'note',
  x: 120,
  y: 100,
  width: 260,
  height: 180,
  text: 'Double-click or type to edit this note.'
};

interface BoardRecord {
  note: NoteRecord;
  resizeHandles: ReadonlyArray<{ position: ResizeHandlePosition; node: HTMLDivElement }>;
}

class BoardRenderer {
  private readonly host: HTMLDivElement;

  private readonly records = new Map<string, BoardRecord>();

  private activeNoteId: string | null = null;

  private noteSequence = 1;

  public constructor(host: HTMLDivElement, initialElements: BoardElement[]) {
    this.host = host;
    this.host.style.position = 'relative';
    this.host.style.width = '100%';
    this.host.style.height = '100%';
    this.host.style.overflow = 'hidden';
    this.host.style.background =
      'radial-gradient(circle at 20% 0%, #f8f3e8 0%, #efe7d5 40%, #e0d2b7 100%)';

    this.noteSequence = this.deriveInitialNoteSequence(initialElements);

    initialElements.forEach((element) => {
      if (element.kind === 'note') {
        this.createNote(element);
      }
    });
  }

  public destroy() {
    this.records.clear();
    this.host.replaceChildren();
  }

  public createTextNoteAt(position: PointerDelta) {
    const boundedPosition = this.boundPosition(position, { width: 260, height: 170 });
    const created = this.createNote({
      id: this.generateNoteId(),
      kind: 'note',
      x: boundedPosition.x,
      y: boundedPosition.y,
      width: 260,
      height: 170,
      text: 'New note'
    });

    this.setActiveNote(created.note.model.id);
    created.note.editor.focus();
  }

  public clearActiveNote() {
    this.setActiveNote(null);
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

  private generateNoteId() {
    while (this.records.has(`note-${this.noteSequence}`)) {
      this.noteSequence += 1;
    }

    const id = `note-${this.noteSequence}`;
    this.noteSequence += 1;
    return id;
  }

  /* 📖 # Why render resize handles only for the active note?
  Showing handles for every note creates visual noise and makes intent unclear.
  Keeping handles mounted only on the active note matches direct-manipulation UX patterns.
  */
  private setActiveNote(noteId: string | null) {
    this.activeNoteId = noteId;
    this.records.forEach((record, recordId) => {
      const isActive = noteId === recordId;
      record.resizeHandles.forEach(({ node }) => {
        const isAttached = node.parentElement === record.note.node;
        if (isActive && !isAttached) {
          record.note.node.append(node);
        } else if (!isActive && isAttached) {
          node.remove();
        }
      });
    });
  }

  private createNote(element: NoteElement): BoardRecord {
    const note = createNoteRecord(element);
    const resizeHandles = ALL_RESIZE_HANDLES.map((position) => ({
      position,
      node: createResizeHandle(position)
    }));

    resizeHandles.forEach(({ position, node: handleNode }) => {
      handleNode.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const origin = { x: event.clientX, y: event.clientY };
        const startingState = { ...note.model };

        const onPointerMove = (moveEvent: PointerEvent) => {
          const delta = {
            x: moveEvent.clientX - origin.x,
            y: moveEvent.clientY - origin.y
          };
          note.model = {
            ...note.model,
            ...resizeFrame(startingState, delta, position, MIN_NOTE_SIZE)
          };
          applyFrameLayout(note.node, note.model);
        };

        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    });

    note.node.addEventListener('pointerdown', () => {
      this.setActiveNote(note.model.id);
    });

    const record: BoardRecord = { note, resizeHandles };
    this.host.append(note.node);
    this.records.set(note.model.id, record);
    if (this.activeNoteId === null) {
      this.setActiveNote(note.model.id);
    }
    return record;
  }
}

export function BoardComponent({ boardId = 'welcome', initialElements }: BoardComponentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const elementSnapshotRef = useRef<BoardElement[]>(
    initialElements?.map((item) => ({ ...item })) ?? [{ ...DEFAULT_ELEMENT }]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const renderer = new BoardRenderer(host, elementSnapshotRef.current);
    rendererRef.current = renderer;

    return () => {
      rendererRef.current = null;
      renderer.destroy();
    };
  }, []);

  const noteCursor =
    'url(\'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="28" height="32" viewBox="0 0 28 32"%3E%3Cpath d="M4 1h20a3 3 0 0 1 3 3v15l-8 11H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3Z" fill="%23f6e7c8" stroke="%232f2618" stroke-width="2"/%3E%3Cpath d="M19 19h8l-8 11z" fill="%23e0d2b7"/%3E%3C/svg%3E\') 4 2, crosshair';

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
          background: 'rgba(37, 31, 19, 0.8)',
          boxShadow: '0 14px 30px rgba(26, 20, 12, 0.24)',
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
            background: isAddingNote ? '#e8cf9c' : '#f6e7c8',
            color: '#2f2618',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          + Note
        </button>
      </div>
      <div
        ref={hostRef}
        data-testid="board-component"
        data-board-id={boardId}
        onPointerDown={(event) => {
          const renderer = rendererRef.current;
          if (!renderer) {
            return;
          }

          if (!isAddingNote) {
            if (event.target === event.currentTarget) {
              renderer.clearActiveNote();
            }
            return;
          }

          if (event.target !== event.currentTarget) {
            return;
          }

          const bounds = event.currentTarget.getBoundingClientRect();
          renderer.createTextNoteAt({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top
          });
          setIsAddingNote(false);
        }}
        style={{ width: '100%', height: '100vh', cursor: isAddingNote ? noteCursor : 'default' }}
      />
    </div>
  );
}
