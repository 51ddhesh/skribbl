// public/js/ui.js

// ── Parse URL Params ──
const urlParams = new URLSearchParams(window.location.search);
let roomId = urlParams.get('room'); // may be null initially for 'create' action
const playerName = urlParams.get('name');
const playerAvatar = parseInt(urlParams.get('avatar') || '1');

if (!playerName) {
  window.location.href = '/';
}

const avatarEmojis = ['😀','😎','🤠','🥳','😺','🐶','🦊','🐸','🐵','🤖','👻','🎃'];

// ── State ──
let gameSettings = { drawTime: 60, rounds: 3, hints: true };
let currentPlayers = [];
let totalRounds = 3;

// ── Init Display ──
document.getElementById('roomCode').textContent = roomId || '...';
document.getElementById('lobbyRoomCode').textContent = roomId || '...';

// Show lobby by default
showOverlay('lobbyOverlay');

// Host detection will be set by socket.js after create/join
// Settings listeners
document.getElementById('settingDrawTime').addEventListener('change', emitSettings);
document.getElementById('settingRounds').addEventListener('change', emitSettings);
document.getElementById('settingHints').addEventListener('change', emitSettings);

function emitSettings() {
  if (typeof socket === 'undefined' || !window._isHost) return;
  const settings = {
    drawTime: parseInt(document.getElementById('settingDrawTime').value),
    rounds: parseInt(document.getElementById('settingRounds').value),
    hints: document.getElementById('settingHints').value === 'true',
  };
  socket.emit('update-settings', settings);
}

// ── Player List Rendering ──
function updatePlayersList(players) {
  currentPlayers = players;

  // Game sidebar
  const list = document.getElementById('playersList');
  list.innerHTML = '';

  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach((p) => {
    const card = document.createElement('div');
    let classes = 'player-card';
    if (p.isDrawing) classes += ' drawing';
    if (p.hasGuessedCorrectly) classes += ' guessed';
    card.className = classes;

    let badge = '';
    if (p.isDrawing) badge = '<span class="player-badge badge-drawing">✏️ Drawing</span>';
    else if (p.hasGuessedCorrectly) badge = '<span class="player-badge badge-guessed">✓ Guessed</span>';

    card.innerHTML = `
      <div class="player-avatar">${avatarEmojis[(p.avatar || 1) - 1] || '😀'}</div>
      <div class="player-info">
        <div class="player-name">${escapeHtml(p.name)}</div>
        <div class="player-score">${p.score} pts</div>
      </div>
      ${badge}
    `;
    list.appendChild(card);
  });

  // Lobby player list
  const lobbyList = document.getElementById('lobbyPlayersList');
  if (lobbyList) {
    lobbyList.innerHTML = '';
    players.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'score-row';
      div.innerHTML = `
        <span class="score-rank">${avatarEmojis[(p.avatar || 1) - 1] || '😀'}</span>
        <span class="score-name">${escapeHtml(p.name)}${i === 0 ? ' <span class="player-badge badge-host">HOST</span>' : ''}</span>
      `;
      lobbyList.appendChild(div);
    });
  }
}

// ── Chat ──
function addChatMessage(msg) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');

  if (msg.type === 'system') {
    div.className = 'chat-msg system';
    div.textContent = msg.message;
  } else if (msg.type === 'correct-guess') {
    div.className = 'chat-msg correct-guess';
    div.textContent = msg.message;
  } else if (msg.type === 'close') {
    div.className = 'chat-msg close-guess';
    div.innerHTML = `<span class="msg-name">${escapeHtml(msg.playerName)}:</span> ${escapeHtml(msg.message)}`;
  } else {
    div.className = 'chat-msg';
    div.innerHTML = `<span class="msg-name">${escapeHtml(msg.playerName)}:</span> ${escapeHtml(msg.message)}`;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // Limit messages in DOM
  while (container.children.length > 200) {
    container.removeChild(container.firstChild);
  }
}

function sendGuess() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  socket.emit('send-guess', message);
  input.value = '';
  input.focus();
}

document.getElementById('chatInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendGuess();
});

// ── Scoreboard Rendering ──
function renderScoreboard(containerId, scores) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const rankIcons = ['🥇', '🥈', '🥉'];

  scores.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `
      <span class="score-rank">${i < 3 ? rankIcons[i] : i + 1 + '.'}</span>
      <span class="score-name">${escapeHtml(s.name)}</span>
      <span class="score-points">${s.score} pts</span>
      ${s.delta ? `<span class="score-delta">+${s.delta}</span>` : ''}
    `;
    container.appendChild(row);
  });
}

// ── Overlay Management ──
function showOverlay(id) {
  document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('active'));
  if (id) document.getElementById(id).classList.add('active');
}

function hideAllOverlays() {
  document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('active'));
}

// ── Game Controls ──
function startGame() {
  socket.emit('start-game');
}

function playAgain() {
  socket.emit('play-again');
}

// ── Helpers ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}