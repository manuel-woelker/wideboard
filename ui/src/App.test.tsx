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

  it('uses welcome as the default board id', () => {
    render(<App />);
    expect(screen.getByTestId('board-component')).toHaveAttribute('data-board-id', 'welcome');
  });
});
