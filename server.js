const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const MAP = require('./shared/map');

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS || 3);
const MAX_PLAYERS = 12;
const TICK_MS = 50; // 20 Hz

const KILL_RANGE = 110;
const USE_RANGE = 110;
const REPORT_RANGE = 130;
const VENT_RANGE = 80;
const SABOTAGE_COOLDOWN = 30000;
const REACTOR_TIME = 45000;
const RESULTS_TIME = 4000;
const EJECTION_TIME = 6000;

const COLORS = [
  { id: 'red', name: 'Rojo', hex: '#c51111' },
  { id: 'blue', name: 'Azul', hex: '#132ed1' },
  { id: 'green', name: 'Verde', hex: '#117f2d' },
  { id: 'pink', name: 'Rosa', hex: '#ed54ba' },
  { id: 'orange', name: 'Naranja', hex: '#ef7d0d' },
  { id: 'yellow', name: 'Amarillo', hex: '#f5f557' },
  { id: 'black', name: 'Negro', hex: '#3f474e' },
  { id: 'white', name: 'Blanco', hex: '#d6e0f0' },
  { id: 'purple', name: 'Morado', hex: '#6b2fbb' },
  { id: 'brown', name: 'Marrón', hex: '#71491e' },
  { id: 'cyan', name: 'Cian', hex: '#38fedc' },
  { id: 'lime', name: 'Lima', hex: '#50ef39' },
];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.get('/colors.json', (_req, res) => res.json(COLORS));

/** @type {Map<string, any>} */
const rooms = new Map();

// ---------- utilidades ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};
const cleanName = (s) =>
  String(s || '').replace(/[<>]/g, '').trim().slice(0, 14) || 'Tripulante';

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function defaultSettings() {
  return { impostors: 1, killCooldown: 25, discussionTime: 15, votingTime: 60, tasksPerPlayer: 5, hostRole: 'random' };
}
const HOST_ROLES = ['random', 'crew', 'impostor'];

function createRoom() {
  const room = {
    code: makeCode(),
    hostId: null,
    phase: 'lobby', // lobby | playing | meeting | ejection | ended
    players: new Map(),
    settings: defaultSettings(),
    bodies: [],
    sabotage: null,
    sabotageReadyAt: 0,
    emergencyReadyAt: 0,
    meeting: null,
    ejection: null,
    result: null,
    nextBodyId: 1,
  };
  rooms.set(room.code, room);
  return room;
}

function newPlayer(socket, name, room) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  const free = COLORS.find((c) => !used.has(c.id));
  return {
    id: socket.id,
    name: cleanName(name),
    color: free ? free.id : COLORS[0].id,
    x: MAP.EMERGENCY.x,
    y: MAP.EMERGENCY.y + 150,
    alive: true,
    role: 'crew',
    tasks: [],
    emergencyUsed: false,
    killReadyAt: 0,
    inVent: null,
    posSeq: 0,
    moveBudget: 0,
    lastMove: Date.now(),
    lastChat: 0,
  };
}

function newBot(room) {
  const n = [...room.players.values()].filter((p) => p.isBot).length + 1;
  const bot = newPlayer({ id: `bot_${room.code}_${Date.now()}_${n}` }, `Bot ${n}`, room);
  bot.isBot = true;
  bot.ai = newAi();
  return bot;
}
const newAi = () => ({ goal: null, path: [], workUntil: 0, stuckFor: 0, voteAt: 0 });
const humans = (room) => [...room.players.values()].filter((p) => !p.isBot);

function forcePos(p, x, y) {
  p.x = x;
  p.y = y;
  p.posSeq++;
  p.moveBudget = 0;
}

function taskProgress(room) {
  let total = 0;
  let done = 0;
  for (const p of room.players.values()) {
    if (p.role !== 'crew') continue;
    total += p.tasks.length;
    done += p.tasks.filter((t) => t.done).length;
  }
  return { total, done };
}

