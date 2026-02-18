import { useEffect, useRef, useState } from 'react';

export interface NoteElement {
  id: string;
  kind: 'note';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export type BoardElement = NoteElement;

export interface BoardComponentProps {
  boardId?: string;
  initialElements?: BoardElement[];
}

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

const MIN_NOTE_SIZE: Size = {
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

interface NoteRecord {
  model: NoteElement;
  node: HTMLDivElement;
  editor: HTMLDivElement;
  resizeHandle: HTMLDivElement;
}

export function moveElement(element: NoteElement, pointerDelta: Point): NoteElement {
  return {
    ...element,
    x: element.x + pointerDelta.x,
    y: element.y + pointerDelta.y
  };
}

export function resizeElement(
  element: NoteElement,
  pointerDelta: Point,
  minimumSize: Size = MIN_NOTE_SIZE
): NoteElement {
  return {
    ...element,
    width: Math.max(minimumSize.width, element.width + pointerDelta.x),
    height: Math.max(minimumSize.height, element.height + pointerDelta.y)
  };
}

class BoardRenderer {
  private readonly host: HTMLDivElement;

  private readonly records = new Map<string, NoteRecord>();

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

  public createTextNoteAt(position: Point) {
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

    created.editor.focus();
  }

  private boundPosition(position: Point, size: Size): Point {
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

  private createNote(element: NoteElement): NoteRecord {
    const node = document.createElement('div');
    node.dataset.elementId = element.id;
    node.style.position = 'absolute';
    node.style.boxSizing = 'border-box';
    node.style.border = '1px solid rgba(53, 42, 27, 0.35)';
    node.style.borderRadius = '10px';
    node.style.background = 'rgba(255, 255, 255, 0.93)';
    node.style.boxShadow = '0 10px 24px rgba(53, 42, 27, 0.16)';
    node.style.touchAction = 'none';
    node.style.userSelect = 'none';

    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.spellcheck = false;
    editor.textContent = element.text;
    editor.style.width = '100%';
    editor.style.height = '100%';
    editor.style.boxSizing = 'border-box';
    editor.style.padding = '12px 14px 20px 14px';
    editor.style.outline = 'none';
    editor.style.borderRadius = '10px';
    editor.style.overflow = 'auto';
    editor.style.cursor = 'text';
    editor.style.userSelect = 'text';
    editor.style.whiteSpace = 'pre-wrap';
    editor.style.fontFamily = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
    editor.style.color = '#2f2618';
    editor.style.lineHeight = '1.45';
    editor.style.fontSize = '15px';
    editor.dataset.testid = `note-editor-${element.id}`;

    const resizeHandle = document.createElement('div');
    resizeHandle.style.position = 'absolute';
    resizeHandle.style.right = '2px';
    resizeHandle.style.bottom = '2px';
    resizeHandle.style.width = '16px';
    resizeHandle.style.height = '16px';
    resizeHandle.style.borderRadius = '4px';
    resizeHandle.style.background = 'rgba(47, 38, 24, 0.4)';
    resizeHandle.style.cursor = 'nwse-resize';

    const model = { ...element };
    const record: NoteRecord = { model, node, editor, resizeHandle };
    this.applyLayout(record);

    editor.addEventListener('input', () => {
      model.text = editor.textContent ?? '';
    });

    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      const targetNode = event.target as Node;
      if (targetNode === resizeHandle || resizeHandle.contains(targetNode)) {
        return;
      }

      if (targetNode === editor || editor.contains(targetNode)) {
        return;
      }

      event.preventDefault();
      const origin = { x: event.clientX, y: event.clientY };
      const startingState = { ...record.model };

      const onPointerMove = (moveEvent: PointerEvent) => {
        const delta = {
          x: moveEvent.clientX - origin.x,
          y: moveEvent.clientY - origin.y
        };
        record.model = moveElement(startingState, delta);
        this.applyLayout(record);
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });

    resizeHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const origin = { x: event.clientX, y: event.clientY };
      const startingState = { ...record.model };

      const onPointerMove = (moveEvent: PointerEvent) => {
        const delta = {
          x: moveEvent.clientX - origin.x,
          y: moveEvent.clientY - origin.y
        };
        record.model = resizeElement(startingState, delta);
        this.applyLayout(record);
      };

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });

    node.append(editor, resizeHandle);
    this.host.append(node);
    this.records.set(model.id, record);
    return record;
  }

  private applyLayout(record: NoteRecord) {
    record.node.style.left = `${record.model.x}px`;
    record.node.style.top = `${record.model.y}px`;
    record.node.style.width = `${record.model.width}px`;
    record.node.style.height = `${record.model.height}px`;
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
          if (!isAddingNote) {
            return;
          }

          if (event.target !== event.currentTarget) {
            return;
          }

          const renderer = rendererRef.current;
          if (!renderer) {
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
