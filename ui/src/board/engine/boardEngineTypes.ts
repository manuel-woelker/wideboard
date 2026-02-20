export interface BoardElementFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardNoteElement extends BoardElementFrame {
  id: string;
  kind: 'note';
  text: string;
}

export interface BoardImageElement extends BoardElementFrame {
  id: string;
  kind: 'image';
  src: string;
  alt: string;
}

export type BoardElementKind = BoardNoteElement['kind'] | BoardImageElement['kind'];

/* 📖 # Why centralize board element contracts in engine types?
Phase 1 keeps behavior unchanged but establishes one shared type surface
that both the UI renderer and future headless engine can depend on.
*/
export type BoardElement = BoardNoteElement | BoardImageElement;
