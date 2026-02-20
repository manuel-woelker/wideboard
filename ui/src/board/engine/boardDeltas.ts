import type { BoardElement } from './boardEngineTypes';

export type BoardRevision = number;

export interface BoardElementAddedDelta {
  type: 'element_added';
  element: BoardElement;
  index: number;
}

export interface BoardElementRemovedDelta {
  type: 'element_removed';
  element: BoardElement;
  index: number;
}

export interface BoardElementUpdatedDelta {
  type: 'element_updated';
  id: string;
  previous: BoardElement;
  current: BoardElement;
  previousIndex?: number;
  currentIndex?: number;
}

export interface BoardSelectionChangedDelta {
  type: 'selection_changed';
  previous: string[];
  current: string[];
}

export interface BoardViewportChangedDelta {
  type: 'viewport_changed';
  previous: {
    panX: number;
    panY: number;
    zoom: number;
  };
  current: {
    panX: number;
    panY: number;
    zoom: number;
  };
}

export interface BoardInteractionChangedDelta {
  type: 'interaction_changed';
  previous: {
    mode: string;
  };
  current: {
    mode: string;
  };
}

export type BoardDelta =
  | BoardElementAddedDelta
  | BoardElementRemovedDelta
  | BoardElementUpdatedDelta
  | BoardSelectionChangedDelta
  | BoardViewportChangedDelta
  | BoardInteractionChangedDelta;

export interface BoardDeltaEnvelope {
  revision: BoardRevision;
  deltas: BoardDelta[];
}

export interface BoardDeltaBatch {
  since: BoardRevision;
  current: BoardRevision;
  batches: BoardDeltaEnvelope[];
}
