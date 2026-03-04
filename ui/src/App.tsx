import { Global, css } from '@emotion/react';
import styled from '@emotion/styled';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardComponent, type BoardElement } from './board/BoardComponent';
import type { BoardEngine } from './board/engine/BoardEngine';
import elephantImage from '../assets/elephant.jpg';

interface BoardModel {
  id: string;
  name: string;
  elements: BoardElement[];
}

interface MouseMovedMessage {
  type: 'mouse_moved';
  participantId: string;
  name: string;
  boardX: number;
  boardY: number;
}

interface BoardStatePayload {
  elements: BoardElement[];
}

interface BoardStateMessage {
  type: 'board_state' | 'board_state_updated';
  boardId: string;
  state: BoardStatePayload;
}

interface RequestBoardStateMessage {
  type: 'request_board_state';
  boardId: string;
  initialState: BoardStatePayload;
}

interface UpdateBoardStateMessage {
  type: 'update_board_state';
  boardId: string;
  state: BoardStatePayload;
}

interface RemotePointer {
  participantId: string;
  name: string;
  x: number;
  y: number;
  updatedAt: number;
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

const OverlayParticipant = styled.p`
  position: fixed;
  top: 3.2rem;
  left: 1rem;
  margin: 0;
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: rgba(7, 32, 52, 0.88);
  color: #d4ecff;
  font-size: 0.8rem;
  letter-spacing: 0.02em;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  z-index: 10;
`;

const PARTICIPANT_ADJECTIVES = [
  'Swift',
  'Quiet',
  'Bright',
  'Mellow',
  'Brisk',
  'Curious',
  'Nimble',
  'Clever'
];

const PARTICIPANT_ANIMALS = ['Otter', 'Fox', 'Hawk', 'Whale', 'Panda', 'Lynx', 'Sparrow', 'Badger'];

/**
 * Generates a readable random display name for the local participant.
 */
export function createRandomParticipantName(randomValue = Math.random) {
  const adjectiveIndex = Math.floor(randomValue() * PARTICIPANT_ADJECTIVES.length);
  const animalIndex = Math.floor(randomValue() * PARTICIPANT_ANIMALS.length);
  const tag = String(Math.floor(randomValue() * 1000)).padStart(3, '0');
  return `${PARTICIPANT_ADJECTIVES[adjectiveIndex]}${PARTICIPANT_ANIMALS[animalIndex]}-${tag}`;
}

function createParticipantId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `participant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveWebSocketUrl() {
  const configuredUrl = import.meta.env.VITE_WS_URL;
  if (typeof configuredUrl === 'string' && configuredUrl.length > 0) {
    return configuredUrl;
  }

  if (typeof window === 'undefined') {
    return 'ws://localhost:3000/ws';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:3000/ws`;
}

function parseMouseMovedMessage(rawPayload: string): MouseMovedMessage | null {
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'type' in parsed &&
      parsed.type === 'mouse_moved' &&
      'participantId' in parsed &&
      typeof parsed.participantId === 'string' &&
      'name' in parsed &&
      typeof parsed.name === 'string' &&
      'boardX' in parsed &&
      typeof parsed.boardX === 'number' &&
      Number.isFinite(parsed.boardX) &&
      'boardY' in parsed &&
      typeof parsed.boardY === 'number' &&
      Number.isFinite(parsed.boardY)
    ) {
      return parsed as MouseMovedMessage;
    }
  } catch {
    return null;
  }

  return null;
}

function parseBoardStateMessage(rawPayload: string): BoardStateMessage | null {
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'type' in parsed &&
      (parsed.type === 'board_state' || parsed.type === 'board_state_updated') &&
      'boardId' in parsed &&
      typeof parsed.boardId === 'string' &&
      'state' in parsed &&
      typeof parsed.state === 'object' &&
      parsed.state !== null &&
      'elements' in parsed.state &&
      Array.isArray(parsed.state.elements)
    ) {
      return parsed as BoardStateMessage;
    }
  } catch {
    return null;
  }

  return null;
}

function cloneBoardElements(elements: ReadonlyArray<BoardElement>): BoardElement[] {
  return elements.map((element) => ({ ...element }));
}

function hasElementMutation(messageDeltas: Array<{ type: string }>) {
  return messageDeltas.some(
    (delta) =>
      delta.type === 'element_added' ||
      delta.type === 'element_removed' ||
      delta.type === 'element_updated'
  );
}

