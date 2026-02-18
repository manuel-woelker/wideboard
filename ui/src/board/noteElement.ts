import { applyFrameLayout, moveFrame, type PointerDelta } from './elementFrame';

export interface NoteElement {
  id: string;
  kind: 'note';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface NoteRecord {
  model: NoteElement;
  node: HTMLDivElement;
  editor: HTMLDivElement;
}

/* 📖 # Why isolate note DOM behavior in a separate module?
Board orchestration should stay focused on element lifecycle and tool actions.
Note rendering only needs a frame and content; board-level concerns such as resize handles stay outside.
*/
export function createNoteRecord(element: NoteElement): NoteRecord {
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

  const model = { ...element };
  const record: NoteRecord = { model, node, editor };
  applyFrameLayout(record.node, record.model);

  editor.addEventListener('input', () => {
    model.text = editor.textContent ?? '';
  });

  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }

    const targetNode = event.target as Node;
    if (targetNode === editor || editor.contains(targetNode)) {
      return;
    }

    event.preventDefault();
    const origin = { x: event.clientX, y: event.clientY };
    const startingState = { ...record.model };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta: PointerDelta = {
        x: moveEvent.clientX - origin.x,
        y: moveEvent.clientY - origin.y
      };
      record.model = {
        ...record.model,
        ...moveFrame(startingState, delta)
      };
      applyFrameLayout(record.node, record.model);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });

  node.append(editor);
  return record;
}
