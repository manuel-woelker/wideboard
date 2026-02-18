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

  it('renders note text with imperative board rendering', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    expect(screen.getByText('Test note')).toBeInTheDocument();
  });

  it('renders eight resize handles for each note element', () => {
    render(<BoardComponent initialElements={[baseNote]} />);
    const noteNode = document.querySelector('[data-element-id="test-note"]');
    expect(noteNode?.querySelectorAll('[data-resize-handle]').length).toBe(8);
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
