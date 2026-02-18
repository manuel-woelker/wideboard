import { useEffect, useRef } from 'react';

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

  public constructor(host: HTMLDivElement, initialElements: BoardElement[]) {
    this.host = host;
    this.host.style.position = 'relative';
    this.host.style.width = '100%';
    this.host.style.height = '100%';
    this.host.style.overflow = 'hidden';
    this.host.style.background =
      'radial-gradient(circle at 20% 0%, #f8f3e8 0%, #efe7d5 40%, #e0d2b7 100%)';

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

  private createNote(element: NoteElement) {
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
  }

  private applyLayout(record: NoteRecord) {
    record.node.style.left = `${record.model.x}px`;
    record.node.style.top = `${record.model.y}px`;
    record.node.style.width = `${record.model.width}px`;
    record.node.style.height = `${record.model.height}px`;
  }
}

export function BoardComponent({ initialElements }: BoardComponentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const elementSnapshotRef = useRef<BoardElement[]>(
    initialElements?.map((item) => ({ ...item })) ?? [{ ...DEFAULT_ELEMENT }]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const renderer = new BoardRenderer(host, elementSnapshotRef.current);
    return () => renderer.destroy();
  }, []);

  return <div ref={hostRef} data-testid="board-component" />;
}
