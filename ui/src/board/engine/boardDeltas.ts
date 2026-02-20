import type { BoardElement } from './boardEngineTypes';

/**
 * Monotonic board revision number.
 */
export type BoardRevision = number;

/**
 * Delta for a new element insertion.
 */
export interface BoardElementAddedDelta {
  /** Delta discriminant. */
  type: 'element_added';
  /** Inserted element snapshot. */
  element: BoardElement;
  /** Insertion index in z-order. */
  index: number;
}

export interface BoardElementRemovedDelta {
  /** Delta discriminant. */
  type: 'element_removed';
  /** Removed element snapshot. */
  element: BoardElement;
  /** Previous index in z-order. */
  index: number;
}

export interface BoardElementUpdatedDelta {
  /** Delta discriminant. */
  type: 'element_updated';
  /** Updated element id. */
  id: string;
  /** Element snapshot before update. */
  previous: BoardElement;
  /** Element snapshot after update. */
  current: BoardElement;
  /** Previous z-order index when relevant. */
  previousIndex?: number;
  /** New z-order index when relevant. */
  currentIndex?: number;
}

export interface BoardSelectionChangedDelta {
  /** Delta discriminant. */
  type: 'selection_changed';
  /** Selection before mutation. */
  previous: string[];
  /** Selection after mutation. */
  current: string[];
}

export interface BoardViewportChangedDelta {
  /** Delta discriminant. */
  type: 'viewport_changed';
  /** Viewport before mutation. */
  previous: {
    /** Previous pan X. */
    panX: number;
    /** Previous pan Y. */
    panY: number;
    /** Previous zoom. */
    zoom: number;
  };
  /** Viewport after mutation. */
  current: {
    /** Current pan X. */
    panX: number;
    /** Current pan Y. */
    panY: number;
    /** Current zoom. */
    zoom: number;
  };
}

export interface BoardInteractionChangedDelta {
  /** Delta discriminant. */
  type: 'interaction_changed';
  /** Interaction mode before mutation. */
  previous: {
    /** Previous interaction mode identifier. */
    mode: string;
  };
  /** Interaction mode after mutation. */
  current: {
    /** Current interaction mode identifier. */
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

/**
 * One committed delta packet at a specific revision.
 */
export interface BoardDeltaEnvelope {
  /** Revision associated with this envelope. */
  revision: BoardRevision;
  /** Deltas committed in this revision. */
  deltas: BoardDelta[];
}

/**
 * Delta query result for all revisions newer than `since`.
 */
export interface BoardDeltaBatch {
  /** Input revision baseline used for the query. */
  since: BoardRevision;
  /** Current engine revision at query time. */
  current: BoardRevision;
  /** Revision-ordered envelopes newer than `since`. */
  batches: BoardDeltaEnvelope[];
}
