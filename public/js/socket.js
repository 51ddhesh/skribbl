// public/js/socket.js

const socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});

// ── Determine action from URL params ──
const action = urlParams.get('action'); // 'create' or 'join'

socket.on('connect', () => {
  console.log('Connected to server:', socket.id);

  if (action === 'create') {
    // ── CREATE a new room, then show lobby ──
    socket.emit('create-room', playerName, (response) => {
      if (!response.success) {
        alert(response.error || 'Failed to create room');
        window.location.href = '/';
        return;
      }

      console.log('Room created:', response.roomId);

      // Update the URL so it has the room code (without reloading)
      const newUrl = `/game?room=${response.roomId}&name=${encodeURIComponent(playerName)}&avatar=${playerAvatar}&action=host`;
      window.history.replaceState({}, '', newUrl);

      // Update displayed room code
      document.getElementById('roomCode').textContent = response.roomId;
      document.getElementById('lobbyRoomCode').textContent = response.roomId;

      // Mark as host
      window._isHost = true;
      document.getElementById('startGameBtn').style.display = 'inline-flex';
      document.getElementById('waitingMsg').style.display = 'none';

      // Update player list with just us
      updatePlayersList([{
        name: playerName,
        score: 0,
        isDrawing: false,
        avatar: playerAvatar,
      }]);

      document.getElementById('lobbyPlayerCount').textContent = '1 player(s) in lobby';
      showOverlay('lobbyOverlay');
    });

  } else if (action === 'join' && roomId) {
    // ── JOIN an existing room ──
    joinExistingRoom();

  } else if (action === 'host' && roomId) {
    // ── Page was refreshed after creating — rejoin ──
    joinExistingRoom();

  } else if (roomId) {
    // ── Fallback: try to join if there's a room param ──
    joinExistingRoom();

  } else {
    // No valid action
    alert('Invalid game URL');
    window.location.href = '/';
  }
});

function joinExistingRoom() {
  socket.emit('join-room', roomId, playerName, (response) => {
    if (!response.success) {
      alert(response.error || 'Room not found. It may have expired.');
      window.location.href = '/';
      return;
    }

    console.log('Joined room:', response.room);

    // Update room code display
    document.getElementById('roomCode').textContent = response.room.roomId;
    document.getElementById('lobbyRoomCode').textContent = response.room.roomId;

    updatePlayersList(response.room.players);
    totalRounds = response.room.settings.rounds;
    gameSettings = response.room.settings;

    document.getElementById('lobbyPlayerCount').textContent =
      `${response.room.players.length} player(s) in lobby`;

    // Update settings display
    document.getElementById('settingDrawTime').value = response.room.settings.drawTime;
    document.getElementById('settingRounds').value = response.room.settings.rounds;
    document.getElementById('settingHints').value = String(response.room.settings.hints);

    // Check if we are the host (first player in list)
    const isFirstPlayer = response.room.players[0]?.name === playerName;
    window._isHost = isFirstPlayer;

    if (isFirstPlayer) {
      document.getElementById('startGameBtn').style.display = 'inline-flex';
      document.getElementById('waitingMsg').style.display = 'none';
    } else {
      document.getElementById('startGameBtn').style.display = 'none';
      document.getElementById('waitingMsg').style.display = 'block';
      // Disable settings for non-host
      document.querySelectorAll('.lobby-settings select').forEach(s => s.disabled = true);
    }

    // Show appropriate overlay
    if (response.room.status === 'waiting') {
      showOverlay('lobbyOverlay');
    } else {
      hideAllOverlays();
    }
  });
}

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  addChatMessage({
    playerName: 'System',
    message: '⚠️ Connection lost. Reconnecting...',
    type: 'system',
  });
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err.message);
});

// ── Lobby Events ──
socket.on('player-joined', (data) => {
  updatePlayersList(data.players);
  document.getElementById('lobbyPlayerCount').textContent =
    `${data.playerCount} player(s) in lobby`;
});

socket.on('player-left', (data) => {
  updatePlayersList(data.players);
  document.getElementById('lobbyPlayerCount').textContent =
    `${data.playerCount} player(s) in lobby`;
});

socket.on('settings-updated', (settings) => {
  gameSettings = settings;
  totalRounds = settings.rounds;

  document.getElementById('settingDrawTime').value = settings.drawTime;
  document.getElementById('settingRounds').value = settings.rounds;
  document.getElementById('settingHints').value = String(settings.hints);

  addChatMessage({
    playerName: 'System',
    message: 'Game settings updated',
    type: 'system',
  });
});

// ── Game Start ──
socket.on('game-started', (data) => {
  hideAllOverlays();
  totalRounds = data.rounds;
  document.getElementById('roundCurrent').textContent = '1';
  document.getElementById('roundTotal').textContent = data.rounds;
  addChatMessage({
    playerName: 'System',
    message: `Game started! ${data.rounds} rounds, ${data.drawTime}s per turn`,
    type: 'system',
  });
});

// ── Turn Events ──
socket.on('turn-start', (data) => {
  hideAllOverlays();
  clearCanvas();

  document.getElementById('roundCurrent').textContent = data.round;
  document.getElementById('roundTotal').textContent = totalRounds;
  document.getElementById('wordHint').textContent = '';
  document.getElementById('wordHint').classList.remove('has-word');
  document.getElementById('timer').textContent = '--';
  document.getElementById('timer').classList.remove('urgent');

  const amDrawing = data.drawerId === socket.id;
  setDrawingEnabled(amDrawing);

  const chatInput = document.getElementById('chatInput');
  chatInput.disabled = amDrawing;
  chatInput.placeholder = amDrawing ? "You're drawing! 🎨" : 'Type your guess...';

  addChatMessage({
    playerName: 'System',
    message: `🖌️ ${data.drawerName} is choosing a word...`,
    type: 'system',
  });
});

