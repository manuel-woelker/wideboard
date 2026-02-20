import type { BoardElement } from './boardEngineTypes';

/**
 * Clipboard MIME used for serialized note payloads.
 */
export const WIDEBOARD_NOTE_CLIPBOARD_MIME = 'application/x-wideboard-note';

/**
 * 2D board point in board/screen space depending on event context.
 */
export interface BoardPoint {
  /** X coordinate value. */
  x: number;
  /** Y coordinate value. */
  y: number;
}

export interface BoardPointerEvent {
  /** Event discriminant. */
  type: 'pointer';
  /** Pointer lifecycle phase. */
  phase: 'down' | 'move' | 'up' | 'cancel';
  /** Pointer position. */
  point: BoardPoint;
  /** Triggering button for down/up events. */
  button: number;
  /** Bitmask of currently pressed buttons. */
  buttons: number;
  /** Pointer id when available. */
  pointerId: number | null;
  /** Target element id resolved by the UI adapter. */
  targetElementId?: string;
  /** Shift modifier state. */
  shiftKey: boolean;
  /** Alt modifier state. */
  altKey: boolean;
  /** Control modifier state. */
  ctrlKey: boolean;
  /** Meta/command modifier state. */
  metaKey: boolean;
}

/**
 * Engine-level keyboard event contract.
 */
export interface BoardKeyboardEvent {
  /** Event discriminant. */
  type: 'keyboard';
  /** Keyboard lifecycle phase. */
  phase: 'down' | 'up';
  /** Keyboard key value. */
  key: string;
  /** Keyboard physical code. */
  code: string;
  /** Shift modifier state. */
  shiftKey: boolean;
  /** Alt modifier state. */
  altKey: boolean;
  /** Control modifier state. */
  ctrlKey: boolean;
  /** Meta/command modifier state. */
  metaKey: boolean;
}

export interface BoardClipboardEvent {
  /** Event discriminant. */
  type: 'clipboard';
  /** Clipboard lifecycle phase. */
  phase: 'copy' | 'paste';
}

export interface BoardWheelEvent {
  /** Event discriminant. */
  type: 'wheel';
  /** Pointer position used as zoom anchor. */
  point: BoardPoint;
  /** Horizontal wheel delta. */
  deltaX: number;
  /** Vertical wheel delta. */
  deltaY: number;
}

/**
 * Supported z-order mutations for current selection.
 */
export type BoardOrderingAction =
  | 'bring_forward'
  | 'send_backward'
  | 'bring_to_front'
  | 'send_to_back';

export type BoardCommand =
  | {
      /** Replaces current elements with provided list/order. */
      type: 'set_elements';
      /** New ordered element models. */
      elements: BoardElement[];
    }
  | {
      /** Adds one element to board state. */
      type: 'add_element';
      /** Element to insert. */
      element: BoardElement;
      /** Optional target insertion index in z-order. */
      index?: number;
    }
  | {
      /** Removes matching elements by id. */
      type: 'remove_elements';
      /** Element ids to remove. */
      ids: string[];
    }
  | {
      /** Updates current selection. */
      type: 'select';
      /** Source ids for selection mutation. */
      ids: string[];
      /** Selection merge strategy. */
      mode?: 'replace' | 'add' | 'remove' | 'toggle';
    }
  | {
      /** Clears current selection. */
      type: 'clear_selection';
    }
  | {
      /** Moves selected elements by delta. */
      type: 'move_selection';
      /** Translation delta. */
      delta: BoardPoint;
    }
  | {
      /** Moves explicit element ids by delta. */
      type: 'move_elements';
      /** Target element ids. */
      ids: string[];
      /** Translation delta. */
      delta: BoardPoint;
    }
  | {
      /** Sets viewport pan and optional zoom. */
      type: 'set_viewport';
      /** Next horizontal pan offset. */
      panX: number;
      /** Next vertical pan offset. */
      panY: number;
      /** Optional next zoom value. */
      zoom?: number;
    }
  | {
      /** Applies incremental viewport pan. */
      type: 'pan_viewport';
      /** Pan delta. */
      delta: BoardPoint;
    }
  | {
      /** Applies viewport zoom with optional anchor correction. */
      type: 'zoom_viewport';
      /** Target zoom value. */
      zoom: number;
      /** Optional zoom anchor point. */
      anchor?: BoardPoint;
    }
  | {
      /** Applies z-order operation to current selection. */
      type: 'order_selection';
      /** Ordering action to perform. */
      action: BoardOrderingAction;
    };