// ---------- flujo de partida ----------
function startGame(room) {
  const players = [...room.players.values()];
  const s = room.settings;
  const impostorCount = Math.max(1, Math.min(s.impostors, Math.floor((players.length - 1) / 2)));
  // Modo admin: el anfitrión puede fijar su propio rol
  const host = room.players.get(room.hostId);
  let pool = shuffle(players);
  const impostorIds = new Set();
  if (host && s.hostRole === 'impostor') impostorIds.add(host.id);
  if (host && s.hostRole !== 'random') pool = pool.filter((p) => p.id !== host.id);
  for (const p of pool) if (impostorIds.size < impostorCount) impostorIds.add(p.id);
  const now = Date.now();

  players.forEach((p, i) => {
    p.role = impostorIds.has(p.id) ? 'impostor' : 'crew';
    p.alive = true;
    p.inVent = null;
    p.emergencyUsed = false;
    p.killReadyAt = now + 10000;
    p.tasks = shuffle(MAP.TASKS)
      .slice(0, s.tasksPerPlayer)
      .map((t) => ({ id: t.id, done: false }));
    const sp = MAP.spawnPoint(i, players.length);
    forcePos(p, sp.x, sp.y);
    if (p.isBot) p.ai = newAi();
  });

  room.phase = 'playing';
  room.bodies = [];
  room.sabotage = null;
  room.sabotageReadyAt = now + 15000;
  room.emergencyReadyAt = now + 15000;
  room.meeting = null;
  room.ejection = null;
  room.result = null;
}

function endGame(room, winner, reason) {
  room.phase = 'ended';
  room.sabotage = null;
  room.meeting = null;
  room.ejection = null;
  room.result = {
    winner,
    reason,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, color: p.color, role: p.role, alive: p.alive,
    })),
  };
}

function backToLobby(room) {
  room.phase = 'lobby';
  room.bodies = [];
  room.sabotage = null;
  room.meeting = null;
  room.ejection = null;
  room.result = null;
  for (const p of room.players.values()) {
    p.alive = true;
    p.role = 'crew';
    p.tasks = [];
    p.inVent = null;
  }
}

function checkWin(room) {
  if (!['playing', 'meeting', 'ejection'].includes(room.phase)) return false;
  const alive = [...room.players.values()].filter((p) => p.alive);
  const imps = alive.filter((p) => p.role === 'impostor').length;
  const crew = alive.length - imps;
  if (imps === 0) {
    endGame(room, 'crew', 'Todos los impostores han sido eliminados');
    return true;
  }
  if (imps >= crew) {
    endGame(room, 'impostor', 'Los impostores superan en número a la tripulación');
    return true;
  }
  const { total, done } = taskProgress(room);
  if (total > 0 && done >= total) {
    endGame(room, 'crew', 'La tripulación completó todas las tareas');
    return true;
  }
  return false;
}

function startMeeting(room, caller, body) {
  const now = Date.now();
  room.phase = 'meeting';
  room.sabotage = null;
  room.meeting = {
    type: body ? 'report' : 'emergency',
    callerId: caller.id,
    reportedColor: body ? body.color : null,
    stage: 'discussion',
    endsAt: now + room.settings.discussionTime * 1000,
    votes: {}, // voterId -> targetId | 'skip'
  };
  room.bodies = [];
  const players = [...room.players.values()];
  players.forEach((p, i) => {
    p.inVent = null;
    const sp = MAP.spawnPoint(i, players.length);
    forcePos(p, sp.x, sp.y);
    if (p.isBot) p.ai = newAi();
  });
  io.to(room.code).emit('meetingCalled', {
    type: room.meeting.type,
    callerName: caller.name,
    callerColor: caller.color,
    reportedColor: room.meeting.reportedColor,
  });
}

function resolveVotes(room) {
  const m = room.meeting;
  const tally = {};
  for (const target of Object.values(m.votes)) tally[target] = (tally[target] || 0) + 1;
  let best = null;
  let bestCount = 0;
  let tie = false;
  for (const [target, count] of Object.entries(tally)) {
    if (count > bestCount) {
      best = target;
      bestCount = count;
      tie = false;
    } else if (count === bestCount) {
      tie = true;
    }
  }
  m.stage = 'results';
  m.endsAt = Date.now() + RESULTS_TIME;
  m.ejectedId = !best || tie || best === 'skip' ? null : best;
  m.ejectReason = !best ? 'Nadie votó.' : tie ? 'Empate.' : best === 'skip' ? 'Se omitió la votación.' : null;
}

