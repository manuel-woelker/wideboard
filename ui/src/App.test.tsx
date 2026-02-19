import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the board heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Welcome board' })).toBeInTheDocument();
  });

  it('renders the note element text', () => {
    render(<App />);
    expect(screen.getByText(/Welcome to wideboard\./)).toBeInTheDocument();
  });

  it('renders two additional default tip notes', () => {
    render(<App />);
    expect(screen.getByText(/Tip: Click a note to activate it\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Tip: Use \+ Note in the toolbar, then click the board to place a new note\./
      )
    ).toBeInTheDocument();
  });

  it('uses welcome as the default board id', () => {
    render(<App />);
    expect(screen.getByTestId('board-component')).toHaveAttribute('data-board-id', 'welcome');
  });

  it('renders the welcome elephant image', () => {
    render(<App />);
    expect(screen.getByAltText('Elephant in the welcome board')).toBeInTheDocument();
  });
});
