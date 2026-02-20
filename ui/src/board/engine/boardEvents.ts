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