function startEjection(room) {
  const m = room.meeting;
  const ejected = m.ejectedId ? room.players.get(m.ejectedId) : null;
  let text;
  if (ejected) {
    ejected.alive = false;
    const impsLeft = [...room.players.values()].filter((p) => p.alive && p.role === 'impostor').length;
    text = `${ejected.name} ${ejected.role === 'impostor' ? 'era' : 'no era'} el Impostor.`;
    room.ejection = {
      name: ejected.name,
      color: ejected.color,
      text,
      sub: `${impsLeft} impostor${impsLeft === 1 ? '' : 'es'} restante${impsLeft === 1 ? '' : 's'}.`,
      endsAt: Date.now() + EJECTION_TIME,
    };
  } else {
    room.ejection = {
      name: null,
      color: null,
      text: `Nadie fue expulsado. (${m.ejectReason || 'Empate.'})`,
      sub: '',
      endsAt: Date.now() + EJECTION_TIME,
    };
  }
  room.phase = 'ejection';
  room.meeting = null;
}

function resumePlaying(room) {
  const now = Date.now();
  room.phase = 'playing';
  room.ejection = null;
  room.emergencyReadyAt = now + 15000;
  room.sabotageReadyAt = Math.max(room.sabotageReadyAt, now + 15000);
  for (const p of room.players.values()) p.killReadyAt = now + room.settings.killCooldown * 1000;
}

function killPlayer(room, killer, victim) {
  const now = Date.now();
  victim.alive = false;
  room.bodies.push({ id: room.nextBodyId++, color: victim.color, x: Math.round(victim.x), y: Math.round(victim.y) });
  forcePos(killer, victim.x, victim.y);
  killer.killReadyAt = now + room.settings.killCooldown * 1000;
  io.to(victim.id).emit('killed', { killerColor: killer.color });
  io.to(killer.id).emit('didKill');
  checkWin(room);
}

function sabotageFixed(room) {
  room.sabotage = null;
  room.sabotageReadyAt = Date.now() + SABOTAGE_COOLDOWN;
  io.to(room.code).emit('sabotageFixed');
}

function checkReactor(room) {
  const s = room.sabotage;
  if (s && s.type === 'reactor' && s.holds.A && s.holds.B && s.holds.A !== s.holds.B) sabotageFixed(room);
}

// ---------- bots ----------
// Grafo de navegación: cada rectángulo transitable es un nodo; dos nodos se
// conectan si se solapan, pasando por el centro del solape.
const NAV = (() => {
  const R = MAP.WALKABLE;
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const edges = R.map(() => []);
  for (let i = 0; i < R.length; i++)
    for (let j = i + 1; j < R.length; j++) {
      const a = R[i], b = R[j];
      const x1 = Math.max(a.x, b.x), x2 = Math.min(a.x + a.w, b.x + b.w);
      const y1 = Math.max(a.y, b.y), y2 = Math.min(a.y + a.h, b.y + b.h);
      if (x2 > x1 && y2 > y1) {
        const via = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
        edges[i].push({ to: j, via });
        edges[j].push({ to: i, via });
      }
    }
  const rectAt = (p) => R.findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  function path(from, to) {
    const a = rectAt(from), b = rectAt(to);
    if (a < 0 || b < 0 || a === b) return [to];
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length) {
      const c = q.shift();
      if (c === b) break;
      for (const e of edges[c]) if (!prev.has(e.to)) { prev.set(e.to, { from: c, via: e.via }); q.push(e.to); }
    }
    if (!prev.has(b)) return [to];
    const chain = [];
    for (let c = b; c !== null; c = prev.get(c) ? prev.get(c).from : null) chain.unshift(c);
    const pts = [];
    for (let i = 1; i < chain.length; i++) {
      pts.push(prev.get(chain[i]).via);
      if (i < chain.length - 1) pts.push(center(R[chain[i]]));
    }
    pts.push(to);
    return pts;
  }
  return { path };
})();

