// server/turnManager.ts

import type { Server } from "socket.io";
import type { Room } from "./types";
import { getRandomWords, generateHint, getNextHintIndex } from "./wordBank";

export class TurnManager {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  startTurn(room: Room): void {
    // Pick next drawer
    const drawer = room.players[room.currentDrawerIndex];
    if (!drawer) return;

    // Reset turn state
    room.players.forEach((p) => {
      p.isDrawing = false;
      p.hasGuessedCorrectly = false;
    });
    drawer.isDrawing = true;

    room.drawingData = [];
    room.hintsRevealed = [];
    room.currentWord = "";
    room.status = "choosing-word";

    // Generate 3 word choices
    room.wordChoices = getRandomWords(3);

    // Tell everyone a new turn started
    this.io.to(room.roomId).emit("turn-start", {
      drawerName: drawer.name,
      drawerId: drawer.id,
      round: room.currentRound,
    });

    // Send word choices only to the drawer
    this.io.to(drawer.id).emit("choose-word", {
      words: room.wordChoices,
    });

    // Auto-pick word if drawer doesn't choose within 15 seconds
    const autoPickTimeout = setTimeout(() => {
      if (room.status === "choosing-word") {
        const randomWord =
          room.wordChoices[Math.floor(Math.random() * room.wordChoices.length)] ?? "";
        this.handleWordChosen(room, randomWord);
      }
    }, 15000);

    // Store timeout so we can clear it
    (room as any)._autoPickTimeout = autoPickTimeout;
  }

  handleWordChosen(room: Room, word: string): void {
    // Clear auto-pick timeout
    if ((room as any)._autoPickTimeout) {
      clearTimeout((room as any)._autoPickTimeout);
      (room as any)._autoPickTimeout = null;
    }

    room.currentWord = word.toLowerCase();
    room.status = "drawing";
    room.turnTimeLeft = room.settings.drawTime;

    // Tell all non-drawers the word length (as underscores)
    const hint = generateHint(room.currentWord, []);
    this.io.to(room.roomId).emit("word-chosen-notification", {
      hint,
      wordLength: room.currentWord.length,
      drawTime: room.settings.drawTime,
    });

    // Tell the drawer the actual word (confirmation)
    const drawer = room.players.find((p) => p.isDrawing);
    if (drawer) {
      this.io.to(drawer.id).emit("your-word", { word: room.currentWord });
    }

    // Start countdown timer
    this.startTimer(room);
  }

  private startTimer(room: Room): void {
    // Clear any existing timer
    if (room.turnTimer) {
      clearInterval(room.turnTimer);
    }

    const totalTime = room.settings.drawTime;
    const hintTime1 = Math.floor(totalTime * 0.5);  // first hint at 50% time
    const hintTime2 = Math.floor(totalTime * 0.75);  // second hint at 75% time

    room.turnTimer = setInterval(() => {
      room.turnTimeLeft--;

      // Broadcast timer
      this.io.to(room.roomId).emit("timer-update", {
        timeLeft: room.turnTimeLeft,
      });

      // Reveal hints at intervals
      const elapsed = totalTime - room.turnTimeLeft;
      if (room.settings.hints) {
        if (elapsed === hintTime1 || elapsed === hintTime2) {
          const newIndex = getNextHintIndex(room.currentWord, room.hintsRevealed);
          if (newIndex !== -1) {
            room.hintsRevealed.push(newIndex);
            const hint = generateHint(room.currentWord, room.hintsRevealed);
            this.io.to(room.roomId).emit("hint-reveal", { hint });
          }
        }
      }

      // Time's up
      if (room.turnTimeLeft <= 0) {
        this.endTurn(room);
      }
    }, 1000);
  }

  endTurn(room: Room): void {
    // Clear timer
    if (room.turnTimer) {
      clearInterval(room.turnTimer);
      room.turnTimer = null;
    }

    room.status = "turn-end";

    // Broadcast turn end with the word reveal
    this.io.to(room.roomId).emit("turn-end", {
      word: room.currentWord,
      scores: room.players.map((p) => ({
        name: p.name,
        score: p.score,
        id: p.id,
      })),
    });

    // After 5 seconds, move to next turn or round
    setTimeout(() => {
      this.advanceGame(room);
    }, 5000);
  }

  private advanceGame(room: Room): void {
    // Check if all players have drawn this round
    room.currentDrawerIndex++;

    if (room.currentDrawerIndex >= room.players.length) {
      // Round is over
      room.currentDrawerIndex = 0;
      room.currentRound++;

      if (room.currentRound > room.maxRounds) {
        // Game over
        this.endGame(room);
        return;
      }

      // Show round-end scoreboard
      room.status = "round-end";
      this.io.to(room.roomId).emit("round-end", {
        round: room.currentRound - 1,
        scores: room.players
          .map((p) => ({ name: p.name, score: p.score, id: p.id }))
          .sort((a, b) => b.score - a.score),
        nextRound: room.currentRound,
      });

      // Start next round after 5 seconds
      setTimeout(() => {
        if (room.status !== "game-over" && room.players.length >= 2) {
          this.startTurn(room);
        }
      }, 5000);
    } else {
      // Next player draws in same round
      if (room.players.length >= 2) {
        this.startTurn(room);
      }
    }
  }

  private endGame(room: Room): void {
    room.status = "game-over";

    const finalScores = room.players
      .map((p) => ({ name: p.name, score: p.score, id: p.id }))
      .sort((a, b) => b.score - a.score);

    this.io.to(room.roomId).emit("game-over", {
      scores: finalScores,
      winner: finalScores[0],
    });
  }

  checkAllGuessed(room: Room): boolean {
    // Check if all non-drawing players have guessed correctly
    const nonDrawers = room.players.filter((p) => !p.isDrawing);
    return nonDrawers.every((p) => p.hasGuessedCorrectly);
  }
}