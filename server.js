const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");
const path    = require("path");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
   ROOM STORE
   rooms[roomCode] = {
     code, hostId,
     players: [ { id, name, score, isOnline } ],
     senderIdx: 0,          // index into players[] who is current sender
     state: "waiting" | "topic" | "selecting" | "guessing" | "result" | "roundEnd",
     topic: "",
     hintsUsed: 0,
     maxHints: 100,
     timeLimit: 30,         // seconds per selection (resets on each pick)
     mode: "chaos"|"sync",
     roundNum: 1,
     totalRounds: 0,        // 0 = unlimited (until all have been sender once = 1 rotation)
     scores: {},            // { socketId: totalScore }
     currentTimer: null,
     hintHistory: [],       // [ { emoji, name } ]
     guesses: [],           // [ { playerName, text, correct } ]
     rotationCount: 0,      // how many full rotations done
   }
   ============================================================ */
const rooms = {};

/* ── utilities ── */
function makeCode() {
  return Math.random().toString(36).substr(2,5).toUpperCase();
}

function getRoomOfSocket(socketId) {
  return Object.values(rooms).find(r => r.players.some(p => p.id === socketId));
}

function broadcastRoom(roomCode, event, data) {
  io.to(roomCode).emit(event, data);
}

function roomView(room) {
  // Safe snapshot sent to clients
  return {
    code:         room.code,
    players:      room.players,
    senderIdx:    room.senderIdx,
    state:        room.state,
    hintsUsed:    room.hintsUsed,
    maxHints:     room.maxHints,
    timeLimit:    room.timeLimit,
    mode:         room.mode,
    roundNum:     room.roundNum,
    hintHistory:  room.hintHistory,
    guesses:      room.guesses,
    scores:       room.scores,
    rotationCount:room.rotationCount,
  };
}

/* ── timer helpers ── */
function clearRoomTimer(room) {
  if (room.currentTimer) { clearInterval(room.currentTimer); room.currentTimer = null; }
  if (room.currentTimeout) { clearTimeout(room.currentTimeout); room.currentTimeout = null; }
}

function startSelectionTimer(room) {
  clearRoomTimer(room);
  room.timerLeft = room.timeLimit;

  broadcastRoom(room.code, "timerUpdate", { left: room.timerLeft, max: room.timeLimit });

  room.currentTimer = setInterval(() => {
    room.timerLeft--;
    broadcastRoom(room.code, "timerUpdate", { left: room.timerLeft, max: room.timeLimit });

    if (room.timerLeft <= 0) {
      clearRoomTimer(room);
      // Time ran out for this selection → treat as round over (no more hints)
      broadcastRoom(room.code, "selectionTimeout", {});
      endRound(room, false);
    }
  }, 1000);
}

/* ── game flow ── */
function startRound(room) {
  room.hintsUsed   = 0;
  room.hintHistory = [];
  room.guesses     = [];
  room.state       = "topic";
  clearRoomTimer(room);

  const sender = room.players[room.senderIdx];
  broadcastRoom(room.code, "roundStart", {
    room: roomView(room),
    senderId: sender.id,
    senderName: sender.name,
  });
}

function endRound(room, correctGuess, winnerName = null) {
  if (room.state === "roundEnd") return;
  room.state = "roundEnd";
  clearRoomTimer(room);

  broadcastRoom(room.code, "roundEnd", {
    room: roomView(room),
    correctGuess,
    winnerName,
    topic: room.topic,
  });

  // Auto-advance to next round after 5 seconds
  room.currentTimeout = setTimeout(() => nextRound(room), 5000);
}

function nextRound(room) {
  clearRoomTimer(room);

  // Rotate sender
  const prevIdx  = room.senderIdx;
  room.senderIdx = (room.senderIdx + 1) % room.players.length;
  if (room.senderIdx === 0) room.rotationCount++;

  room.roundNum++;
  room.topic = "";
  startRound(room);
}

/* ============================================================
   SOCKET EVENTS
   ============================================================ */