function botGoal(room, b) {
  const s = room.sabotage;
  if (b.alive && b.role === 'crew' && s) {
    if (s.type === 'lights') return { kind: 'lights', at: MAP.LIGHTS_PANEL };
    const bots = [...room.players.values()].filter((p) => p.isBot && p.alive && p.role === 'crew');
    const panel = bots.indexOf(b) % 2 === 0 ? 'A' : 'B';
    return { kind: 'reactor', panel, at: MAP.REACTOR_PANELS[panel] };
  }
  if (b.role === 'crew') {
    const t = b.tasks.find((t) => !t.done);
    if (t) return { kind: 'task', id: t.id, at: MAP.TASKS.find((s) => s.id === t.id) };
  }
  const st = MAP.TASKS[Math.floor(Math.random() * MAP.TASKS.length)];
  return { kind: 'wander', at: st };
}

function botThink(room, b, dt, now) {
  const ai = b.ai;
  const others = [...room.players.values()].filter((p) => p !== b);

  if (b.alive && b.role === 'impostor') {
    // mata si hay una víctima a tiro y nadie más mirando
    if (now >= b.killReadyAt) {
      const victim = others.find((p) => p.alive && p.role === 'crew' && dist(p, b) <= KILL_RANGE);
      if (victim) {
        const witnesses = others.filter((p) => p.alive && p !== victim && p.role === 'crew' && dist(p, victim) < 380);
        if (!witnesses.length && Math.random() < dt * 2) { killPlayer(room, b, victim); ai.goal = null; ai.workUntil = 0; return; }
      }
    }
    if (!room.sabotage && now >= room.sabotageReadyAt && Math.random() < dt / 45) {
      const sw = Array.from({ length: 5 }, () => Math.random() < 0.5);
      sw[Math.floor(Math.random() * 5)] = false;
      room.sabotage = { type: 'lights', switches: sw };
      io.to(room.code).emit('sabotageStarted', 'lights');
    }
  }

  if (b.alive && b.role === 'crew') {
    const body = room.bodies.find((x) => dist(x, b) < REPORT_RANGE - 10);
    if (body && Math.random() < dt * 1.5) return startMeeting(room, b, body);
  }

  // si surge un sabotaje, cambia de objetivo
  if (b.alive && b.role === 'crew' && room.sabotage && ai.goal && ai.goal.kind !== 'lights' && ai.goal.kind !== 'reactor') {
    ai.goal = null;
    ai.workUntil = 0;
  }

  if (ai.goal && ai.goal.kind === 'reactor') {
    const s = room.sabotage;
    if (!s || s.type !== 'reactor') { ai.goal = null; }
    else if (dist(b, ai.goal.at) < 60) {
      if (!s.holds[ai.goal.panel]) s.holds[ai.goal.panel] = b.id;
      checkReactor(room);
      return;
    }
  }

  if (ai.workUntil) {
    if (now < ai.workUntil) return;
    ai.workUntil = 0;
    const g = ai.goal;
    ai.goal = null;
    if (g && g.kind === 'task') {
      const t = b.tasks.find((t) => t.id === g.id);
      if (t) t.done = true;
      checkWin(room);
    } else if (g && g.kind === 'lights' && room.sabotage && room.sabotage.type === 'lights') {
      sabotageFixed(room);
    }
    return;
  }

  if (!ai.goal) {
    ai.goal = botGoal(room, b);
    ai.path = b.alive ? NAV.path(b, ai.goal.at) : [ai.goal.at];
    ai.stuckFor = 0;
  }

  const target = ai.path[0];
  if (!target) { ai.goal = null; return; }
  const dx = target.x - b.x, dy = target.y - b.y;
  const d = Math.hypot(dx, dy);
  if (d < 8) {
    ai.path.shift();
    if (!ai.path.length) {
      const g = ai.goal;
      if (g.kind === 'task') ai.workUntil = now + 2500 + Math.random() * 3500;
      else if (g.kind === 'lights') ai.workUntil = now + 2000;
      else if (g.kind === 'wander') ai.workUntil = now + 1000 + Math.random() * 4000;
    }
    return;
  }
  const step = Math.min(d, MAP.SPEED * 0.8 * dt);
  const before = { x: b.x, y: b.y };
  const n = b.alive
    ? MAP.moveWithCollision(b.x, b.y, (dx / d) * step, (dy / d) * step)
    : { x: b.x + (dx / d) * step, y: b.y + (dy / d) * step };
  b.x = n.x;
  b.y = n.y;
  if (Math.hypot(b.x - before.x, b.y - before.y) < 0.5) {
    ai.stuckFor += dt;
    if (ai.stuckFor > 1) ai.goal = null;
  } else ai.stuckFor = 0;
}

