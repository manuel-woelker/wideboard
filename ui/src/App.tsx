import styled from '@emotion/styled';
import { BoardComponent, type BoardElement } from './board/BoardComponent';

const BOARD_ELEMENTS: BoardElement[] = [
  {
    id: 'welcome-note',
    kind: 'note',
    x: 100,
    y: 90,
    width: 320,
    height: 220,
    text: 'Welcome to wideboard.\nDrag this note, resize it, and edit the text.'
  }
];

const Shell = styled.main`
  min-height: 100vh;
  width: 100%;
  margin: 0;
`;

const OverlayTitle = styled.h1`
  position: fixed;
  top: 0.9rem;
  left: 1rem;
  margin: 0;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(37, 31, 19, 0.84);
  color: #fbf7ef;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  z-index: 10;
`;

export function App() {
  return (
    <Shell>
      <OverlayTitle>wideboard Board</OverlayTitle>
      <BoardComponent initialElements={BOARD_ELEMENTS} />
    </Shell>
  );
}
