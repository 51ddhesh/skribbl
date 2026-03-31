// server/types.ts

export interface Player {
  id: string;           // socket id
  name: string;
  score: number;
  isDrawing: boolean;
  hasGuessedCorrectly: boolean;
  avatar: number;
}

export type RoomStatus =
  | "waiting"
  | "choosing-word"
  | "drawing"
  | "turn-end"
  | "round-end"
  | "game-over";

export interface RoomSettings {
  drawTime: number;     // seconds per turn
  rounds: number;       // total rounds
  maxPlayers: number;
  hints: boolean;
}

export interface StrokeData {
  type: "draw" | "erase" | "fill";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  size: number;
}

export interface Room {
  roomId: string;
  players: Player[];
  currentRound: number;
  maxRounds: number;
  currentWord: string;
  currentDrawerIndex: number;
  turnTimeLeft: number;
  status: RoomStatus;
  drawingData: StrokeData[];  // stroke history for late joiners
  settings: RoomSettings;
  turnTimer: ReturnType<typeof setInterval> | null;
  wordChoices: string[];      // 3 word options for drawer
  hintsRevealed: number[];    // indices of revealed letters
}

// Socket.io event payloads

export interface CreateRoomCallback {
  success: boolean;
  roomId?: string;
  error?: string;
}

export interface JoinRoomCallback {
  success: boolean;
  error?: string;
  room?: {
    roomId: string;
    players: {
      name: string;
      score: number;
      isDrawing: boolean;
      avatar?: number;
      hasGuessedCorrectly?: boolean;
    }[];
    status: RoomStatus;
    settings: RoomSettings;
  };
}

export interface ChatMessage {
  playerName: string;
  message: string;
  type: "chat" | "system" | "correct-guess";
}