// server/index.ts

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { GameManager } from "./gameManager";
import type { StrokeData, RoomSettings } from "./types";

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Serve static frontend ──────────────────────────────────────
const publicPath = path.join(import.meta.dir, "..", "public");
app.use(express.static(publicPath));

// Fallback routes
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/game", (_req, res) => {
  res.sendFile(path.join(publicPath, "game.html"));
});

// Health check endpoint (useful for AWS monitoring)
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    rooms: gameManager.getRoomCount(),
    players: gameManager.getPlayerCount(),
    uptime: process.uptime(),
  });
});

// ── Game Manager ────────────────────────────────────────────────
const gameManager = new GameManager(io);

// ── Socket.io Connection Handling ───────────────────────────────
io.on("connection", (socket) => {
  console.log(`✅ Player connected: ${socket.id}`);

  // ── Room Events ──
  socket.on("create-room", (playerName: string, callback: Function) => {
    try {
      const result = gameManager.createRoom(socket, playerName);
      callback({ success: true, roomId: result.roomId });
    } catch (error) {
      callback({ success: false, error: "Failed to create room" });
    }
  });

  socket.on(
    "join-room",
    (roomId: string, playerName: string, callback: Function) => {
      try {
        const result = gameManager.joinRoom(socket, roomId, playerName);
        callback(result);
      } catch (error) {
        callback({ success: false, error: "Failed to join room" });
      }
    }
  );

  // ── Game Control Events ──
  socket.on("start-game", () => {
    gameManager.startGame(socket);
  });

  socket.on("word-chosen", (word: string) => {
    gameManager.handleWordChosen(socket, word);
  });

  socket.on("update-settings", (settings: Partial<RoomSettings>) => {
    gameManager.updateSettings(socket, settings);
  });

  // ── Drawing Events ──
  socket.on("draw", (strokeData: StrokeData) => {
    gameManager.handleDraw(socket, strokeData);
  });

  socket.on("clear-canvas", () => {
    gameManager.handleClearCanvas(socket);
  });

  // ── Chat/Guess Events ──
  socket.on("send-guess", (message: string) => {
    gameManager.handleGuess(socket, message);
  });

  socket.on("play-again", () => {
    gameManager.handlePlayAgain(socket);
  });

  // ── Disconnection ──
  socket.on("disconnect", () => {
    console.log(`❌ Player disconnected: ${socket.id}`);
    gameManager.handleDisconnect(socket);
  });
});

// ── Start Server ────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0'; // Bind to all network interfaces

server.listen(PORT, HOST, () => {
  // Get local IP for display
  const nets = require('os').networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }

  console.log(`
╔══════════════════════════════════════════════╗
║        🎨 Skribbl Clone Server 🎨           ║
║                                              ║
║   Local:   http://localhost:${PORT}            ║
║   Network: http://${localIP}:${PORT}   ║
║                                              ║
║   Share the Network URL with friends!        ║
╚══════════════════════════════════════════════╝
  `);
});