// ── Word Selection ──
socket.on('choose-word', (data) => {
  showOverlay('wordChoiceOverlay');

  const container = document.getElementById('wordChoices');
  container.innerHTML = '';

  data.words.forEach((word) => {
    const btn = document.createElement('button');
    btn.className = 'word-choice-btn';
    btn.textContent = word;
    btn.addEventListener('click', () => {
      socket.emit('word-chosen', word);
      hideAllOverlays();
    });
    container.appendChild(btn);
  });

  // Countdown for word pick
  let timeLeft = 15;
  const timerText = document.getElementById('wordTimer');
  timerText.textContent = `Auto-picking in ${timeLeft}s...`;

  if (window._wordPickInterval) clearInterval(window._wordPickInterval);
  window._wordPickInterval = setInterval(() => {
    timeLeft--;
    timerText.textContent = `Auto-picking in ${timeLeft}s...`;
    if (timeLeft <= 0) clearInterval(window._wordPickInterval);
  }, 1000);
});

socket.on('word-chosen-notification', (data) => {
  hideAllOverlays();
  if (window._wordPickInterval) clearInterval(window._wordPickInterval);

  document.getElementById('wordHint').textContent = data.hint;
  document.getElementById('wordHint').classList.remove('has-word');
  document.getElementById('timer').textContent = data.drawTime;

  addChatMessage({
    playerName: 'System',
    message: `Word chosen! ${data.wordLength} letters — start guessing!`,
    type: 'system',
  });
});

socket.on('your-word', (data) => {
  document.getElementById('wordHint').textContent = data.word.toUpperCase();
  document.getElementById('wordHint').classList.add('has-word');
});

// ── Drawing Events ──
socket.on('draw', (strokeData) => {
  drawStroke(strokeData);
});

socket.on('clear-canvas', () => {
  clearCanvas();
});

socket.on('canvas-data', (data) => {
  if (data.strokes && data.strokes.length > 0) {
    replayStrokes(data.strokes);
  }
});

// ── Timer & Hints ──
socket.on('timer-update', (data) => {
  const timerEl = document.getElementById('timer');
  timerEl.textContent = data.timeLeft;

  if (data.timeLeft <= 10) {
    timerEl.classList.add('urgent');
  } else {
    timerEl.classList.remove('urgent');
  }
});

socket.on('hint-reveal', (data) => {
  if (!isMyTurn) {
    document.getElementById('wordHint').textContent = data.hint;
  }
});

// ── Chat & Guessing ──
socket.on('chat-message', (msg) => {
  addChatMessage(msg);
});

socket.on('correct-guess', (data) => {
  addChatMessage({
    playerName: 'System',
    message: `🎉 ${data.playerName} guessed the word! (+${data.points}${data.isFirstGuess ? ' 🥇 FIRST!' : ''})`,
    type: 'correct-guess',
  });
});

socket.on('score-update', (data) => {
  updatePlayersList(data.scores);
});

// ── Turn End ──
socket.on('turn-end', (data) => {
  setDrawingEnabled(false);

  document.getElementById('turnEndTitle').textContent = '⏰ Turn Over!';
  document.getElementById('turnEndWord').textContent = data.word;

  const scores = data.scores.sort((a, b) => b.score - a.score);
  renderScoreboard('turnEndScores', scores);

  showOverlay('turnEndOverlay');

  addChatMessage({
    playerName: 'System',
    message: `The word was: ${data.word}`,
    type: 'system',
  });
});

// ── Round End ──
socket.on('round-end', (data) => {
  document.getElementById('roundEndTitle').textContent = `📊 Round ${data.round} Complete!`;
  document.getElementById('roundEndSubtitle').textContent = `Starting round ${data.nextRound}...`;

  renderScoreboard('roundEndScores', data.scores);
  showOverlay('roundEndOverlay');

  document.getElementById('roundCurrent').textContent = data.nextRound;
});

// ── Game Over ──
socket.on('game-over', (data) => {
  setDrawingEnabled(false);

  document.getElementById('winnerText').textContent =
    `${data.winner.name} wins with ${data.winner.score} points!`;

  renderScoreboard('gameOverScores', data.scores);
  showOverlay('gameOverOverlay');

  addChatMessage({
    playerName: 'System',
    message: `🏆 Game over! ${data.winner.name} wins!`,
    type: 'correct-guess',
  });
});

socket.on('game-ended-insufficient-players', (data) => {
  addChatMessage({
    playerName: 'System',
    message: data.message,
    type: 'system',
  });
  showOverlay('lobbyOverlay');
  if (window._isHost) {
    document.getElementById('startGameBtn').style.display = 'inline-flex';
  }
});

socket.on('game-reset', (data) => {
  updatePlayersList(data.players);
  clearCanvas();
  setDrawingEnabled(false);
  showOverlay('lobbyOverlay');
  document.getElementById('wordHint').textContent = '';
  document.getElementById('timer').textContent = '--';
  document.getElementById('chatMessages').innerHTML = '';

  if (window._isHost) {
    document.getElementById('startGameBtn').style.display = 'inline-flex';
  }

  addChatMessage({
    playerName: 'System',
    message: 'Game reset! Host can start a new game.',
    type: 'system',
  });
});

socket.on('error-message', (data) => {
  addChatMessage({
    playerName: 'System',
    message: `⚠️ ${data.message}`,
    type: 'system',
  });
});