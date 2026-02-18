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
});
