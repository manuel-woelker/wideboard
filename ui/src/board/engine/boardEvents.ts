import type { BoardElement } from './boardEngineTypes';

export const WIDEBOARD_NOTE_CLIPBOARD_MIME = 'application/x-wideboard-note';

export interface BoardPoint {
  x: number;
  y: number;
}

export interface BoardPointerEvent {
  type: 'pointer';
  phase: 'down' | 'move' | 'up' | 'cancel';
  point: BoardPoint;
  button: number;
  buttons: number;
  pointerId: number | null;
  targetElementId?: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface BoardKeyboardEvent {
  type: 'keyboard';
  phase: 'down' | 'up';
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface BoardClipboardEvent {
  type: 'clipboard';
  phase: 'copy' | 'paste';
}

export interface BoardWheelEvent {
  type: 'wheel';
  point: BoardPoint;
  deltaX: number;
  deltaY: number;
}

export type BoardOrderingAction =
  | 'bring_forward'
  | 'send_backward'
  | 'bring_to_front'
  | 'send_to_back';

export type BoardCommand =
  | {
      type: 'set_elements';
      elements: BoardElement[];
    }
  | {
      type: 'add_element';
      element: BoardElement;
      index?: number;
    }
  | {
      type: 'remove_elements';
      ids: string[];
    }
  | {
      type: 'select';
      ids: string[];
      mode?: 'replace' | 'add' | 'remove' | 'toggle';
    }
  | {
      type: 'clear_selection';
    }
  | {
      type: 'move_selection';
      delta: BoardPoint;
    }
  | {
      type: 'move_elements';
      ids: string[];
      delta: BoardPoint;
    }
  | {
      type: 'set_viewport';
      panX: number;
      panY: number;
      zoom?: number;
    }
  | {
      type: 'pan_viewport';
      delta: BoardPoint;
    }
  | {
      type: 'zoom_viewport';
      zoom: number;
      anchor?: BoardPoint;
    }
  | {
      type: 'order_selection';
      action: BoardOrderingAction;
    };
