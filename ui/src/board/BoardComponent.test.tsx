import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BoardComponent, type ImageElement, type NoteElement } from './BoardComponent';
import type { BoardEngine } from './engine/BoardEngine';

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
  const baseImage: ImageElement = {
    id: 'test-image',
    kind: 'image',
    x: 520,
    y: 100,
    width: 220,
    height: 160,
    src: '/assets/elephant.jpg',
    alt: 'Test elephant image'
  };

  it('renders note text with imperative board rendering', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    expect(screen.getByText('Test note')).toBeInTheDocument();
  });

  it('updates board UI when external engine events dispatch mutations', () => {
    const onEngineReady = vi.fn<(engine: BoardEngine) => void>();
    render(<BoardComponent initialElements={[baseNote]} onEngineReady={onEngineReady} />);

    const engine = onEngineReady.mock.calls.at(0)?.[0];
    if (!engine) {
      throw new Error('Expected BoardComponent to expose its engine instance.');
    }

    engine.dispatch.addElement({
      element: {
        id: 'external-note-1',
        kind: 'note',
        x: 80,
        y: 80,
        width: 220,
        height: 140,
        text: 'External update'
      }
    });

    expect(screen.getByText('External update')).toBeInTheDocument();
  });

  it('enables note text editing only after a second click', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    const noteNode = document.querySelector('[data-element-id="test-note"]') as HTMLDivElement;
    const editor = document.querySelector(
      '[data-testid="note-editor-test-note"]'
    ) as HTMLDivElement;

    expect(editor.contentEditable).toBe('false');
    fireEvent.click(noteNode);
    expect(editor.contentEditable).toBe('false');

    fireEvent.doubleClick(noteNode);
    expect(editor.contentEditable).toBe('true');
  });

  it('keeps note editing enabled when clicking inside an active editor', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    const noteNode = document.querySelector('[data-element-id="test-note"]') as HTMLDivElement;
    const editor = document.querySelector(
      '[data-testid="note-editor-test-note"]'
    ) as HTMLDivElement;

    fireEvent.doubleClick(noteNode);
    expect(editor.contentEditable).toBe('true');

    fireEvent.pointerDown(editor, { button: 0, clientX: 40, clientY: 40 });
    expect(editor.contentEditable).toBe('true');
  });

  it('keeps note editing enabled after typing a character', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    const noteNode = document.querySelector('[data-element-id="test-note"]') as HTMLDivElement;
    const editor = document.querySelector(
      '[data-testid="note-editor-test-note"]'
    ) as HTMLDivElement;

    fireEvent.doubleClick(noteNode);
    expect(editor.contentEditable).toBe('true');

    editor.textContent = 'Test noteX';
    fireEvent.input(editor);

    expect(editor.contentEditable).toBe('true');

    editor.textContent = 'Test noteXY';
    fireEvent.input(editor);
    expect(editor.contentEditable).toBe('true');
  });

  it('renders image elements', () => {
    render(<BoardComponent initialElements={[baseNote, baseImage]} />);
    expect(screen.getByAltText('Test elephant image')).toBeInTheDocument();
  });

  it('does not render a dedicated note drag handle', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    expect(screen.queryByTestId('note-drag-handle-test-note')).not.toBeInTheDocument();
  });

  it('shows resize handles on the shared selection frame', () => {
    render(<BoardComponent initialElements={[baseNote, secondNote]} />);
    const firstNoteNode = document.querySelector('[data-element-id="test-note"]') as HTMLDivElement;
    const secondNoteNode = document.querySelector(
      '[data-element-id="test-note-2"]'
    ) as HTMLDivElement;
    const selectionFrame = screen.getByTestId('board-selection-frame');

    expect(selectionFrame.querySelectorAll('[data-resize-handle]').length).toBe(8);
    expect(firstNoteNode.dataset.selected).toBe('true');
    expect(secondNoteNode.dataset.selected).toBe('false');
  });

  it('selects multiple notes by left-dragging a marquee on the canvas', () => {
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});

    try {
      render(<BoardComponent initialElements={[baseNote, secondNote]} />);
      const board = screen.getByTestId('board-component');
      const firstNoteNode = document.querySelector(
        '[data-element-id="test-note"]'
      ) as HTMLDivElement;
      const secondNoteNode = document.querySelector(
        '[data-element-id="test-note-2"]'
      ) as HTMLDivElement;

      Object.defineProperty(board, 'getBoundingClientRect', {
        value: () =>
          ({
            left: 0,
            top: 0
          }) as DOMRect,
        configurable: true
      });

      board.dispatchEvent(
        new MouseEvent('pointerdown', {
          button: 0,
          clientX: 0,
          clientY: 0,
          bubbles: true
        })
      );

      const moveCall = addSpy.mock.calls.find(([type]) => type === 'pointermove');
      const moveHandler = moveCall?.[1];
      expect(typeof moveHandler).toBe('function');
      if (typeof moveHandler !== 'function') {
        throw new Error('Expected marquee pointer move handler to be registered.');
      }

      (moveHandler as (event: Event) => void)(
        new MouseEvent('pointermove', {
          clientX: 500,
          clientY: 400
        })
      );

      const upCall = addSpy.mock.calls.find(([type]) => type === 'pointerup');
      const upHandler = upCall?.[1];
      expect(typeof upHandler).toBe('function');
      if (typeof upHandler !== 'function') {
        throw new Error('Expected marquee pointer up handler to be registered.');
      }

      (upHandler as (event: Event) => void)(
        new MouseEvent('pointerup', {
          clientX: 500,
          clientY: 400
        })
      );

      expect(firstNoteNode.dataset.selected).toBe('true');
      expect(secondNoteNode.dataset.selected).toBe('true');
      expect(screen.getByTestId('board-selection-frame')).toBeInTheDocument();
      expect(
        screen.getByTestId('board-selection-frame').querySelectorAll('[data-resize-handle]').length
      ).toBe(8);
      expect(screen.queryByTestId('board-marquee-selection')).not.toBeInTheDocument();
    } finally {
      addSpy.mockRestore();
    }
  });

  it('drags all selected notes together', () => {
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});

    try {
      render(<BoardComponent initialElements={[baseNote, secondNote]} />);
      const board = screen.getByTestId('board-component');
      const firstNoteNode = document.querySelector(
        '[data-element-id="test-note"]'
      ) as HTMLDivElement;
      const secondNoteNode = document.querySelector(
        '[data-element-id="test-note-2"]'
      ) as HTMLDivElement;

      Object.defineProperty(board, 'getBoundingClientRect', {
        value: () =>
          ({
            left: 0,
            top: 0
          }) as DOMRect,
        configurable: true
      });

      board.dispatchEvent(
        new MouseEvent('pointerdown', {
          button: 0,
          clientX: 0,
          clientY: 0,
          bubbles: true
        })
      );

      const marqueeMoveHandler = addSpy.mock.calls.find(([type]) => type === 'pointermove')?.[1];
      if (typeof marqueeMoveHandler !== 'function') {
        throw new Error('Expected marquee pointer move handler to be registered.');
      }
      (marqueeMoveHandler as (event: Event) => void)(
        new MouseEvent('pointermove', {
          clientX: 500,
          clientY: 400
        })
      );

      const marqueeUpHandler = addSpy.mock.calls.find(([type]) => type === 'pointerup')?.[1];
      if (typeof marqueeUpHandler !== 'function') {
        throw new Error('Expected marquee pointer up handler to be registered.');
      }
      (marqueeUpHandler as (event: Event) => void)(
        new MouseEvent('pointerup', {
          clientX: 500,
          clientY: 400
        })
      );

      firstNoteNode.dispatchEvent(
        new MouseEvent('pointerdown', {
          button: 0,
          clientX: 30,
          clientY: 30,
          bubbles: true
        })
      );

      const dragMoveHandler = addSpy.mock.calls
        .filter(([type]) => type === 'pointermove')
        .at(-1)?.[1];
      if (typeof dragMoveHandler !== 'function') {
        throw new Error('Expected drag pointer move handler to be registered.');
      }
      (dragMoveHandler as (event: Event) => void)(
        new MouseEvent('pointermove', {
          clientX: 80,
          clientY: 70
        })
      );

      expect(firstNoteNode.style.left).toBe('60px');
      expect(secondNoteNode.style.left).toBe('310px');
      expect(firstNoteNode.style.top).toBe('60px');
      expect(secondNoteNode.style.top).toBe('220px');
    } finally {
      addSpy.mockRestore();
    }
  });

  it('resizes all selected notes using selection frame handles', () => {
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});

    try {
      render(<BoardComponent initialElements={[baseNote, secondNote]} />);
      const board = screen.getByTestId('board-component');
      const firstNoteNode = document.querySelector(
        '[data-element-id="test-note"]'
      ) as HTMLDivElement;
      const secondNoteNode = document.querySelector(
        '[data-element-id="test-note-2"]'
      ) as HTMLDivElement;
      const selectionFrame = screen.getByTestId('board-selection-frame');

      Object.defineProperty(board, 'getBoundingClientRect', {
        value: () =>
          ({
            left: 0,
            top: 0
          }) as DOMRect,
        configurable: true
      });

      board.dispatchEvent(
        new MouseEvent('pointerdown', {
          button: 0,
          clientX: 0,
          clientY: 0,
          bubbles: true
        })
      );

      const marqueeMoveHandler = addSpy.mock.calls.find(([type]) => type === 'pointermove')?.[1];
      if (typeof marqueeMoveHandler !== 'function') {
        throw new Error('Expected marquee pointer move handler to be registered.');
      }
      (marqueeMoveHandler as (event: Event) => void)(
        new MouseEvent('pointermove', {
          clientX: 500,
          clientY: 400
        })
      );

      const marqueeUpHandler = addSpy.mock.calls.find(([type]) => type === 'pointerup')?.[1];
      if (typeof marqueeUpHandler !== 'function') {
        throw new Error('Expected marquee pointer up handler to be registered.');
      }
      (marqueeUpHandler as (event: Event) => void)(
        new MouseEvent('pointerup', {
          clientX: 500,
          clientY: 400
        })
      );

      const handle = selectionFrame.querySelector('[data-resize-handle="right"]') as HTMLDivElement;

      handle.dispatchEvent(
        new MouseEvent('pointerdown', {
          button: 0,
          clientX: 460,
          clientY: 200,
          bubbles: true
        })
      );

      const resizeMoveHandler = addSpy.mock.calls
        .filter(([type]) => type === 'pointermove')
        .at(-1)?.[1];
      if (typeof resizeMoveHandler !== 'function') {
        throw new Error('Expected resize pointer move handler to be registered.');
      }
      (resizeMoveHandler as (event: Event) => void)(
        new MouseEvent('pointermove', {
          clientX: 560,
          clientY: 200
        })
      );

      expect(Number.parseFloat(firstNoteNode.style.width)).toBeGreaterThan(200);
      expect(Number.parseFloat(secondNoteNode.style.width)).toBeGreaterThan(200);
      expect(Number.parseFloat(secondNoteNode.style.left)).toBeGreaterThan(260);
    } finally {
      addSpy.mockRestore();
    }
  });

  it('clears selection when clicking empty canvas', () => {
    const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(() => {});

    try {
      render(<BoardComponent initialElements={[baseNote, secondNote]} />);
      const board = screen.getByTestId('board-component');
      const firstNoteNode = document.querySelector(
        '[data-element-id="test-note"]'
      ) as HTMLDivElement;
      const selectionFrame = screen.getByTestId('board-selection-frame');

      fireEvent.pointerDown(firstNoteNode, { button: 0, clientX: 50, clientY: 50 });
      expect(selectionFrame.style.display).toBe('block');

      Object.defineProperty(board, 'getBoundingClientRect', {
        value: () =>
          ({
            left: 0,
            top: 0
          }) as DOMRect,
        configurable: true
      });

      board.dispatchEvent(
        new MouseEvent('pointerdown', {
          button: 0,
          clientX: 900,
          clientY: 700,
          bubbles: true
        })
      );

      const upCall = addSpy.mock.calls.find(([type]) => type === 'pointerup');
      const upHandler = upCall?.[1];
      expect(typeof upHandler).toBe('function');
      if (typeof upHandler !== 'function') {
        throw new Error('Expected marquee pointer up handler to be registered.');
      }

      (upHandler as (event: Event) => void)(
        new MouseEvent('pointerup', {
          clientX: 900,
          clientY: 700
        })
      );

      expect(firstNoteNode.dataset.selected).toBe('false');
      expect(selectionFrame.style.display).toBe('none');
      expect(screen.queryByTestId('board-marquee-selection')).not.toBeInTheDocument();
    } finally {
      addSpy.mockRestore();
    }
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
      const selectionFrame = screen.getByTestId('board-selection-frame');
      const handle = selectionFrame.querySelector(
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

  it('copies and pastes using window clipboard events', () => {
    render(<BoardComponent initialElements={[baseNote]} />);

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
    window.dispatchEvent(copyEvent);

    const notePayload = clipboardData.getData('application/x-wideboard-note');
    expect(notePayload).toContain('"text":"Test note"');

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: clipboardData
    });
    window.dispatchEvent(pasteEvent);

    expect(document.querySelectorAll('[data-element-id]').length).toBe(2);
  });

  it('creates an image element when pasting image files', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-image-url');

    try {
      render(<BoardComponent initialElements={[baseNote]} />);
      const board = screen.getByTestId('board-component');
      const file = new File(['fake-bytes'], 'clipboard-elephant.png', { type: 'image/png' });

      const clipboardData = {
        files: [file],
        getData: () => ''
      };

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: clipboardData
      });

      board.dispatchEvent(pasteEvent);

      expect(screen.getByAltText('clipboard-elephant.png')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-element-id]').length).toBe(2);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('creates an image element when pasting image clipboard items', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-item-url');

    try {
      render(<BoardComponent initialElements={[baseNote]} />);
      const board = screen.getByTestId('board-component');
      const file = new File(['fake-bytes'], 'clipboard-item-elephant.png', { type: 'image/png' });

      const clipboardData = {
        files: [],
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => file
          }
        ],
        getData: () => ''
      };

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: clipboardData
      });

      board.dispatchEvent(pasteEvent);

      expect(screen.getByAltText('clipboard-item-elephant.png')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-element-id]').length).toBe(2);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('creates a link element from pasted url text and applies open graph preview data', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        `
          <html>
            <head>
              <meta property="og:title" content="Example OG Title" />
              <meta property="og:description" content="Example OG Description" />
              <meta property="og:image" content="https://example.com/preview.png" />
            </head>
          </html>
        `,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html'
          }
        }
      );
    }) as typeof fetch;

    try {
      render(<BoardComponent initialElements={[baseNote]} />);
      const board = screen.getByTestId('board-component');

      const clipboardData = {
        files: [],
        items: [],
        getData: (type: string) => {
          if (type === 'text/plain') {
            return 'https://example.com/article';
          }
          return '';
        }
      };

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: clipboardData
      });

      board.dispatchEvent(pasteEvent);

      await waitFor(() => {
        expect(screen.getByText('Example OG Title')).toBeInTheDocument();
      });
      expect(screen.getByText('Example OG Description')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-element-id]').length).toBe(2);
      expect(globalThis.fetch).toHaveBeenCalledWith('https://example.com/article');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to the allorigins proxy when direct link fetch fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(
          `
            <html>
              <head>
                <meta property="og:title" content="Proxy OG Title" />
                <meta property="og:description" content="Proxy OG Description" />
                <meta property="og:image" content="/proxy-preview.png" />
              </head>
            </html>
          `,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/html'
            }
          }
        )
      ) as typeof fetch;

    try {
      render(<BoardComponent initialElements={[baseNote]} />);
      const board = screen.getByTestId('board-component');

      const clipboardData = {
        files: [],
        items: [],
        getData: (type: string) => {
          if (type === 'text/plain') {
            return 'https://rankmath.com/seo-glossary/open-graph-meta-tags/';
          }
          return '';
        }
      };

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: clipboardData
      });

      board.dispatchEvent(pasteEvent);

      await waitFor(() => {
        expect(screen.getByText('Proxy OG Title')).toBeInTheDocument();
      });
      expect(screen.getByText('Proxy OG Description')).toBeInTheDocument();
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        1,
        'https://rankmath.com/seo-glossary/open-graph-meta-tags/'
      );
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        'https://api.allorigins.win/raw?url=https%3A%2F%2Frankmath.com%2Fseo-glossary%2Fopen-graph-meta-tags%2F'
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('creates an image element when dropping image files on the board', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:test-drop-url');

    try {
      render(<BoardComponent initialElements={[baseNote]} />);
      const board = screen.getByTestId('board-component');
      const file = new File(['fake-bytes'], 'drop-elephant.jpg', { type: 'image/jpeg' });

      Object.defineProperty(board, 'getBoundingClientRect', {
        value: () =>
          ({
            left: 0,
            top: 0
          }) as DOMRect,
        configurable: true
      });

      const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [file]
        }
      });
      Object.defineProperty(dropEvent, 'clientX', {
        value: 220
      });
      Object.defineProperty(dropEvent, 'clientY', {
        value: 180
      });

      board.dispatchEvent(dropEvent);

      expect(screen.getByAltText('drop-elephant.jpg')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-element-id]').length).toBe(2);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
  });

  it('enables file drop during dragover when transfer types include Files', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    const board = screen.getByTestId('board-component');

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dragOverEvent, 'dataTransfer', {
      value: {
        files: [],
        types: ['Files'],
        dropEffect: 'none'
      }
    });

    const prevented = !board.dispatchEvent(dragOverEvent);
    expect(prevented).toBe(true);
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

  it('zooms the canvas with the mouse wheel', () => {
    render(<BoardComponent initialElements={[baseNote]} />);

    const board = screen.getByTestId('board-component');
    const noteNode = document.querySelector('[data-element-id="test-note"]') as HTMLDivElement;
    const initialLeft = noteNode.style.left;
    const initialWidth = noteNode.style.width;

    board.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 0,
        clientY: 0,
        bubbles: true,
        cancelable: true
      })
    );

    expect(noteNode.style.left).not.toBe(initialLeft);
    expect(noteNode.style.width).not.toBe(initialWidth);
  });

  it('prevents the context menu when right-click panning', () => {
    render(<BoardComponent initialElements={[baseNote]} />);

    const board = screen.getByTestId('board-component');
    const event = new MouseEvent('contextmenu', {
      button: 2,
      bubbles: true,
      cancelable: true
    });

    const prevented = !board.dispatchEvent(event);

    expect(prevented).toBe(true);
  });

  it('deletes selected elements when pressing Delete', () => {
    render(<BoardComponent initialElements={[baseNote, baseImage]} />);

    fireEvent.keyDown(window, { key: 'Delete' });

    expect(document.querySelector('[data-element-id="test-note"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-element-id="test-image"]')).toBeInTheDocument();
  });

  it('does not delete selected notes while editing note text', () => {
    render(<BoardComponent initialElements={[baseNote]} />);

    const editor = document.querySelector(
      '[data-testid="note-editor-test-note"]'
    ) as HTMLDivElement;
    editor.setAttribute('contenteditable', 'true');
    editor.focus();

    fireEvent.keyDown(editor, { key: 'Delete' });

    expect(document.querySelector('[data-element-id="test-note"]')).toBeInTheDocument();
  });

  it('does not delete selected notes when focus is outside the board', () => {
    render(<BoardComponent initialElements={[baseNote]} />);

    const outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);
    outsideInput.focus();

    try {
      fireEvent.keyDown(window, { key: 'Delete' });
      expect(document.querySelector('[data-element-id="test-note"]')).toBeInTheDocument();
    } finally {
      outsideInput.remove();
    }
  });

  it('ignores window paste when focus is outside the board', () => {
    render(<BoardComponent initialElements={[baseNote]} />);

    const outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);
    outsideInput.focus();

    const clipboardData = {
      files: [],
      getData: (type: string) => {
        if (type !== 'application/x-wideboard-note') {
          return '';
        }

        return JSON.stringify({
          kind: 'note',
          text: 'Should not be pasted',
          x: 0,
          y: 0,
          width: 260,
          height: 170
        });
      }
    };

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: clipboardData
    });

    try {
      window.dispatchEvent(pasteEvent);
      expect(document.querySelectorAll('[data-element-id]').length).toBe(1);
    } finally {
      outsideInput.remove();
    }
  });
});