io.on("connection", (socket) => {
  console.log("connect:", socket.id);

  /* ── CREATE ROOM ── */
  socket.on("createRoom", ({ playerName, mode, timeLimit }) => {
    const code = makeCode();
    const room = {
      code,
      hostId: socket.id,
      players: [{ id: socket.id, name: playerName, isOnline: true }],
      senderIdx: 0,
      state: "waiting",
      topic: "",
      hintsUsed: 0,
      maxHints: 100,
      timeLimit: timeLimit || 30,
      mode: mode || "chaos",
      roundNum: 1,
      scores: { [socket.id]: 0 },
      currentTimer: null,
      currentTimeout: null,
      timerLeft: 0,
      hintHistory: [],
      guesses: [],
      rotationCount: 0,
    };
    rooms[code] = room;
    socket.join(code);
    socket.emit("roomCreated", { code, room: roomView(room) });
    console.log("room created:", code);
  });

  /* ── JOIN ROOM ── */
  socket.on("joinRoom", ({ roomCode, playerName }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room) {
      socket.emit("joinError", { message: "ルームが見つかりません 🔍" }); return;
    }
    if (room.state !== "waiting") {
      socket.emit("joinError", { message: "ゲームはすでに始まっています💦" }); return;
    }
    if (room.players.length >= 8) {
      socket.emit("joinError", { message: "満員です！(^^;) 最大8人まで" }); return;
    }
    if (room.players.some(p => p.name === playerName)) {
      socket.emit("joinError", { message: "同じ名前の人がいます😅 別の名前で！" }); return;
    }

    room.players.push({ id: socket.id, name: playerName, isOnline: true });
    room.scores[socket.id] = 0;
    socket.join(code);

    socket.emit("roomJoined", { code, room: roomView(room) });
    broadcastRoom(code, "playerJoined", { room: roomView(room), playerName });
    console.log(`${playerName} joined ${code}`);
  });

  /* ── START GAME (host only) ── */
  socket.on("startGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) {
      socket.emit("startError", { message: "2人以上必要だよ〜(^^;)" }); return;
    }
    startRound(room);
  });

  /* ── SENDER: SET TOPIC ── */
  socket.on("setTopic", ({ roomCode, topic, topicUrl }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "topic") return;
    if (room.players[room.senderIdx].id !== socket.id) return;

    room.topic = topic;
    room.topicUrl = topicUrl || "";
    room.state = "selecting";

    broadcastRoom(roomCode, "topicSet", { room: roomView(room) });

    // Start the first selection timer
    startSelectionTimer(room);
  });

  /* ── SENDER: SEND EMOJI HINT ── */
  socket.on("sendHint", ({ roomCode, emoji, emojiName }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "selecting") return;
    if (room.players[room.senderIdx].id !== socket.id) return;
    if (room.hintsUsed >= room.maxHints) return;

    room.hintsUsed++;
    room.hintHistory.push({ emoji, name: emojiName, idx: room.hintsUsed });

    broadcastRoom(roomCode, "hintSent", {
      emoji, emojiName,
      hintsUsed: room.hintsUsed,
      maxHints:  room.maxHints,
    });

    // Reset timer on each hint sent
    startSelectionTimer(room);

    // Check hint limit
    if (room.hintsUsed >= room.maxHints) {
      clearRoomTimer(room);
      endRound(room, false);
    }
  });

  /* ── GUESSER: SUBMIT GUESS ── */
  socket.on("submitGuess", ({ roomCode, guess }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== "selecting") return;

    // Sender cannot guess
    if (room.players[room.senderIdx].id === socket.id) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const correct = judgeAnswer(guess, room.topic);
    const guessObj = { playerName: player.name, text: guess, correct };
    room.guesses.push(guessObj);

    broadcastRoom(roomCode, "guessReceived", {
      guess: guessObj,
      room: roomView(room),
    });

    if (correct) {
      // Award points
      const guessScore  = Math.max(100, 1000 - room.hintsUsed * 8);
      const senderScore = Math.max(50,  500  - room.hintsUsed * 4);
      const senderId    = room.players[room.senderIdx].id;

      room.scores[socket.id] = (room.scores[socket.id] || 0) + guessScore;
      room.scores[senderId]  = (room.scores[senderId]  || 0) + senderScore;

      broadcastRoom(roomCode, "correctGuess", {
        winnerName:  player.name,
        guess:       guess,
        topic:       room.topic,
        guessScore,
        senderScore,
        scores:      room.scores,
      });

      endRound(room, true, player.name);
    }
  });

  /* ── CHAT (non-guess free chat) ── */
  socket.on("chatMessage", ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    broadcastRoom(roomCode, "chatMessage", { name: player.name, text });
  });

  /* ── DISCONNECT ── */
  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);
    const room = getRoomOfSocket(socket.id);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) player.isOnline = false;

    // If everyone offline, delete room after 60s
    if (room.players.every(p => !p.isOnline)) {
      setTimeout(() => {
        if (rooms[room.code] && room.players.every(p => !p.isOnline)) {
          clearRoomTimer(room);
          delete rooms[room.code];
          console.log("room deleted:", room.code);
        }
      }, 60000);
    }

    // If sender disconnected mid-game, skip their turn
    if (room.state === "selecting" || room.state === "topic") {
      const senderPlayer = room.players[room.senderIdx];
      if (senderPlayer && senderPlayer.id === socket.id) {
        broadcastRoom(room.code, "senderLeft", { name: player.name });
        clearRoomTimer(room);
        setTimeout(() => nextRound(room), 3000);
      }
    }

    broadcastRoom(room.code, "playerLeft", {
      room: roomView(room),
      playerName: player ? player.name : "?",
    });
  });
});

/* ── answer judge ── */
function judgeAnswer(guess, topic) {
  const g = normalize(guess);
  const t = normalize(topic);
  return g === t || t.includes(g) || g.includes(t);
}
function normalize(s) {
  return s.replace(/[　 ]/g,"").toLowerCase()
    .replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