function botVotes(room, now) {
  const m = room.meeting;
  if (m.stage !== 'voting') return;
  const alive = [...room.players.values()].filter((p) => p.alive);
  for (const b of alive) {
    if (!b.isBot || m.votes[b.id]) continue;
    if (!b.ai.voteAt) b.ai.voteAt = now + 2000 + Math.random() * Math.min(15000, room.settings.votingTime * 500);
    if (now < b.ai.voteAt) continue;
    const candidates = alive.filter((p) => p !== b && !(b.role === 'impostor' && p.role === 'impostor'));
    m.votes[b.id] = Math.random() < 0.5 || !candidates.length ? 'skip' : candidates[Math.floor(Math.random() * candidates.length)].id;
  }
}

function tickRoom(room) {
  const now = Date.now();

  if (room.phase === 'playing') {
    for (const p of room.players.values()) {
      if (p.isBot && room.phase === 'playing') botThink(room, p, TICK_MS / 1000, now);
    }
  }
  if (room.phase === 'meeting') botVotes(room, now);

  if (room.phase === 'playing' && room.sabotage && room.sabotage.type === 'reactor') {
    const s = room.sabotage;
    // liberar paneles si el jugador se fue / murió / se desconectó
    for (const k of ['A', 'B']) {
      const holder = s.holds[k] && room.players.get(s.holds[k]);
      if (!holder || !holder.alive || dist(holder, MAP.REACTOR_PANELS[k]) > USE_RANGE + 40) s.holds[k] = null;
    }
    if (now >= s.endsAt) endGame(room, 'impostor', '¡El reactor se ha fundido!');
  }

  if (room.phase === 'meeting') {
    const m = room.meeting;
    const aliveCount = [...room.players.values()].filter((p) => p.alive).length;
    if (m.stage === 'discussion' && now >= m.endsAt) {
      m.stage = 'voting';
      m.endsAt = now + room.settings.votingTime * 1000;
    } else if (m.stage === 'voting' && (now >= m.endsAt || Object.keys(m.votes).length >= aliveCount)) {
      resolveVotes(room);
    } else if (m.stage === 'results' && now >= m.endsAt) {
      startEjection(room);
    }
  } else if (room.phase === 'ejection' && now >= room.ejection.endsAt) {
    if (!checkWin(room)) resumePlaying(room);
  }

  for (const p of room.players.values()) {
    const sock = io.sockets.sockets.get(p.id);
    if (sock) sock.emit('state', snapshotFor(room, p, now));
  }
}

