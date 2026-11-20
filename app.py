import time
import random
from flask import Flask, request

app = Flask(__name__)

# In-memory storage
leaderboard = {}  # { username: { "wins": int, "last_seen": timestamp } }
rooms = {}        # { room_id: { "type": str, "pin": str, "host": str, "black": str, "spectators": list, "moves": list, "status": str, "last_active": timestamp } }

def touch_player(name):
    if not name:
        return
    now = time.time()
    if name not in leaderboard:
        leaderboard[name] = {"wins": 0, "last_seen": now}
    else:
        leaderboard[name]["last_seen"] = now

# 1. Heartbeat
@app.route('/heartbeat')
def heartbeat():
    name = request.args.get('name')
    touch_player(name)
    return "OK"

# 2. Leaderboard: Name|Wins|ON;Name|Wins|OFF
@app.route('/leaderboard')
def get_leaderboard():
    now = time.time()
    if not leaderboard:
        return "EMPTY"

    sorted_players = sorted(leaderboard.items(), key=lambda x: x[1]["wins"], reverse=True)[:10]
    entries = []
    for name, data in sorted_players:
        status = "ON" if (now - data["last_seen"] < 60) else "OFF"
        entries.append(f"{name}|{data['wins']}|{status}")

    return "LEADERBOARD:" + ";".join(entries)

# 3. Browse Public Rooms: id|host|count/2;...
@app.route('/rooms')
def get_rooms():
    active = []
    for room_id, r in rooms.items():
        if r["type"] == 'public' and r["status"] != 'FINISHED':
            count = 2 if r["black"] else 1
            active.append(f"{room_id}|{r['host']}|{count}/2")
    if not active:
        return "EMPTY"
    return "ROOMS:" + ";".join(active)

# 4. Create Room
@app.route('/create')
def create_room():
    name = request.args.get('name')
    room_type = request.args.get('type', 'public')
    pin = request.args.get('pin', '')
    touch_player(name)

    room_id = str(random.randint(1000, 9999))
    rooms[room_id] = {
        "type": "private" if room_type == 'private' else "public",
        "pin": pin,
        "host": name,      # White
        "black": None,     # Black
        "spectators": [],
        "moves": [],
        "status": "WAITING",
        "last_active": time.time()
    }
    return f"CREATED:{room_id}"

# 5. Join Room (Player 2 or Spectator)
@app.route('/join')
def join_room():
    room_id = request.args.get('room')
    name = request.args.get('name')
    pin = request.args.get('pin', '')
    touch_player(name)

    r = rooms.get(room_id)
    if not r:
        return "ERROR:NOT_FOUND"

    if r["type"] == "private" and r["pin"] and r["pin"] != pin:
        return "ERROR:INVALID_PIN"

    if not r["black"] and r["host"] != name:
        r["black"] = name
        r["status"] = "PLAYING"
        r["last_active"] = time.time()
        return "ROLE:BLACK"
    else:
        if name not in r["spectators"]:
            r["spectators"].append(name)
        r["last_active"] = time.time()
        return f"ROLE:SPECTATOR:{r['host']}:{r['black'] or 'Waiting'}"

# 6. Check Room Status
@app.route('/status')
def room_status():
    room_id = request.args.get('room')
    name = request.args.get('name')
    touch_player(name)

    r = rooms.get(room_id)
    if not r:
        return "ERROR:NOT_FOUND"
    if r["status"] == "PLAYING":
        return f"READY:{r['black']}"
    return "WAIT"

# 7. Send a Move
@app.route('/move')
def send_move():
    room_id = request.args.get('room')
    data = request.args.get('data')
    name = request.args.get('name')
    touch_player(name)

    r = rooms.get(room_id)
    if not r:
        return "ERROR:NOT_FOUND"

    r["moves"].append(data)
    r["last_active"] = time.time()
    return "OK"

# 8. Poll Moves
@app.route('/poll')
def poll_moves():
    room_id = request.args.get('room')
    index = int(request.args.get('index', 0))
    name = request.args.get('name')
    touch_player(name)

    r = rooms.get(room_id)
    if not r:
        return "ERROR:NOT_FOUND"

    if r["status"] == "RESIGNED":
        return f"EVENT:RESIGNED:{r.get('winner', 'Opponent')}"

    if len(r["moves"]) > index:
        next_move = r["moves"][index]
        return f"MOVE:{index}:{next_move}"
    return "WAIT"

# 9. Resign Match
@app.route('/resign')
def resign_match():
    room_id = request.args.get('room')
    name = request.args.get('name')
    color = request.args.get('color')
    touch_player(name)

    r = rooms.get(room_id)
    if not r:
        return "ERROR:NOT_FOUND"

    r["status"] = "RESIGNED"
    winner = r["black"] if color == "white" else r["host"]
    r["winner"] = winner

    if winner and winner in leaderboard:
        leaderboard[winner]["wins"] += 1

    return "OK"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
