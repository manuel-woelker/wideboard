import { fireEvent, render, screen } from '@testing-library/react';
import { BoardComponent, type NoteElement } from './BoardComponent';

describe('BoardComponent', () => {
  const baseNote: NoteElement = {
    id: 'test-note',
    kind: 'note',
    x: 10,
    y: 20,
    width: 200,
    height: 120,
    text: 'Test note'
  };
  const secondNote: NoteElement = {
    id: 'test-note-2',
    kind: 'note',
    x: 260,
    y: 180,
    width: 200,
    height: 120,
    text: 'Second note'
  };

  it('renders note text with imperative board rendering', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    expect(screen.getByText('Test note')).toBeInTheDocument();
  });

  it('does not render a dedicated note drag handle', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    expect(screen.queryByTestId('note-drag-handle-test-note')).not.toBeInTheDocument();
  });

  it('shows resize handles only on the active note', () => {
    render(<BoardComponent initialElements={[baseNote, secondNote]} />);
    const firstNoteNode = document.querySelector('[data-element-id="test-note"]') as HTMLDivElement;
    const secondNoteNode = document.querySelector(
      '[data-element-id="test-note-2"]'
    ) as HTMLDivElement;

    expect(firstNoteNode.querySelectorAll('[data-resize-handle]').length).toBe(8);
    expect(secondNoteNode.querySelectorAll('[data-resize-handle]').length).toBe(0);

    fireEvent.pointerDown(secondNoteNode, { button: 0, clientX: 300, clientY: 200 });

    expect(firstNoteNode.querySelectorAll('[data-resize-handle]').length).toBe(0);
    expect(secondNoteNode.querySelectorAll('[data-resize-handle]').length).toBe(8);
  });

  it('sets the board id on the host container', () => {
    render(<BoardComponent boardId="custom-board" initialElements={[baseNote]} />);
    expect(screen.getByTestId('board-component')).toHaveAttribute('data-board-id', 'custom-board');
  });

  it('renders a vertical toolbar for board actions', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    expect(screen.getByRole('toolbar', { name: 'Board tools' })).toBeInTheDocument();
  });

  it('enters note adding mode from the toolbar action', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    const action = screen.getByTestId('create-note-action');
    const board = screen.getByTestId('board-component');

    fireEvent.click(action);

    expect(action).toHaveAttribute('aria-pressed', 'true');
    expect(board.getAttribute('style')).toContain('data:image/svg+xml');
  });

  it('creates a text note on canvas click when in note adding mode', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    const action = screen.getByTestId('create-note-action');
    const board = screen.getByTestId('board-component');

    fireEvent.click(action);
    expect(action).toHaveAttribute('aria-pressed', 'true');
    fireEvent.pointerDown(board, { button: 0, clientX: 260, clientY: 200 });

    expect(screen.getByText('New note')).toBeInTheDocument();
    expect(action).toHaveAttribute('aria-pressed', 'false');
  });

  it('auto fits note text while resizing', () => {
    const originalRAF = globalThis.requestAnimationFrame;
    const originalCancelRAF = globalThis.cancelAnimationFrame;
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    };
    globalThis.cancelAnimationFrame = () => {};

    try {
      render(<BoardComponent initialElements={[baseNote]} />);

      const noteNode = document.querySelector('[data-element-id="test-note"]') as HTMLDivElement;
      const editor = document.querySelector(
        '[data-testid="note-editor-test-note"]'
      ) as HTMLDivElement;
      const handle = noteNode.querySelector(
        '[data-resize-handle="bottom-right"]'
      ) as HTMLDivElement;

      Object.defineProperty(editor, 'clientWidth', {
        get: () => Number.parseFloat(noteNode.style.width || '0'),
        configurable: true
      });
      Object.defineProperty(editor, 'clientHeight', {
        get: () => Number.parseFloat(noteNode.style.height || '0'),
        configurable: true
      });
      Object.defineProperty(editor, 'scrollHeight', {
        get: () => Math.ceil(Number.parseFloat(editor.style.fontSize || '0') * 2),
        configurable: true
      });
      Object.defineProperty(editor, 'scrollWidth', {
        get: () => Math.ceil(Number.parseFloat(editor.style.fontSize || '0') * 2),
        configurable: true
      });

      const initialFontSize = editor.style.fontSize;

      handle.dispatchEvent(
        new MouseEvent('pointerdown', {
          button: 0,
          buttons: 1,
          clientX: 200,
          clientY: 120,
          bubbles: true
        })
      );
      const moveCall = addSpy.mock.calls.find(([type]) => type === 'pointermove');
      const handler = moveCall?.[1];
      expect(typeof handler).toBe('function');
      if (typeof handler !== 'function') {
        throw new Error('Expected pointer move handler to be registered.');
      }
      (handler as (event: Event) => void)(
        new MouseEvent('pointermove', {
          clientX: 200,
          clientY: 200,
          buttons: 1
        })
      );

      expect(noteNode.style.height).toBe('200px');
      expect(editor.style.fontSize).not.toBe(initialFontSize);
      expect(editor.style.fontSize).toBe('100px');

      fireEvent.pointerUp(window);
    } finally {
      globalThis.requestAnimationFrame = originalRAF;
      globalThis.cancelAnimationFrame = originalCancelRAF;
      addSpy.mockRestore();
    }
  });

  it('copies and pastes the active note with clipboard data', () => {
    render(<BoardComponent initialElements={[baseNote]} />);

    const editor = document.querySelector(
      '[data-testid="note-editor-test-note"]'
    ) as HTMLDivElement;

    const clipboardData = (() => {
      const store = new Map<string, string>();
      return {
        getData: (type: string) => store.get(type) ?? '',
        setData: (type: string, value: string) => {
          store.set(type, value);
          return true;
        }
      };
    })();

    const copyEvent = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copyEvent, 'clipboardData', {
      value: clipboardData
    });

    editor.dispatchEvent(copyEvent);

    const notePayload = clipboardData.getData('application/x-wideboard-note');
    expect(notePayload).toContain('"text":"Test note"');

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: clipboardData
    });

    editor.dispatchEvent(pasteEvent);

    const noteNodes = document.querySelectorAll('[data-element-id]');
    expect(noteNodes.length).toBe(2);
  });

  it('pans the canvas with middle mouse drag', () => {
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});

    try {
      render(<BoardComponent initialElements={[baseNote]} />);

      const board = screen.getByTestId('board-component');
      const noteNode = document.querySelector('[data-element-id="test-note"]') as HTMLDivElement;
      const originalLeft = noteNode.style.left;

      board.dispatchEvent(
        new MouseEvent('pointerdown', {
          button: 1,
          buttons: 4,
          clientX: 10,
          clientY: 10,
          bubbles: true
        })
      );

      const moveCall = addSpy.mock.calls.find(([type]) => type === 'pointermove');
      const handler = moveCall?.[1];
      expect(typeof handler).toBe('function');
      if (typeof handler !== 'function') {
        throw new Error('Expected pointer move handler to be registered.');
      }

      (handler as (event: Event) => void)(
        new MouseEvent('pointermove', {
          clientX: 60,
          clientY: 40
        })
      );

      expect(noteNode.style.left).not.toBe(originalLeft);
    } finally {
      addSpy.mockRestore();
    }
  });
});
