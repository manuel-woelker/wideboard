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
  autoFitText: () => number | null;
  scheduleAutoFit: () => void;
}

const AUTO_FIT_MIN_SIZE = 12;
const AUTO_FIT_ITERATIONS = 8;

function canMeasureEditor(editor: HTMLDivElement) {
  return editor.isConnected && editor.clientWidth > 0 && editor.clientHeight > 0;
}

function editorTextFits(editor: HTMLDivElement) {
  return editor.scrollHeight <= editor.clientHeight && editor.scrollWidth <= editor.clientWidth;
}

/* 📖 # Why scale max font size from the editor bounds?
Notes can be resized far beyond the old fixed cap, so we let the largest fitting size
grow with the available space while still clamping to a safe minimum.
*/
function getAutoFitMaxSize(editor: HTMLDivElement, minSize: number) {
  return Math.max(minSize, Math.floor(Math.min(editor.clientWidth, editor.clientHeight)));
}

/* 📖 # Why use a bounded binary search for auto-fit sizing?
We want the largest readable font size that still fits, and binary search keeps this fast
even when auto-fitting on every edit or resize end.
*/
export function autoFitNoteEditor(
  editor: HTMLDivElement,
  options: { minSize?: number; maxSize?: number } = {}
) {
  if (!canMeasureEditor(editor)) {
    return null;
  }

  const minSize = options.minSize ?? AUTO_FIT_MIN_SIZE;
  const maxSize = options.maxSize ?? getAutoFitMaxSize(editor, minSize);
  let low = minSize;
  let high = maxSize;
  let best = minSize;

  for (let iteration = 0; iteration < AUTO_FIT_ITERATIONS && low <= high; iteration += 1) {
    const mid = Math.floor((low + high) / 2);
    editor.style.fontSize = `${mid}px`;

    if (editorTextFits(editor)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  editor.style.fontSize = `${best}px`;
  return best;
}

function createAutoFitScheduler(autoFit: () => number | null) {
  let pendingFrame: number | null = null;

  return () => {
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame);
    }

    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      autoFit();
    });
  };
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
  node.style.border = '1px solid rgba(25, 79, 125, 0.32)';
  node.style.borderRadius = '10px';
  node.style.background = 'rgba(247, 253, 255, 0.95)';
  node.style.boxShadow = '0 10px 24px rgba(25, 79, 125, 0.14)';
  node.style.touchAction = 'none';
  node.style.userSelect = 'none';
  node.style.cursor = 'grab';

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
  editor.style.overflow = 'hidden';
  editor.style.cursor = 'text';
  editor.style.userSelect = 'text';
  editor.style.whiteSpace = 'pre-wrap';
  editor.style.fontFamily = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
  editor.style.color = '#133a5d';
  editor.style.lineHeight = '1.45';
  editor.style.fontSize = '15px';
  editor.dataset.testid = `note-editor-${element.id}`;

  const autoFitText = () => autoFitNoteEditor(editor);
  const scheduleAutoFit = createAutoFitScheduler(autoFitText);

  const model = { ...element };
  const record: NoteRecord = { model, node, editor, autoFitText, scheduleAutoFit };
  applyFrameLayout(record.node, record.model);

  editor.addEventListener('input', () => {
    model.text = editor.textContent ?? '';
    scheduleAutoFit();
  });

  const beginDrag = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== -1) {
      return;
    }

    const origin = { x: event.clientX, y: event.clientY };
    const startingState = { ...record.model };
    let hasStartedDrag = false;

    node.style.cursor = 'grabbing';

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta: PointerDelta = {
        x: moveEvent.clientX - origin.x,
        y: moveEvent.clientY - origin.y
      };

      if (!hasStartedDrag && Math.hypot(delta.x, delta.y) < 3) {
        return;
      }

      if (!hasStartedDrag) {
        hasStartedDrag = true;
        editor.style.userSelect = 'none';
        window.getSelection()?.removeAllRanges();
      }

      moveEvent.preventDefault();
      record.model = {
        ...record.model,
        ...moveFrame(startingState, delta)
      };
      applyFrameLayout(record.node, record.model);
    };

    const pointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;

    const onPointerUp = () => {
      editor.style.userSelect = 'text';
      node.style.cursor = 'grab';
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointerup', onPointerUp);
      node.removeEventListener('pointercancel', onPointerUp);

      if (
        pointerId !== null &&
        typeof node.releasePointerCapture === 'function' &&
        node.hasPointerCapture(pointerId)
      ) {
        node.releasePointerCapture(pointerId);
      }
    };

    if (pointerId !== null && typeof node.setPointerCapture === 'function') {
      node.setPointerCapture(pointerId);
    }

    node.addEventListener('pointermove', onPointerMove);
    node.addEventListener('pointerup', onPointerUp);
    node.addEventListener('pointercancel', onPointerUp);
  };

  node.addEventListener('pointerdown', beginDrag);

  node.append(editor);
  return record;
}

