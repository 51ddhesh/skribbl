// server/gameManager.ts

import type { Server, Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import type { Room, Player, StrokeData, CreateRoomCallback, JoinRoomCallback, ChatMessage } from "./types";
import { TurnManager } from "./turnManager";
import { calculateGuessScore } from "./scoreManager";

export class GameManager {
  private io: Server;
  private rooms: Map<string, Room>;
  private playerRoomMap: Map<string, string>;  // socketId -> roomId
  private turnManager: TurnManager;

  constructor(io: Server) {
    this.io = io;
    this.rooms = new Map();
    this.playerRoomMap = new Map();
    this.turnManager = new TurnManager(io);
  }

  // ── Room Management ──────────────────────────────────────────

  createRoom(socket: Socket, playerName: string): { roomId: string } {
    const roomId = uuidv4().substring(0, 6).toUpperCase();

    const player: Player = {
      id: socket.id,
      name: playerName,
      score: 0,
      isDrawing: false,
      hasGuessedCorrectly: false,
      avatar: Math.floor(Math.random() * 10) + 1,
    };

    const room: Room = {
      roomId,
      players: [player],
      currentRound: 1,
      maxRounds: 3,
      currentWord: "",
      currentDrawerIndex: 0,
      turnTimeLeft: 0,
      status: "waiting",
      drawingData: [],
      settings: {
        drawTime: 60,
        rounds: 3,
        maxPlayers: 8,
        hints: true,
      },
      turnTimer: null,
      wordChoices: [],
      hintsRevealed: [],
    };

    this.rooms.set(roomId, room);
    this.playerRoomMap.set(socket.id, roomId);
    socket.join(roomId);

    console.log(`Room ${roomId} created by ${playerName}`);
    return { roomId };
  }

  joinRoom(
    socket: Socket,
    roomId: string,
    playerName: string
  ): JoinRoomCallback {
    const normalizedId = roomId.toUpperCase();
    const room = this.rooms.get(normalizedId);

    if (!room) {
      return { success: false, error: "Room not found" };
    }

    if (room.players.length >= room.settings.maxPlayers) {
      return { success: false, error: "Room is full" };
    }

    // Check if player with same name already exists
    const existingPlayer = room.players.find((p) => p.name === playerName);
    if (existingPlayer) {
      // If it's a reconnection (same name), replace old socket
      existingPlayer.id = socket.id;
      this.playerRoomMap.set(socket.id, normalizedId);
      socket.join(room.roomId);

      // Send existing canvas data
      if (room.status === "drawing" && room.drawingData.length > 0) {
        socket.emit("canvas-data", { strokes: room.drawingData });
      }

      return {
        success: true,
        room: {
          roomId: room.roomId,
          players: room.players.map((p) => ({
            name: p.name,
            score: p.score,
            isDrawing: p.isDrawing,
            avatar: p.avatar,
            hasGuessedCorrectly: p.hasGuessedCorrectly,
          })),
          status: room.status,
          settings: room.settings,
        },
      };
    }

    const player: Player = {
      id: socket.id,
      name: playerName,
      score: 0,
      isDrawing: false,
      hasGuessedCorrectly: false,
      avatar: Math.floor(Math.random() * 10) + 1,
    };

    room.players.push(player);
    this.playerRoomMap.set(socket.id, normalizedId);
    socket.join(room.roomId);

    // Notify existing players
    socket.to(room.roomId).emit("player-joined", {
      playerName: player.name,
      playerCount: room.players.length,
      players: room.players.map((p) => ({
        name: p.name,
        score: p.score,
        isDrawing: p.isDrawing,
        avatar: p.avatar,
        hasGuessedCorrectly: p.hasGuessedCorrectly,
      })),
    });

    // System message
    const sysMsg: ChatMessage = {
      playerName: "System",
      message: `${playerName} joined the room`,
      type: "system",
    };
    this.io.to(room.roomId).emit("chat-message", sysMsg);

    console.log(`${playerName} joined room ${room.roomId}`);

    // Send existing canvas data if game is in progress
    if (room.status === "drawing" && room.drawingData.length > 0) {
      socket.emit("canvas-data", { strokes: room.drawingData });
    }

    return {
      success: true,
      room: {
        roomId: room.roomId,
        players: room.players.map((p) => ({
          name: p.name,
          score: p.score,
          isDrawing: p.isDrawing,
          avatar: p.avatar,
          hasGuessedCorrectly: p.hasGuessedCorrectly,
        })),
        status: room.status,
        settings: room.settings,
      },
    };
  }
  // ── Game Flow ────────────────────────────────────────────────

  startGame(socket: Socket): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;

    // Only the first player (host) can start
    const host = room.players[0];

    if (!host || host.id !== socket.id) {
        socket.emit("error-message", { message: "Only the host can start the game" });
        return;
    }
    
    if (room.players.length < 2) {
      socket.emit("error-message", { message: "Need at least 2 players to start" });
      return;
    }

    room.maxRounds = room.settings.rounds;
    room.currentRound = 1;
    room.currentDrawerIndex = 0;
    room.players.forEach((p) => (p.score = 0));

    this.io.to(room.roomId).emit("game-started", {
      rounds: room.maxRounds,
      drawTime: room.settings.drawTime,
    });

    console.log(`Game started in room ${room.roomId}`);

    // Start first turn
    this.turnManager.startTurn(room);
  }

  handleWordChosen(socket: Socket, word: string): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;

    const drawer = room.players.find((p) => p.isDrawing);
    if (!drawer || drawer.id !== socket.id) return;

    // Verify the word is one of the choices
    if (!room.wordChoices.includes(word)) return;

    this.turnManager.handleWordChosen(room, word);
  }

  // ── Drawing ──────────────────────────────────────────────────

  handleDraw(socket: Socket, strokeData: StrokeData): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.isDrawing) return;

    // Store stroke for late joiners
    room.drawingData.push(strokeData);

    // Broadcast to all other players in the room
    socket.to(room.roomId).emit("draw", strokeData);
  }

  handleClearCanvas(socket: Socket): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.isDrawing) return;

    room.drawingData = [];
    socket.to(room.roomId).emit("clear-canvas");
  }

  // ── Guessing ─────────────────────────────────────────────────

  handleGuess(socket: Socket, message: string): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room || room.status !== "drawing") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;

    // Drawing player can't guess
    if (player.isDrawing) return;

    // Already guessed correctly
    if (player.hasGuessedCorrectly) {
      // Let them chat but only show to other correct guessers
      this.io.to(room.roomId).emit("chat-message", {
        playerName: player.name,
        message: "(already guessed)",
        type: "system",
      } as ChatMessage);
      return;
    }

    const guess = message.trim().toLowerCase();
    const currentWord = room.currentWord.toLowerCase();

    if (guess === currentWord) {
      // Correct guess!
      player.hasGuessedCorrectly = true;

      const correctGuessCount = room.players.filter(
        (p) => p.hasGuessedCorrectly && p.id !== player.id
      ).length;

      const timeElapsed = room.settings.drawTime - room.turnTimeLeft;
      const scoreResult = calculateGuessScore(
        timeElapsed,
        room.settings.drawTime,
        correctGuessCount
      );

      // Award points
      player.score += scoreResult.guesserPoints;

      // Award drawer points
      const drawer = room.players.find((p) => p.isDrawing);
      if (drawer) {
        drawer.score += scoreResult.drawerPoints;
      }

      // Broadcast correct guess (don't reveal the word!)
      this.io.to(room.roomId).emit("correct-guess", {
        playerName: player.name,
        points: scoreResult.guesserPoints,
        isFirstGuess: scoreResult.isFirstGuess,
      });

      // Update scores for everyone
      this.io.to(room.roomId).emit("score-update", {
        scores: room.players.map((p) => ({
          name: p.name,
          score: p.score,
          id: p.id,
          hasGuessedCorrectly: p.hasGuessedCorrectly,
        })),
      });

      // System message
      this.io.to(room.roomId).emit("chat-message", {
        playerName: "System",
        message: `${player.name} guessed the word! (+${scoreResult.guesserPoints})`,
        type: "correct-guess",
      } as ChatMessage);

      console.log(
        `${player.name} guessed "${currentWord}" in room ${room.roomId} (+${scoreResult.guesserPoints})`
      );

      // Check if all players have guessed
      if (this.turnManager.checkAllGuessed(room)) {
        this.turnManager.endTurn(room);
      }
    } else {
      // Wrong guess — show as regular chat
      // Check if guess is close (optional: show "almost" hint)
      const isClose = this.isCloseGuess(guess, currentWord);

      const chatMsg: ChatMessage = {
        playerName: player.name,
        message: message.trim(),
        type: "chat",
      };
      this.io.to(room.roomId).emit("chat-message", chatMsg);

      if (isClose) {
        socket.emit("chat-message", {
          playerName: "System",
          message: "That's close!",
          type: "system",
        } as ChatMessage);
      }
    }
  }

    handlePlayAgain(socket: Socket): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;

    if (room?.players[0]?.id !== socket.id) {
      socket.emit("error-message", { message: "Only the host can restart" });
      return;
    }

    room.status = "waiting";
    room.currentRound = 1;
    room.currentDrawerIndex = 0;
    room.currentWord = "";
    room.drawingData = [];
    room.hintsRevealed = [];
    room.wordChoices = [];

    room.players.forEach((p) => {
      p.score = 0;
      p.isDrawing = false;
      p.hasGuessedCorrectly = false;
    });

    if (room.turnTimer) {
      clearInterval(room.turnTimer);
      room.turnTimer = null;
    }

    this.io.to(room.roomId).emit("game-reset", {
      players: room.players.map((p) => ({
        name: p.name,
        score: 0,
        isDrawing: false,
        avatar: p.avatar,
      })),
    });
  }

  private isCloseGuess(guess: string, word: string): boolean {
    if (guess.length < 3 || word.length < 3) return false;

    // Simple check: same length and >60% characters match
    if (Math.abs(guess.length - word.length) > 2) return false;

    let matches = 0;
    const shorter = guess.length < word.length ? guess : word;
    const longer = guess.length >= word.length ? guess : word;

    for (let i = 0; i < shorter.length; i++) {
      if (shorter[i] === longer[i]) matches++;
    }

    return matches / longer.length > 0.6;
  }

  // ── Settings ─────────────────────────────────────────────────

  updateSettings(
    socket: Socket,
    settings: Partial<Room["settings"]>
  ): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;

    // Only host can change settings
    if (room.players?.[0]?.id !== socket.id) return;

    if (room.status !== "waiting") return;

    if (settings.drawTime) {
      room.settings.drawTime = Math.min(120, Math.max(30, settings.drawTime));
    }
    if (settings.rounds) {
      room.settings.rounds = Math.min(10, Math.max(1, settings.rounds));
    }
    if (settings.maxPlayers) {
      room.settings.maxPlayers = Math.min(12, Math.max(2, settings.maxPlayers));
    }
    if (typeof settings.hints === "boolean") {
      room.settings.hints = settings.hints;
    }

    this.io.to(room.roomId).emit("settings-updated", room.settings);
  }

  // ── Disconnection ────────────────────────────────────────────

  handleDisconnect(socket: Socket): void {
    const room = this.getPlayerRoom(socket.id);
    if (!room) return;

    const player = room.players.find((p) => p.id === socket.id);
    const playerName = player?.name || "Unknown";
    const wasDrawing = player?.isDrawing || false;

    // Remove player
    room.players = room.players.filter((p) => p.id !== socket.id);
    this.playerRoomMap.delete(socket.id);

    console.log(`${playerName} disconnected from room ${room.roomId}`);

    // If room is empty, delete it
    if (room.players.length === 0) {
      if (room.turnTimer) clearInterval(room.turnTimer);
      this.rooms.delete(room.roomId);
      console.log(`Room ${room.roomId} deleted (empty)`);
      return;
    }

    // Notify remaining players
    this.io.to(room.roomId).emit("player-left", {
      playerName,
      playerCount: room.players.length,
      players: room.players.map((p) => ({
        name: p.name,
        score: p.score,
        isDrawing: p.isDrawing,
      })),
    });

    this.io.to(room.roomId).emit("chat-message", {
      playerName: "System",
      message: `${playerName} left the room`,
      type: "system",
    } as ChatMessage);

    // If less than 2 players, end the game
    if (room.players.length < 2 && room.status !== "waiting") {
      if (room.turnTimer) clearInterval(room.turnTimer);
      room.status = "waiting";
      room.currentRound = 1;
      room.currentDrawerIndex = 0;
      this.io.to(room.roomId).emit("game-ended-insufficient-players", {
        message: "Not enough players to continue",
      });
      return;
    }

    // If the drawing player left, end the turn
    if (wasDrawing && room.status === "drawing") {
      // Fix drawer index if needed
      if (room.currentDrawerIndex >= room.players.length) {
        room.currentDrawerIndex = 0;
      }
      this.turnManager.endTurn(room);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────

  private getPlayerRoom(socketId: string): Room | null {
    const roomId = this.playerRoomMap.get(socketId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  getPlayerCount(): number {
    return this.playerRoomMap.size;
  }
}