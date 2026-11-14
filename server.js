const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// In-Memory Database
const leaderboard = {}; // { username: { wins: Number, lastSeen: Timestamp } }
const rooms = {};       // { roomId: { type, pin, host, black, spectators: [], moves: [], status, lastActive } }

// Helper: updates player activity for online status
function touchPlayer(name) {
    if (!name) return;
    if (!leaderboard[name]) {
        leaderboard[name] = { wins: 0, lastSeen: Date.now() };
    } else {
        leaderboard[name].lastSeen = Date.now();
    }
}

// 1. Heartbeat / Register Nickname
app.get('/heartbeat', (req, res) => {
    const name = req.query.name;
    touchPlayer(name);
    res.send("OK");
});

// 2. Leaderboard: Name|Wins|ON;Name|Wins|OFF
app.get('/leaderboard', (req, res) => {
    const now = Date.now();
    const sorted = Object.keys(leaderboard)
        .map(name => ({
            name,
            wins: leaderboard[name].wins,
            online: (now - leaderboard[name].lastSeen < 60000) ? "ON" : "OFF"
        }))
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 10); // top 10

    if (sorted.length === 0) {
        return res.send("EMPTY");
    }

    const payload = sorted.map(p => `${p.name}|${p.wins}|${p.online}`).join(';');
    res.send(`LEADERBOARD:${payload}`);
});

// 3. Browse Public Rooms: id|host|count/2;...
app.get('/rooms', (req, res) => {
    const activePublic = [];
    for (const id in rooms) {
        const r = rooms[id];
        if (r.type === 'public' && r.status !== 'FINISHED') {
            const count = r.black ? 2 : 1;
            activePublic.push(`${id}|${r.host}|${count}/2`);
        }
    }
    if (activePublic.length === 0) return res.send("EMPTY");
    res.send(`ROOMS:${activePublic.join(';')}`);
});

// 4. Create Room (Public or Private)
app.get('/create', (req, res) => {
    const { name, type, pin } = req.query;
    touchPlayer(name);

    // 4-digit Room ID
    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    rooms[roomId] = {
        type: type === 'private' ? 'private' : 'public',
        pin: pin || '',
        host: name,      // White
        black: null,     // Black
        spectators: [],
        moves: [],
        status: 'WAITING',
        lastActive: Date.now()
    };

    console.log(`[Created] Room ${roomId} (${type}) by ${name}`);
    res.send(`CREATED:${roomId}`);
});

// 5. Join Room (Player 2 or Spectator)
app.get('/join', (req, res) => {
    const { room: roomId, name, pin } = req.query;
    touchPlayer(name);

    const r = rooms[roomId];
    if (!r) return res.send("ERROR:NOT_FOUND");

    // Private room PIN check
    if (r.type === 'private' && r.pin && r.pin !== pin) {
        return res.send("ERROR:INVALID_PIN");
    }

    // Assign Role
    if (!r.black && r.host !== name) {
        r.black = name;
        r.status = 'PLAYING';
        r.lastActive = Date.now();
        console.log(`[Joined] ${name} joined Room ${roomId} as BLACK`);
        return res.send("ROLE:BLACK");
    } else {
        // Room has 2 players -> Join as Spectator
        if (!r.spectators.includes(name)) {
            r.spectators.push(name);
        }
        r.lastActive = Date.now();
        console.log(`[Spectator] ${name} joined Room ${roomId}`);
        return res.send(`ROLE:SPECTATOR:${r.host}:${r.black || 'Waiting'}`);
    }
});

// 6. Check Room Status (White waits for Black to start match)
app.get('/status', (req, res) => {
    const { room: roomId, name } = req.query;
    touchPlayer(name);

    const r = rooms[roomId];
    if (!r) return res.send("ERROR:NOT_FOUND");

    if (r.status === 'PLAYING') {
        res.send(`READY:${r.black}`);
    } else {
        res.send("WAIT");
    }
});

// 7. Send a Move (fr,fc,tr,tc,promo)
app.get('/move', (req, res) => {
    const { room: roomId, data, name } = req.query;
    touchPlayer(name);

    const r = rooms[roomId];
    if (!r) return res.send("ERROR:NOT_FOUND");

    r.moves.push(data);
    r.lastActive = Date.now();
    res.send("OK");
});

// 8. Poll for Moves & Events
app.get('/poll', (req, res) => {
    const { room: roomId, index, name } = req.query;
    touchPlayer(name);

    const r = rooms[roomId];
    if (!r) return res.send("ERROR:NOT_FOUND");

    const clientIdx = parseInt(index || 0);

    // If opponent resigned
    if (r.status === 'RESIGNED') {
        return res.send(`EVENT:RESIGNED:${r.winner}`);
    }

    // Check if new move is available
    if (r.moves.length > clientIdx) {
        const nextMove = r.moves[clientIdx];
        res.send(`MOVE:${clientIdx}:${nextMove}`);
    } else {
        res.send("WAIT");
    }
});

// 9. Resign Match
app.get('/resign', (req, res) => {
    const { room: roomId, name, color } = req.query;
    touchPlayer(name);

    const r = rooms[roomId];
    if (!r) return res.send("ERROR:NOT_FOUND");

    r.status = 'RESIGNED';
    const winnerName = (color === 'white') ? r.black : r.host;
    r.winner = winnerName;

    // Credit win on leaderboard
    if (winnerName && leaderboard[winnerName]) {
        leaderboard[winnerName].wins += 1;
    }

    console.log(`[Resigned] ${name} surrendered Room ${roomId}. Winner: ${winnerName}`);
    res.send("OK");
});

// Clean up idle rooms older than 30 minutes
setInterval(() => {
    const now = Date.now();
    for (const id in rooms) {
        if (now - rooms[id].lastActive > 1800000) {
            delete rooms[id];
        }
    }
}, 60000);

app.listen(PORT, () => {
    console.log(`J2ME Chess Server listening on port ${PORT}`);
});