if (import.meta.vitest) {
  const { afterEach, describe, expect, it } = import.meta.vitest;

  describe('autoFitNoteEditor', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('shrinks text to the largest size that fits', () => {
      const editor = document.createElement('div');
      document.body.append(editor);

      Object.defineProperty(editor, 'clientHeight', {
        value: 100,
        configurable: true
      });
      Object.defineProperty(editor, 'clientWidth', {
        value: 100,
        configurable: true
      });
      Object.defineProperty(editor, 'scrollHeight', {
        get: () => Math.ceil(Number.parseFloat(editor.style.fontSize || '0') * 6),
        configurable: true
      });
      Object.defineProperty(editor, 'scrollWidth', {
        get: () => Math.ceil(Number.parseFloat(editor.style.fontSize || '0') * 5),
        configurable: true
      });

      const fitted = autoFitNoteEditor(editor, { minSize: 10, maxSize: 30 });

      expect(fitted).toBe(16);
      expect(editor.style.fontSize).toBe('16px');
    });

    it('uses the editor bounds to pick a default max size', () => {
      const editor = document.createElement('div');
      document.body.append(editor);

      Object.defineProperty(editor, 'clientHeight', {
        value: 80,
        configurable: true
      });
      Object.defineProperty(editor, 'clientWidth', {
        value: 120,
        configurable: true
      });
      Object.defineProperty(editor, 'scrollHeight', {
        get: () => Math.ceil(Number.parseFloat(editor.style.fontSize || '0')),
        configurable: true
      });
      Object.defineProperty(editor, 'scrollWidth', {
        get: () => Math.ceil(Number.parseFloat(editor.style.fontSize || '0')),
        configurable: true
      });

      const fitted = autoFitNoteEditor(editor);

      expect(fitted).toBe(80);
      expect(editor.style.fontSize).toBe('80px');
    });

    it('returns null when the editor has no measurable size', () => {
      const editor = document.createElement('div');

      const fitted = autoFitNoteEditor(editor);

      expect(fitted).toBeNull();
    });
  });

  describe('createNoteRecord', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('auto fits the editor after text input', () => {
      const originalRAF = globalThis.requestAnimationFrame;
      const originalCancelRAF = globalThis.cancelAnimationFrame;
      globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      };
      globalThis.cancelAnimationFrame = () => {};

      try {
        const record = createNoteRecord({
          id: 'note-test',
          kind: 'note',
          x: 10,
          y: 20,
          width: 200,
          height: 120,
          text: 'Hello'
        });
        document.body.append(record.node);

        Object.defineProperty(record.editor, 'clientWidth', {
          value: 200,
          configurable: true
        });
        Object.defineProperty(record.editor, 'clientHeight', {
          value: 120,
          configurable: true
        });
        Object.defineProperty(record.editor, 'scrollHeight', {
          get: () => Math.ceil(Number.parseFloat(record.editor.style.fontSize || '0') * 2),
          configurable: true
        });
        Object.defineProperty(record.editor, 'scrollWidth', {
          get: () => Math.ceil(Number.parseFloat(record.editor.style.fontSize || '0') * 2),
          configurable: true
        });

        record.editor.textContent = 'Updated';
        record.editor.dispatchEvent(new Event('input'));

        expect(record.editor.style.fontSize).toBe('60px');
      } finally {
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCancelRAF;
      }
    });
  });
}