export function App() {
  const [remotePointers, setRemotePointers] = useState<Record<string, RemotePointer>>({});
  const participantId = useMemo(() => createParticipantId(), []);
  const participantName = useMemo(() => createRandomParticipantName(), []);
  const sendPointerRef = useRef<(position: { x: number; y: number }) => void>(() => {});
  const socketRef = useRef<WebSocket | null>(null);
  const boardEngineRef = useRef<BoardEngine | null>(null);
  const pendingBoardElementsRef = useRef<BoardElement[] | null>(null);
  const applyingRemoteBoardStateRef = useRef(false);
  const unsubscribeBoardEngineRef = useRef<(() => void) | null>(null);

  const applyIncomingBoardElements = useCallback((elements: BoardElement[]) => {
    const engine = boardEngineRef.current;
    if (!engine) {
      pendingBoardElementsRef.current = elements;
      return;
    }

    applyingRemoteBoardStateRef.current = true;
    try {
      engine.dispatch.setElements({
        elements: cloneBoardElements(elements)
      });
    } finally {
      applyingRemoteBoardStateRef.current = false;
    }
  }, []);

  const sendBoardStateUpdate = useCallback((engine: BoardEngine) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const state = engine.getState();
    const payload: UpdateBoardStateMessage = {
      type: 'update_board_state',
      boardId: DEFAULT_BOARD.id,
      state: {
        elements: state.elementOrder.map((id) => ({ ...state.elements[id] }))
      }
    };
    socket.send(JSON.stringify(payload));
  }, []);

  const handleBoardEngineReady = useCallback(
    (engine: BoardEngine) => {
      boardEngineRef.current = engine;
      unsubscribeBoardEngineRef.current?.();
      unsubscribeBoardEngineRef.current = engine.subscribe((update) => {
        if (applyingRemoteBoardStateRef.current || !hasElementMutation(update.deltas)) {
          return;
        }
        sendBoardStateUpdate(engine);
      });

      if (pendingBoardElementsRef.current) {
        applyIncomingBoardElements(pendingBoardElementsRef.current);
        pendingBoardElementsRef.current = null;
      }
    },
    [applyIncomingBoardElements, sendBoardStateUpdate]
  );

  useEffect(() => {
    document.title = DEFAULT_BOARD.name;
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      return;
    }

    if (typeof WebSocket === 'undefined') {
      return;
    }

    const socket = new WebSocket(resolveWebSocketUrl());
    socketRef.current = socket;

    const onPointerMove = (position: { x: number; y: number }) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      const payload: MouseMovedMessage = {
        type: 'mouse_moved',
        participantId,
        name: participantName,
        boardX: position.x,
        boardY: position.y
      };
      socket.send(JSON.stringify(payload));
    };

    sendPointerRef.current = onPointerMove;

    socket.onopen = () => {
      const payload: RequestBoardStateMessage = {
        type: 'request_board_state',
        boardId: DEFAULT_BOARD.id,
        initialState: {
          elements: cloneBoardElements(DEFAULT_BOARD.elements)
        }
      };
      socket.send(JSON.stringify(payload));
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        return;
      }

      const boardStateMessage = parseBoardStateMessage(event.data);
      if (boardStateMessage && boardStateMessage.boardId === DEFAULT_BOARD.id) {
        applyIncomingBoardElements(boardStateMessage.state.elements);
        return;
      }

      const message = parseMouseMovedMessage(event.data);
      if (!message || message.participantId === participantId) {
        return;
      }

      setRemotePointers((currentPointers) => ({
        ...currentPointers,
        [message.participantId]: {
          participantId: message.participantId,
          name: message.name,
          x: message.boardX,
          y: message.boardY,
          updatedAt: Date.now()
        }
      }));
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    const stalePointerCleanupInterval = window.setInterval(() => {
      const staleThreshold = Date.now() - 15_000;
      setRemotePointers((currentPointers) =>
        Object.fromEntries(
          Object.entries(currentPointers).filter(
            ([, pointer]) => pointer.updatedAt > staleThreshold
          )
        )
      );
    }, 5_000);

    return () => {
      sendPointerRef.current = () => {};
      window.clearInterval(stalePointerCleanupInterval);
      socketRef.current = null;
      socket.close();
    };
  }, [participantId, participantName]);

  useEffect(() => {
    return () => {
      unsubscribeBoardEngineRef.current?.();
      unsubscribeBoardEngineRef.current = null;
    };
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
      <OverlayParticipant>You: {participantName}</OverlayParticipant>
      <BoardComponent
        boardId={DEFAULT_BOARD.id}
        initialElements={DEFAULT_BOARD.elements}
        onEngineReady={handleBoardEngineReady}
        onBoardPointerMove={(point) => {
          sendPointerRef.current(point);
        }}
        remotePointers={Object.values(remotePointers).map((pointer) => ({
          participantId: pointer.participantId,
          name: pointer.name,
          x: pointer.x,
          y: pointer.y
        }))}
      />
    </Shell>
  );
}
