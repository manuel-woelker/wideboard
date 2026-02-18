import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the board heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'wideboard Board' })).toBeInTheDocument();
  });

  it('renders the note element text', () => {
    render(<App />);
    expect(screen.getByText(/Welcome to wideboard\./)).toBeInTheDocument();
  });
});