function snapshotFor(room, viewer, now) {
  const inGame = room.phase !== 'lobby';
  const viewerDead = inGame && !viewer.alive;
  const players = [];
  for (const p of room.players.values()) {
    const self = p.id === viewer.id;
    if (room.phase === 'playing' && !self) {
      if (!p.alive && !viewerDead) continue; // los fantasmas solo los ven los muertos
      if (p.inVent) continue;
    }
    const showAlive = self || viewerDead || room.phase !== 'playing';
    const revealRole =
      room.phase === 'ended' || (viewer.role === 'impostor' && p.role === 'impostor' && inGame);
    players.push({
      id: p.id,
      name: p.name,
      color: p.color,
      x: Math.round(p.x),
      y: Math.round(p.y),
      alive: showAlive ? p.alive : true,
      impostor: revealRole ? p.role === 'impostor' : false,
    });
  }

  const snap = {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    minPlayers: MIN_PLAYERS,
    players,
    you: {
      id: viewer.id,
      role: inGame ? viewer.role : null,
      alive: viewer.alive,
      x: viewer.x,
      y: viewer.y,
      posSeq: viewer.posSeq,
      inVent: viewer.inVent,
      tasks: viewer.tasks,
      killCooldown: Math.max(0, Math.ceil((viewer.killReadyAt - now) / 1000)),
      emergencyUsed: viewer.emergencyUsed,
    },
  };

  if (room.phase === 'playing') {
    snap.bodies = room.bodies;
    const tp = taskProgress(room);
    snap.taskProgress = tp.total ? tp.done / tp.total : 0;
    snap.emergencyCooldown = Math.max(0, Math.ceil((room.emergencyReadyAt - now) / 1000));
    snap.sabotageCooldown = Math.max(0, Math.ceil((room.sabotageReadyAt - now) / 1000));
    if (room.sabotage) {
      const s = room.sabotage;
      snap.sabotage =
        s.type === 'lights'
          ? { type: 'lights', switches: s.switches }
          : {
              type: 'reactor',
              timeLeft: Math.max(0, Math.ceil((s.endsAt - now) / 1000)),
              holds: { A: !!s.holds.A, B: !!s.holds.B },
            };
    }
  }

  if (room.phase === 'meeting') {
    const m = room.meeting;
    const caller = room.players.get(m.callerId);
    snap.meeting = {
      type: m.type,
      stage: m.stage,
      timeLeft: Math.max(0, Math.ceil((m.endsAt - now) / 1000)),
      callerId: m.callerId,
      callerName: caller ? caller.name : '?',
      reportedColor: m.reportedColor,
      voted: Object.keys(m.votes),
      myVote: m.votes[viewer.id] || null,
    };
    if (m.stage === 'results') snap.meeting.votes = m.votes;
  }

  if (room.phase === 'ejection') snap.ejection = room.ejection;
  if (room.phase === 'ended') snap.result = room.result;
  return snap;
}

setInterval(() => {
  for (const room of rooms.values()) tickRoom(room);
}, TICK_MS);

