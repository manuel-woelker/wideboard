import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the app heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'wideboard UI' })).toBeInTheDocument();
  });

  it('renders a stack badge', () => {
    render(<App />);
    expect(screen.getByTestId('stack-badge')).toHaveTextContent(
      'Vite + React + TS + Vitest + Emotion'
    );
  });
});
