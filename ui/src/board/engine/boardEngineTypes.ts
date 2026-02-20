import type { BoardElementRegistry } from './elementRegistry';

/**
 * Shared geometry contract used by all board element kinds.
 */
export interface BoardElementFrame {
  /** Left position in board space. */
  x: number;
  /** Top position in board space. */
  y: number;
  /** Element width in board space units. */
  width: number;
  /** Element height in board space units. */
  height: number;
}

/**
 * Board note model owned by engine state.
 */
export interface BoardNoteElement extends BoardElementFrame {
  /** Stable element identifier. */
  id: string;
  /** Discriminant for note elements. */
  kind: 'note';
  /** Plain-text note content. */
  text: string;
}

export interface BoardImageElement extends BoardElementFrame {
  /** Stable element identifier. */
  id: string;
  /** Discriminant for image elements. */
  kind: 'image';
  /** Image source URL/blob reference. */
  src: string;
  /** Accessible image description. */
  alt: string;
}

/**
 * Board link preview model owned by engine state.
 */
export interface BoardLinkElement extends BoardElementFrame {
  /** Stable element identifier. */
  id: string;
  /** Discriminant for link elements. */
  kind: 'link';
  /** Absolute URL represented by this element. */
  url: string;
  /** Display title for the link card. */
  title: string;
  /** Optional Open Graph description snippet. */
  description?: string;
  /** Optional Open Graph preview image URL. */
  imageSrc?: string;
}

export type BoardElementKind =
  | BoardNoteElement['kind']
  | BoardImageElement['kind']
  | BoardLinkElement['kind'];

/**
 * Discriminated board element union consumed by engine reducers and UI adapters.
 */
export type BoardElement = BoardNoteElement | BoardImageElement | BoardLinkElement;

/**
 * Canonical viewport values used for pan and zoom transitions.
 */
export interface BoardViewportState {
  /** Horizontal pan offset in board space. */
  panX: number;
  /** Vertical pan offset in board space. */
  panY: number;
  /** View zoom multiplier. */
  zoom: number;
}

/**
 * Transient interaction mode tracked by the engine during pointer workflows.
 */
export type BoardInteractionState =
  | {
      /** No active interaction gesture. */
      mode: 'idle';
    }
  | {
      /** Selection drag interaction is active. */
      mode: 'dragging_selection';
      /** Pointer that started the drag, when available. */
      pointerId: number | null;
      /** Pointer origin in board/screen event space. */
      origin: {
        /** Origin X coordinate. */
        x: number;
        /** Origin Y coordinate. */
        y: number;
      };
      /** Element ids participating in current drag operation. */
      elementIds: string[];
      /** Per-element start positions captured at drag start. */
      startPositions: Record<
        string,
        {
          /** Starting X value for the element. */
          x: number;
          /** Starting Y value for the element. */
          y: number;
        }
      >;
    };

/**
 * Full engine-owned board state snapshot.
 */
export interface BoardState {
  /** Element models keyed by id. */
  elements: Record<string, BoardElement>;
  /** Z-order list from back to front. */
  elementOrder: string[];
  /** Currently selected element ids. */
  selection: string[];
  /** Current viewport values. */
  viewport: BoardViewportState;
  /** Transient interaction mode/state. */
  interaction: BoardInteractionState;
}

/**
 * Startup configuration for engine construction.
 */
export interface BoardEngineConfig {
  /** Initial element list loaded into engine state. */
  initialElements?: BoardElement[];
  /** Optional initial viewport override. */
  initialViewport?: Partial<BoardViewportState>;
  /** Optional custom element registry implementation. */
  elementRegistry?: BoardElementRegistry;
}
