import { render, screen } from '@testing-library/react';
import { App, createRandomParticipantName } from './App';

describe('App', () => {
  it('renders the board heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Welcome board' })).toBeInTheDocument();
  });

  it('shows a loading indicator while board state is loading', () => {
    render(<App />);
    expect(screen.getByText('Loading board...')).toBeInTheDocument();
  });

  it('uses welcome as the default board id', () => {
    render(<App />);
    expect(screen.getByTestId('board-component')).toHaveAttribute('data-board-id', 'welcome');
  });

  it('renders a local participant label', () => {
    render(<App />);
    expect(screen.getByText(/^You:\s/)).toBeInTheDocument();
  });

  it('creates random participant names from adjective, animal, and numeric tag', () => {
    const randomValues = [0, 0.5, 0.007];
    let index = 0;
    const random = () => {
      const value = randomValues[index] ?? 0;
      index += 1;
      return value;
    };

    expect(createRandomParticipantName(random)).toBe('SwiftPanda-007');
  });
});