// ---------- sockets ----------
io.on('connection', (socket) => {
  let room = null;
  const me = () => room && room.players.get(socket.id);

  function join(r, name) {
    room = r;
    const p = newPlayer(socket, name, r);
    r.players.set(socket.id, p);
    if (!r.hostId) r.hostId = socket.id;
    socket.join(r.code);
    systemChat(r, `${p.name} se ha unido.`);
  }

  socket.on('createRoom', ({ name } = {}, cb) => {
    if (room) return cb && cb({ ok: false, error: 'Ya estás en una sala.' });
    const r = createRoom();
    join(r, name);
    cb && cb({ ok: true, code: r.code });
  });

  socket.on('joinRoom', ({ name, code } = {}, cb) => {
    if (room) return cb && cb({ ok: false, error: 'Ya estás en una sala.' });
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return cb && cb({ ok: false, error: 'Esa sala no existe.' });
    if (r.phase !== 'lobby') return cb && cb({ ok: false, error: 'La partida ya ha empezado.' });
    if (r.players.size >= MAX_PLAYERS) return cb && cb({ ok: false, error: 'La sala está llena.' });
    join(r, name);
    cb && cb({ ok: true, code: r.code });
  });

  socket.on('setColor', (colorId) => {
    const p = me();
    if (!p || room.phase !== 'lobby') return;
    if (!COLORS.some((c) => c.id === colorId)) return;
    if ([...room.players.values()].some((o) => o.color === colorId && o.id !== p.id)) return;
    p.color = colorId;
  });

  socket.on('updateSettings', (s = {}) => {
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    const cur = room.settings;
    room.settings = {
      impostors: clampInt(s.impostors, 1, 3, cur.impostors),
      killCooldown: clampInt(s.killCooldown, 10, 60, cur.killCooldown),
      discussionTime: clampInt(s.discussionTime, 0, 120, cur.discussionTime),
      votingTime: clampInt(s.votingTime, 15, 300, cur.votingTime),
      tasksPerPlayer: clampInt(s.tasksPerPlayer, 1, MAP.TASKS.length, cur.tasksPerPlayer),
      hostRole: HOST_ROLES.includes(s.hostRole) ? s.hostRole : cur.hostRole,
    };
  });

  // Modo admin: bots para jugar solo o completar la sala
  socket.on('addBot', () => {
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    if (room.players.size >= MAX_PLAYERS) return;
    const bot = newBot(room);
    room.players.set(bot.id, bot);
  });

  socket.on('removeBot', () => {
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    const bots = [...room.players.values()].filter((p) => p.isBot);
    if (bots.length) room.players.delete(bots[bots.length - 1].id);
  });

  socket.on('startGame', (cb) => {
    if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
    if (room.players.size < MIN_PLAYERS)
      return cb && cb({ ok: false, error: `Se necesitan al menos ${MIN_PLAYERS} jugadores.` });
    startGame(room);
    cb && cb({ ok: true });
  });

  socket.on('backToLobby', () => {
    if (!room || room.hostId !== socket.id || room.phase !== 'ended') return;
    backToLobby(room);
  });

  socket.on('move', ({ x, y, seq } = {}) => {
    const p = me();
    if (!p || room.phase !== 'playing' || p.inVent) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || seq !== p.posSeq) return;
    const now = Date.now();
    const dt = Math.min((now - p.lastMove) / 1000, 1);
    p.lastMove = now;
    p.moveBudget = Math.min(p.moveBudget + MAP.SPEED * dt * 1.3, MAP.SPEED * 0.6);
    const d = Math.hypot(x - p.x, y - p.y);
    const valid = d <= p.moveBudget + 6 && (p.alive ? MAP.canStand(x, y) : true);
    if (!valid) {
      forcePos(p, p.x, p.y); // corrección
      return;
    }
    p.moveBudget -= d;
    const c = MAP.clampWorld(x, y);
    p.x = c.x;
    p.y = c.y;
  });

  socket.on('completeTask', (taskId) => {
    const p = me();
    if (!p || room.phase !== 'playing' || p.role !== 'crew') return;
    const t = p.tasks.find((t) => t.id === taskId);
    const station = MAP.TASKS.find((s) => s.id === taskId);
    if (!t || t.done || !station || dist(p, station) > USE_RANGE + 40) return;
    t.done = true;
    checkWin(room);
  });

  socket.on('kill', (targetId) => {
    const p = me();
    if (!p || room.phase !== 'playing' || p.role !== 'impostor' || !p.alive || p.inVent) return;
    const now = Date.now();
    if (now < p.killReadyAt) return;
    const t = room.players.get(targetId);
    if (!t || !t.alive || t.role === 'impostor' || t.inVent || dist(p, t) > KILL_RANGE) return;
    killPlayer(room, p, t);
  });

  socket.on('report', (bodyId) => {
    const p = me();
    if (!p || room.phase !== 'playing' || !p.alive || p.inVent) return;
    const body = room.bodies.find((b) => b.id === bodyId);
    if (!body || dist(p, body) > REPORT_RANGE) return;
    startMeeting(room, p, body);
  });

  socket.on('emergency', () => {
    const p = me();
    if (!p || room.phase !== 'playing' || !p.alive || p.inVent || p.emergencyUsed) return;
    if (room.sabotage || Date.now() < room.emergencyReadyAt) return;
    if (dist(p, MAP.EMERGENCY) > USE_RANGE + 30) return;
    p.emergencyUsed = true;
    startMeeting(room, p, null);
  });

  socket.on('vent', (action) => {
    const p = me();
    if (!p || room.phase !== 'playing' || p.role !== 'impostor' || !p.alive) return;
    if (action === 'enter' && !p.inVent) {
      const v = MAP.VENTS.find((v) => dist(p, v) <= VENT_RANGE);
      if (!v) return;
      p.inVent = v.id;
      forcePos(p, v.x, v.y);
    } else if (action === 'next' && p.inVent) {
      const cur = MAP.VENTS.find((v) => v.id === p.inVent);
      const group = MAP.VENTS.filter((v) => v.group === cur.group);
      const next = group[(group.indexOf(cur) + 1) % group.length];
      p.inVent = next.id;
      forcePos(p, next.x, next.y);
    } else if (action === 'exit' && p.inVent) {
      p.inVent = null;
      forcePos(p, p.x, p.y);
    }
  });

  socket.on('sabotage', (type) => {
    const p = me();
    if (!p || room.phase !== 'playing' || p.role !== 'impostor') return;
    const now = Date.now();
    if (room.sabotage || now < room.sabotageReadyAt) return;
    if (type === 'lights') {
      const switches = Array.from({ length: 5 }, () => Math.random() < 0.5);
      switches[Math.floor(Math.random() * 5)] = false;
      room.sabotage = { type: 'lights', switches };
    } else if (type === 'reactor') {
      room.sabotage = { type: 'reactor', endsAt: now + REACTOR_TIME, holds: { A: null, B: null } };
    } else return;
    io.to(room.code).emit('sabotageStarted', type);
  });

  socket.on('lightsToggle', (i) => {
    const p = me();
    if (!p || room.phase !== 'playing' || !p.alive) return;
    const s = room.sabotage;
    if (!s || s.type !== 'lights' || !Number.isInteger(i) || i < 0 || i >= 5) return;
    if (dist(p, MAP.LIGHTS_PANEL) > USE_RANGE + 40) return;
    s.switches[i] = !s.switches[i];
    if (s.switches.every(Boolean)) sabotageFixed(room);
  });

  socket.on('reactorHold', ({ panel, holding } = {}) => {
    const p = me();
    if (!p || room.phase !== 'playing' || !p.alive) return;
    const s = room.sabotage;
    if (!s || s.type !== 'reactor' || !MAP.REACTOR_PANELS[panel]) return;
    if (holding) {
      if (dist(p, MAP.REACTOR_PANELS[panel]) > USE_RANGE + 40) return;
      if (!s.holds[panel]) s.holds[panel] = p.id;
    } else if (s.holds[panel] === p.id) {
      s.holds[panel] = null;
    }
    checkReactor(room);
  });

  socket.on('vote', (target) => {
    const p = me();
    if (!p || room.phase !== 'meeting' || !p.alive) return;
    const m = room.meeting;
    if (m.stage !== 'voting' || m.votes[p.id]) return;
    if (target !== 'skip') {
      const t = room.players.get(target);
      if (!t || !t.alive) return;
    }
    m.votes[p.id] = target;
  });

  socket.on('chat', (text) => {
    const p = me();
    if (!p) return;
    const msg = String(text || '').trim().slice(0, 200);
    const now = Date.now();
    if (!msg || now - p.lastChat < 600) return;
    // durante la partida solo pueden hablar los muertos (entre ellos)
    if (room.phase === 'playing' && p.alive) return;
    p.lastChat = now;
    const dead = room.phase !== 'lobby' && room.phase !== 'ended' && !p.alive;
    const payload = { name: p.name, color: p.color, text: msg, dead };
    if (dead) {
      for (const o of room.players.values()) if (!o.alive) io.to(o.id).emit('chat', payload);
    } else {
      io.to(room.code).emit('chat', payload);
    }
  });

  socket.on('disconnect', () => {
    const p = me();
    if (!p) return;
    const r = room;
    r.players.delete(socket.id);
    if (humans(r).length === 0) {
      rooms.delete(r.code);
      return;
    }
    if (r.hostId === socket.id) r.hostId = humans(r)[0].id;
    systemChat(r, `${p.name} se ha ido.`);
    if (r.meeting) {
      delete r.meeting.votes[socket.id];
      for (const [voter, target] of Object.entries(r.meeting.votes))
        if (target === socket.id) delete r.meeting.votes[voter];
    }
    checkWin(r);
  });
});

function systemChat(room, text) {
  io.to(room.code).emit('chat', { system: true, text });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Among Us web escuchando en http://localhost:${PORT}`);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  En tu red local:        http://${i.address}:${PORT}`);
    }
  }
  console.log(`  Jugadores mínimos: ${MIN_PLAYERS} (cámbialo con MIN_PLAYERS=2)\n`);
});
