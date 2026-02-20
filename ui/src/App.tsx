import { Global, css } from '@emotion/react';
import styled from '@emotion/styled';
import { useEffect } from 'react';
import { BoardComponent, type BoardElement } from './board/BoardComponent';
import elephantImage from '../assets/elephant.jpg';

interface BoardModel {
  id: string;
  name: string;
  elements: BoardElement[];
}

const DEFAULT_BOARD: BoardModel = {
  id: 'welcome',
  name: 'Welcome',
  elements: [
    {
      id: 'welcome-note',
      kind: 'note',
      x: 100,
      y: 90,
      width: 320,
      height: 220,
      text: 'Welcome to wideboard.\nDrag this note, resize it, and edit the text.'
    },
    {
      id: 'welcome-tips-1',
      kind: 'note',
      x: 100,
      y: 340,
      width: 320,
      height: 180,
      text: 'Tip: Click a note to activate it.\nOnly the active note shows resize handles.'
    },
    {
      id: 'welcome-tips-2',
      kind: 'note',
      x: 100,
      y: 550,
      width: 320,
      height: 180,
      text: 'Tip: Use + Note in the toolbar, then click the board to place a new note.'
    },
    {
      id: 'welcome-image-elephant',
      kind: 'image',
      x: 480,
      y: 120,
      width: 512,
      height: 768,
      src: elephantImage,
      alt: 'Elephant in the welcome board'
    },
    {
      id: 'welcome-link-hofstadter',
      kind: 'link',
      x: 1020,
      y: 120,
      width: 340,
      height: 220,
      url: "https://devterms.com/define/hofstadter's-law",
      title: "What is Hofstadter's Law? | DevTerms",
      description:
        "Hofstadter's Law: It always takes longer than you expect, even when you take into account Hofstadter's Law.",
      imageSrc:
        "https://devterms.com/api/og/hofstadter's-law?t=1426f4567a06ca419c93bd633ff203e1a325d2edebd5677733ab339f9754972d"
    }
  ]
};

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
  background: rgba(18, 58, 92, 0.88);
  color: #eaf8ff;
  font-size: 0.9rem;
  letter-spacing: 0.02em;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  z-index: 10;
`;

export function App() {
  useEffect(() => {
    document.title = DEFAULT_BOARD.name;
  }, []);

  return (
    <Shell>
      <Global
        styles={css`
          html,
          body,
          #root {
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
          }
        `}
      />
      <OverlayTitle>{DEFAULT_BOARD.name} board</OverlayTitle>
      <BoardComponent boardId={DEFAULT_BOARD.id} initialElements={DEFAULT_BOARD.elements} />
    </Shell>
  );
}
