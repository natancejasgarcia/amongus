(function () {
  const MAP = window.GAME_MAP;
  const $ = (id) => document.getElementById(id);
  const socket = io();

  const USE_RANGE = 95;
  const KILL_RANGE = 100;
  const REPORT_RANGE = 120;
  const VENT_RANGE = 70;
  const VISION = { crew: 330, lightsOut: 110, impostor: 450 };

  let COLORS = [];
  const hexCache = {};
  const hex = (id) => hexCache[id] || '#888';
  const colorName = (id) => (COLORS.find((c) => c.id === id) || {}).name || id;

  let state = null;
  const me = { x: 0, y: 0, seq: -1, flip: false, walk: 0, moving: false };
  const disp = new Map();
  const keys = new Set();
  const joy = { x: 0, y: 0 };
  let mapOpen = false;
  let sabMenuOpen = false;
  let lastSent = { x: 0, y: 0, t: 0 };
  let splashUntil = 0;

  R.starfield($('stars'));
  fetch('/colors.json').then((r) => r.json()).then((c) => {
    COLORS = c;
    c.forEach((x) => (hexCache[x.id] = x.hex));
    const hc = $('homeCrew').getContext('2d');
    R.drawCrewmate(hc, 74, 76, '#c51111', { s: 1.6 });
  });

  // ---------- sonidos ----------
  let actx = null;
  function beep(freqs, dur = 0.12, type = 'square', vol = 0.06) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach((f, i) => {
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type;
        o.frequency.value = f;
        g.gain.value = vol;
        o.connect(g).connect(actx.destination);
        const t = actx.currentTime + i * dur;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t);
        o.stop(t + dur);
      });
    } catch (_) {}
  }
  const sfx = {
    task: () => beep([660, 880, 1320], 0.08, 'sine', 0.08),
    kill: () => beep([220, 110, 60], 0.12, 'sawtooth', 0.1),
    meeting: () => beep([880, 660, 880, 660], 0.15, 'square', 0.07),
    alarm: () => beep([500, 300, 500, 300], 0.2, 'sawtooth', 0.05),
  };

  // ---------- pantallas ----------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    $('stars').style.display = id === 'game' ? 'none' : 'block';
  }

  // ---------- inicio ----------
  try { $('nameInput').value = localStorage.getItem('au_name') || ''; } catch (_) {}
  const urlCode = new URLSearchParams(location.search).get('sala');
  if (urlCode) $('codeInput').value = urlCode.toUpperCase();

  function getName() {
    const n = $('nameInput').value.trim();
    if (!n) { $('homeError').textContent = 'Escribe un nombre.'; return null; }
    try { localStorage.setItem('au_name', n); } catch (_) {}
    return n;
  }
  $('createBtn').onclick = () => {
    const name = getName();
    if (!name) return;
    socket.emit('createRoom', { name }, (res) => {
      if (!res.ok) $('homeError').textContent = res.error;
    });
  };
  const doJoin = () => {
    const name = getName();
    if (!name) return;
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) { $('homeError').textContent = 'El código tiene 4 letras.'; return; }
    socket.emit('joinRoom', { name, code }, (res) => {
      if (!res.ok) $('homeError').textContent = res.error;
    });
  };
  $('joinBtn').onclick = doJoin;
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

  socket.on('disconnect', () => {
    showScreen('home');
    $('homeError').textContent = 'Conexión perdida con el servidor.';
    state = null;
  });

  // ---------- lobby ----------
  const SETTINGS = [
    { key: 'impostors', label: 'Impostores', min: 1, max: 3, step: 1 },
    { key: 'killCooldown', label: 'Enfriamiento de matar', min: 10, max: 60, step: 5, unit: 's' },
    { key: 'discussionTime', label: 'Tiempo de discusión', min: 0, max: 120, step: 15, unit: 's' },
    { key: 'votingTime', label: 'Tiempo de votación', min: 15, max: 300, step: 15, unit: 's' },
    { key: 'tasksPerPlayer', label: 'Tareas por jugador', min: 1, max: MAP.TASKS.length, step: 1 },
  ];
  let lobbySig = '';
  const ROLES = ['random', 'crew', 'impostor'];
  const ROLE_LABEL = { random: 'Aleatorio', crew: 'Tripulante', impostor: 'Impostor' };

  function renderLobby(s) {
    const isHost = s.hostId === s.you.id;
    const sig = JSON.stringify([s.players.map((p) => [p.id, p.name, p.color]), s.hostId, s.settings, COLORS.length]);
    if (sig === lobbySig) return;
    lobbySig = sig;

    $('lobbyCode').textContent = s.code;
    $('playerCount').textContent = `(${s.players.length}/12)`;
    const list = $('playerList');
    list.innerHTML = '';
    for (const p of s.players) {
      const li = document.createElement('li');
      li.appendChild(R.crewIcon(hex(p.color), 32));
      li.insertAdjacentHTML('beforeend', `<span>${esc(p.name)}${p.id === s.you.id ? ' (tú)' : ''}</span>`);
      if (p.id === s.hostId) li.insertAdjacentHTML('beforeend', '<span class="crown">👑</span>');
      list.appendChild(li);
    }

    const mine = s.players.find((p) => p.id === s.you.id);
    const taken = new Set(s.players.filter((p) => p.id !== s.you.id).map((p) => p.color));
    $('colorGrid').innerHTML = COLORS.map((c) =>
      `<button title="${c.name}" data-color="${c.id}" style="background:${c.hex}" class="${mine && mine.color === c.id ? 'mine' : ''} ${taken.has(c.id) ? 'taken' : ''}"></button>`
    ).join('');

    $('settings').innerHTML = SETTINGS.map((o) => `
      <div class="setting"><span>${o.label}</span><div class="ctrl">
        ${isHost ? `<button data-set="${o.key}" data-d="-1">−</button>` : ''}
        <b>${s.settings[o.key]}${o.unit || ''}</b>
        ${isHost ? `<button data-set="${o.key}" data-d="1">+</button>` : ''}
      </div></div>`).join('') + `
      <div class="setting admin"><span>🛠 Tu rol (admin)</span><div class="ctrl">
        ${isHost ? '<button data-role="-1">−</button>' : ''}
        <b>${ROLE_LABEL[s.settings.hostRole] || 'Aleatorio'}</b>
        ${isHost ? '<button data-role="1">+</button>' : ''}
      </div></div>`;

    const bots = s.players.filter((p) => p.id.startsWith('bot_')).length;
    $('botRow').classList.toggle('hidden', !isHost);
    $('botCount').textContent = bots ? `${bots} bot${bots > 1 ? 's' : ''}` : 'Sin bots';

    $('startBtn').classList.toggle('hidden', !isHost);
    $('soloBtn').classList.toggle('hidden', !isHost);
    $('lobbyInfo').textContent = isHost
      ? `Mínimo ${s.minPlayers} jugadores para empezar.`
      : 'Esperando a que el anfitrión empiece la partida...';
  }

  $('colorGrid').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.classList.contains('taken')) socket.emit('setColor', b.dataset.color);
  });
  $('settings').addEventListener('click', (e) => {
    const r = e.target.closest('button[data-role]');
    if (r && state) {
      const i = (ROLES.indexOf(state.settings.hostRole) + Number(r.dataset.role) + ROLES.length) % ROLES.length;
      socket.emit('updateSettings', { ...state.settings, hostRole: ROLES[i] });
      return;
    }
    const b = e.target.closest('button[data-set]');
    if (!b || !state) return;
    const o = SETTINGS.find((x) => x.key === b.dataset.set);
    const v = Math.max(o.min, Math.min(o.max, state.settings[o.key] + o.step * Number(b.dataset.d)));
    socket.emit('updateSettings', { ...state.settings, [o.key]: v });
  });
  $('addBot').onclick = () => socket.emit('addBot');
  $('removeBot').onclick = () => socket.emit('removeBot');
  $('soloBtn').onclick = () => {
    // Partida rápida en solitario: rellena con bots hasta 6 y empieza
    const need = Math.max(0, 6 - state.players.length);
    for (let i = 0; i < need; i++) socket.emit('addBot');
    setTimeout(() => $('startBtn').click(), 250);
  };
  $('startBtn').onclick = () => {
    $('lobbyError').textContent = '';
    socket.emit('startGame', (res) => { if (res && !res.ok) $('lobbyError').textContent = res.error; });
  };
  $('copyLink').onclick = () => {
    const link = `${location.origin}${location.pathname}?sala=${state ? state.code : ''}`;
    navigator.clipboard && navigator.clipboard.writeText(link).then(() => {
      $('copyLink').textContent = '¡Copiado!';
      setTimeout(() => ($('copyLink').textContent = 'Copiar enlace'), 1500);
    });
  };

  // ---------- chat ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  document.querySelectorAll('form[data-chat]').forEach((f) => {
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = f.querySelector('input');
      if (input.value.trim()) socket.emit('chat', input.value);
      input.value = '';
    });
  });
  socket.on('chat', (m) => {
    for (const id of ['lobbyChatLog', 'meetingChatLog', 'ghostChatLog']) {
      const log = $(id);
      const div = document.createElement('div');
      div.className = 'chat-msg' + (m.system ? ' system' : '') + (m.dead ? ' dead' : '');
      div.innerHTML = m.system ? esc(m.text) : `<b style="color:${hex(m.color)}">${esc(m.name)}${m.dead ? ' 👻' : ''}</b>${esc(m.text)}`;
      log.appendChild(div);
      while (log.children.length > 100) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
    }
  });
  const clearChats = () => ['lobbyChatLog', 'meetingChatLog', 'ghostChatLog'].forEach((id) => ($(id).innerHTML = ''));

  // ---------- estado ----------
  socket.on('state', (s) => {
    const prev = state;
    state = s;
    if (!prev || prev.phase !== s.phase) onPhaseChange(prev ? prev.phase : null, s.phase, prev);
    if (s.you.posSeq !== me.seq) {
      me.seq = s.you.posSeq;
      me.x = s.you.x;
      me.y = s.you.y;
    }
    if (s.phase === 'lobby') renderLobby(s);
    if (s.phase === 'playing') {
      updateHud(s);
      Minigames.update(s.sabotage || null);
      if (!s.you.alive && Minigames.isOpen() && openKind && openKind !== 'task') Minigames.close();
    }
    if (s.phase === 'meeting') updateMeeting(s);
  });

  function onPhaseChange(from, to) {
    Minigames.close();
    closeMap();
    sabMenuOpen = false;
    $('sabotageMenu').classList.add('hidden');
    $('meeting').classList.toggle('hidden', to !== 'meeting');
    $('ejection').classList.toggle('hidden', to !== 'ejection');
    $('endScreen').classList.toggle('hidden', to !== 'ended');

    if (to === 'lobby') {
      lobbySig = '';
      showScreen('lobby');
      $('splash').classList.add('hidden');
      return;
    }
    showScreen('game');
    if (from === 'lobby' && to === 'playing') {
      clearChats();
      disp.clear();
      showRoleSplash();
    }
    if (to === 'meeting') buildMeeting();
    if (to === 'ejection') showEjection();
    if (to === 'ended') showEnd();
  }

  // ---------- splash ----------
  function splash(html, ms, bg) {
    const el = $('splash');
    el.innerHTML = html;
    el.style.background = bg || '#000';
    el.classList.remove('hidden');
    splashUntil = performance.now() + ms;
    clearTimeout(splash.t);
    splash.t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  function showRoleSplash() {
    const s = state;
    const imp = s.you.role === 'impostor';
    const team = imp ? s.players.filter((p) => p.impostor) : s.players;
    const nImp = Math.max(1, Math.min(s.settings.impostors, Math.floor((s.players.length - 1) / 2)));
    splash(
      `<p>${imp ? 'Eres el' : 'Eres un'}</p>
       <h1 style="color:${imp ? '#ff3b3b' : '#38fedc'}">${imp ? 'IMPOSTOR' : 'TRIPULANTE'}</h1>
       <p>${imp ? 'Mata a la tripulación sin que te descubran.' : `Hay ${nImp} impostor${nImp > 1 ? 'es' : ''} entre nosotros`}</p>
       <div class="team" id="splashTeam"></div>`,
      3500
    );
    const t = $('splashTeam');
    team.forEach((p) => t.appendChild(R.crewIcon(hex(p.color), 64)));
  }

  socket.on('meetingCalled', (m) => {
    sfx.meeting();
    const title = m.type === 'report' ? '¡CUERPO REPORTADO!' : '¡REUNIÓN DE EMERGENCIA!';
    splash(`<h1 style="color:#ff3b3b;font-size:clamp(36px,8vw,80px)">${title}</h1><div class="team" id="splashTeam"></div>
      <p>${esc(m.callerName)} ${m.type === 'report' ? `encontró el cuerpo de ${colorName(m.reportedColor)}` : 'pulsó el botón'}</p>`, 2200, 'rgba(0,0,0,0.92)');
    $('splashTeam').appendChild(R.crewIcon(hex(m.callerColor), 80));
    if (m.reportedColor) $('splashTeam').appendChild(R.crewIcon(hex(m.reportedColor), 80, { dead: true }));
  });
  socket.on('killed', ({ killerColor }) => {
    sfx.kill();
    Minigames.close();
    splash(`<h1 style="color:#ff3b3b;font-size:clamp(36px,8vw,72px)">¡TE HAN MATADO!</h1><div class="team" id="splashTeam"></div>
      <p>Ahora eres un fantasma: atraviesas paredes y aún puedes hacer tus tareas.</p>`, 2800, 'rgba(60,0,0,0.9)');
    $('splashTeam').appendChild(R.crewIcon(hex(killerColor), 90));
  });
  socket.on('didKill', () => sfx.kill());
  socket.on('sabotageStarted', () => sfx.alarm());
  socket.on('sabotageFixed', () => sfx.task());

  // ---------- HUD ----------
  let hudSig = '';
  function updateHud(s) {
    $('taskbarFill').style.width = (s.taskProgress * 100).toFixed(1) + '%';
    const imp = s.you.role === 'impostor';
    const sig = JSON.stringify([s.you.tasks, imp, s.you.alive]);
    if (sig !== hudSig) {
      hudSig = sig;
      const lines = s.you.tasks.map((t) => {
        const st = MAP.TASKS.find((x) => x.id === t.id);
        const room = MAP.ROOMS.find((r) => r.id === st.room);
        return `<div class="${t.done ? 'done' : ''}">${room.name}: ${st.name}</div>`;
      });
      $('taskList').innerHTML = imp
        ? `<div class="fake">Sabotea y mata a todos.</div><div style="opacity:.6">Tareas falsas:</div>${lines.join('')}`
        : (!s.you.alive ? '<div style="opacity:.7">Eres un fantasma. ¡Termina tus tareas!</div>' : '') + lines.join('');
    }

    const alert = $('sabotageAlert');
    if (s.sabotage) {
      alert.classList.remove('hidden');
      alert.textContent = s.sabotage.type === 'lights'
        ? '⚠ Luces saboteadas — arréglalas en Electricidad'
        : `☢ ¡Fusión del reactor en ${s.sabotage.timeLeft}s! Dos personas en los paneles del Reactor`;
    } else alert.classList.add('hidden');

    $('ghostChat').classList.toggle('hidden', s.you.alive);
    $('btnKill').classList.toggle('hidden', !imp);
    $('btnVent').classList.toggle('hidden', !imp);
    $('btnSabotage').classList.toggle('hidden', !imp);
    $('btnReport').classList.toggle('hidden', !s.you.alive);
    $('btnKill').querySelector('.cd').textContent = imp && s.you.killCooldown > 0 ? s.you.killCooldown : '';
  }

  // Calcula qué acciones hay disponibles cerca
  function nearby() {
    const s = state;
    const out = { use: null, kill: null, report: null, vent: null };
    if (!s || s.phase !== 'playing') return out;
    const alive = s.you.alive;
    const imp = s.you.role === 'impostor';
    const d = (p) => Math.hypot(p.x - me.x, p.y - me.y);

    if (s.you.inVent) {
      out.use = { kind: 'ventExit' };
      out.vent = { kind: 'next' };
      return out;
    }
    // Usar: sabotajes, tareas, emergencia
    if (alive && s.sabotage) {
      if (s.sabotage.type === 'lights' && d(MAP.LIGHTS_PANEL) < USE_RANGE)
        out.use = { kind: 'lights', at: MAP.LIGHTS_PANEL };
      if (s.sabotage.type === 'reactor')
        for (const k of ['A', 'B'])
          if (d(MAP.REACTOR_PANELS[k]) < USE_RANGE) out.use = { kind: 'reactor', panel: k, at: MAP.REACTOR_PANELS[k] };
    }
    if (!out.use && !imp) {
      let best = null;
      for (const t of s.you.tasks) {
        if (t.done) continue;
        const st = MAP.TASKS.find((x) => x.id === t.id);
        const dd = d(st);
        if (dd < USE_RANGE && (!best || dd < best.dd)) best = { dd, st };
      }
      if (best) out.use = { kind: 'task', task: best.st, at: best.st };
    }
    if (!out.use && alive && !s.you.emergencyUsed && !s.sabotage && s.emergencyCooldown === 0 && d(MAP.EMERGENCY) < USE_RANGE + 20)
      out.use = { kind: 'emergency', at: MAP.EMERGENCY };

    if (alive) {
      let bb = null;
      for (const b of s.bodies) if (d(b) < REPORT_RANGE && (!bb || d(b) < d(bb))) bb = b;
      if (bb) out.report = bb;
    }
    if (imp && alive) {
      if (s.you.killCooldown === 0) {
        let tgt = null;
        for (const p of s.players) {
          if (p.id === s.you.id || p.impostor || !p.alive) continue;
          const pos = disp.get(p.id) || p;
          if (d(pos) < KILL_RANGE && (!tgt || d(pos) < d(disp.get(tgt.id) || tgt))) tgt = p;
        }
        if (tgt) out.kill = tgt;
      }
      const v = MAP.VENTS.find((v) => d(v) < VENT_RANGE);
      if (v) out.vent = { kind: 'enter', at: v };
    }
    return out;
  }

  let openKind = null;
  function doUse() {
    const n = nearby().use;
    if (!n || Minigames.isOpen()) return;
    if (n.kind === 'ventExit') return socket.emit('vent', 'exit');
    if (n.kind === 'emergency') return socket.emit('emergency');
    openKind = n.kind;
    if (n.kind === 'task') {
      const t = n.task;
      const label = { medbay_scan: 'Escaneando...', admin_dl: 'Subiendo datos...' }[t.id] || 'Descargando datos...';
      Minigames.open(t.type, t.name, { onDone: () => { socket.emit('completeTask', t.id); sfx.task(); } }, { label });
    } else if (n.kind === 'lights') {
      Minigames.open('lights', 'Arreglar luces', {
        onToggle: (i) => socket.emit('lightsToggle', i),
        sabotage: () => state.sabotage,
      });
    } else if (n.kind === 'reactor') {
      Minigames.open('reactor', `Reactor · Panel ${n.panel}`, {
        panel: n.panel,
        onHold: (h) => socket.emit('reactorHold', { panel: n.panel, holding: h }),
        sabotage: () => state.sabotage,
      });
    }
  }
  function doKill() { const n = nearby().kill; if (n) socket.emit('kill', n.id); }
  function doReport() { const n = nearby().report; if (n) socket.emit('report', n.id); }
  function doVent() { const n = nearby().vent; if (n) socket.emit('vent', n.kind); }
  function toggleSabMenu() {
    if (!state || state.you.role !== 'impostor' || state.sabotage || state.sabotageCooldown > 0) return;
    sabMenuOpen = !sabMenuOpen;
    $('sabotageMenu').classList.toggle('hidden', !sabMenuOpen);
  }

  $('btnUse').onclick = doUse;
  $('btnKill').onclick = doKill;
  $('btnReport').onclick = doReport;
  $('btnVent').onclick = doVent;
  $('btnSabotage').onclick = toggleSabMenu;
  $('btnMap').onclick = () => (mapOpen ? closeMap() : openMap());
  $('sabotageMenu').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sab]');
    if (!b) return;
    socket.emit('sabotage', b.dataset.sab);
    sabMenuOpen = false;
    $('sabotageMenu').classList.add('hidden');
  });

  function sabotageTargets() {
    const s = state;
    if (!s || !s.sabotage) return null;
    return s.sabotage.type === 'lights' ? [MAP.LIGHTS_PANEL] : [MAP.REACTOR_PANELS.A, MAP.REACTOR_PANELS.B];
  }
  function myTaskSet() {
    if (!state || state.you.role !== 'crew') return new Set();
    return new Set(state.you.tasks.filter((t) => !t.done).map((t) => t.id));
  }

  function openMap() {
    if (!state || state.phase !== 'playing') return;
    mapOpen = true;
    $('mapOverlay').classList.remove('hidden');
    drawMap();
  }
  function drawMap() {
    const mine = state.players.find((p) => p.id === state.you.id);
    R.drawMiniMap($('mapCanvas'), {
      myTasks: myTaskSet(), sabotageTargets: sabotageTargets(), me, hex: hex(mine ? mine.color : 'red'),
    });
  }
  function closeMap() { mapOpen = false; $('mapOverlay').classList.add('hidden'); }
  $('mapOverlay').addEventListener('click', closeMap);

  // ---------- teclado / joystick ----------
  const typing = () => document.activeElement && document.activeElement.tagName === 'INPUT';
  addEventListener('keydown', (e) => {
    if (typing()) return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (!state || state.phase !== 'playing') return;
    if (k === 'e') doUse();
    else if (k === 'q') doKill();
    else if (k === 'r') doReport();
    else if (k === 'v') doVent();
    else if (k === 'm' || k === 'tab') { e.preventDefault(); mapOpen ? closeMap() : openMap(); }
    else if (k === 'escape') { Minigames.close(); closeMap(); }
    if (k.startsWith('arrow') || k === ' ') e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  const joyEl = $('joystick');
  const stick = joyEl.querySelector('.stick');
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) joyEl.classList.remove('hidden');
  joyEl.addEventListener('pointerdown', (e) => { joyEl.setPointerCapture(e.pointerId); moveJoy(e); });
  joyEl.addEventListener('pointermove', (e) => { if (joyEl.hasPointerCapture(e.pointerId)) moveJoy(e); });
  const endJoy = () => { joy.x = joy.y = 0; stick.style.transform = ''; };
  joyEl.addEventListener('pointerup', endJoy);
  joyEl.addEventListener('pointercancel', endJoy);
  function moveJoy(e) {
    const r = joyEl.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx *= max / len; dy *= max / len; }
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.x = Math.abs(dx) > 8 ? dx / max : 0;
    joy.y = Math.abs(dy) > 8 ? dy / max : 0;
  }

  // ---------- reunión ----------
  let selected = null;
  let meetingSig = '';
  function buildMeeting() {
    selected = null;
    meetingSig = '';
    updateMeeting(state);
  }

  function updateMeeting(s) {
    const m = s.meeting;
    if (!m) return;
    const grid = $('voteGrid');
    const sig = s.players.map((p) => p.id + p.alive).join();
    if (sig !== meetingSig) {
      meetingSig = sig;
      grid.innerHTML = '';
      for (const p of s.players) {
        const card = document.createElement('div');
        card.className = 'vote-card';
        card.dataset.id = p.id;
        card.appendChild(R.crewIcon(hex(p.color), 44, { dead: !p.alive }));
        card.insertAdjacentHTML('beforeend', `
          <span class="nm" style="${p.impostor ? 'color:#c51111' : ''}">${esc(p.name)}</span>
          ${p.id === m.callerId ? '<span class="megaphone">📢</span>' : ''}
          <span class="badge hidden">VOTÓ</span>
          <div class="confirm"><button data-ok="1" style="background:#50ef39">✔</button><button data-ok="0" style="background:#ff6b6b">✖</button></div>
          <div class="voters"></div>`);
        grid.appendChild(card);
      }
    }

    const myAlive = s.you.alive;
    const canVote = myAlive && m.stage === 'voting' && !m.myVote;
    const title =
      m.stage === 'discussion' ? '¿Quién es el impostor?' : m.stage === 'voting' ? (canVote ? 'Vota a quien quieras expulsar' : m.myVote ? 'Has votado' : 'Estás muerto: no puedes votar') : 'Resultados';
    $('meetingTitle').textContent = title;
    $('meetingTimer').textContent =
      m.stage === 'discussion' ? `Discusión: ${m.timeLeft}s` : m.stage === 'voting' ? `Votación: ${m.timeLeft}s` : '...';
    $('skipBtn').disabled = !canVote;

    for (const card of grid.children) {
      const id = card.dataset.id;
      const p = s.players.find((x) => x.id === id);
      card.classList.toggle('dead', !p || !p.alive);
      card.classList.toggle('sel', canVote && selected === id);
      card.querySelector('.badge').classList.toggle('hidden', !m.voted.includes(id));
      const voters = card.querySelector('.voters');
      voters.innerHTML = m.votes ? votersHtml(s, m.votes, id) : '';
    }
    $('skipVoters').innerHTML = m.votes ? votersHtml(s, m.votes, 'skip') : '';
  }

  function votersHtml(s, votes, target) {
    return Object.entries(votes)
      .filter(([, t]) => t === target)
      .map(([voter]) => {
        const p = s.players.find((x) => x.id === voter);
        return `<i style="background:${hex(p ? p.color : '')}"></i>`;
      }).join('');
  }

  $('voteGrid').addEventListener('click', (e) => {
    const s = state;
    if (!s || !s.meeting || s.meeting.stage !== 'voting' || !s.you.alive || s.meeting.myVote) return;
    const card = e.target.closest('.vote-card');
    if (!card) return;
    const ok = e.target.closest('button[data-ok]');
    if (ok) {
      e.stopPropagation();
      if (ok.dataset.ok === '1') socket.emit('vote', card.dataset.id);
      selected = null;
    } else if (!card.classList.contains('dead')) {
      selected = card.dataset.id;
    }
    updateMeeting(s);
  });
  $('skipBtn').onclick = () => socket.emit('vote', 'skip');

  // ---------- expulsión / fin ----------
  function showEjection() {
    const e = state.ejection;
    const cv = $('ejectCrew');
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    cv.style.visibility = e.color ? 'visible' : 'hidden';
    // reinicia la animación
    cv.style.animation = 'none'; void cv.offsetWidth; cv.style.animation = '';
    if (e.color) R.drawCrewmate(g, 84, 84, hex(e.color), { s: 2 });
    const text = $('ejectText');
    text.textContent = '';
    $('ejectSub').textContent = '';
    let i = 0;
    clearInterval(showEjection.t);
    showEjection.t = setInterval(() => {
      text.textContent = e.text.slice(0, ++i);
      if (i >= e.text.length) { clearInterval(showEjection.t); $('ejectSub').textContent = e.sub; }
    }, 55);
  }

  function showEnd() {
    const r = state.result;
    const myRole = state.you.role;
    const won = r.winner === myRole;
    $('endTitle').textContent = won ? 'VICTORIA' : 'DERROTA';
    $('endTitle').style.color = won ? '#38fedc' : '#ff3b3b';
    $('endReason').textContent = `${r.winner === 'impostor' ? 'Ganan los impostores' : 'Gana la tripulación'} · ${r.reason}`;
    const wrap = $('endPlayers');
    wrap.innerHTML = '';
    for (const p of r.players) {
      const d = document.createElement('div');
      d.className = p.role === 'impostor' ? 'imp' : '';
      d.appendChild(R.crewIcon(hex(p.color), 56, { dead: !p.alive }));
      d.insertAdjacentHTML('beforeend', `<span>${esc(p.name)}</span><small>${p.role === 'impostor' ? 'Impostor' : 'Tripulante'}</small>`);
      wrap.appendChild(d);
    }
    const isHost = state.hostId === state.you.id;
    $('lobbyBtn').classList.toggle('hidden', !isHost);
    $('endWait').classList.toggle('hidden', isHost);
  }
  $('lobbyBtn').onclick = () => socket.emit('backToLobby');

  // ---------- bucle principal ----------
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  let last = performance.now();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  }
  resize();
  addEventListener('resize', resize);

  function updateMovement(dt) {
    const s = state;
    let dx = 0, dy = 0;
    const blocked = typing() || Minigames.isOpen() || mapOpen || s.you.inVent || performance.now() < splashUntil;
    if (!blocked) {
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      dx += joy.x;
      dy += joy.y;
    }
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const step = MAP.SPEED * dt;
    const before = { x: me.x, y: me.y };
    if (len > 0.05) {
      const n = s.you.alive
        ? MAP.moveWithCollision(me.x, me.y, dx * step, dy * step)
        : MAP.clampWorld(me.x + dx * step, me.y + dy * step);
      me.x = n.x;
      me.y = n.y;
      if (dx < -0.1) me.flip = true;
      else if (dx > 0.1) me.flip = false;
    }
    me.moving = Math.hypot(me.x - before.x, me.y - before.y) > 0.1;
    if (me.moving) me.walk += dt * 14;

    const now = performance.now();
    if (now - lastSent.t > 33 && (me.x !== lastSent.x || me.y !== lastSent.y)) {
      socket.emit('move', { x: me.x, y: me.y, seq: me.seq });
      lastSent = { x: me.x, y: me.y, t: now };
    }
  }

  function setBtn(id, on) { $(id).classList.toggle('on', !!on); }

  function loop(t) {
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    const s = state;
    if (s && s.phase !== 'lobby' && $('game').classList.contains('active')) {
      if (s.phase === 'playing') updateMovement(dt);

      const players = [];
      for (const p of s.players) {
        if (p.id === s.you.id) {
          players.push({ ...p, x: me.x, y: me.y, flip: me.flip, walk: me.walk, moving: me.moving, self: true, alive: s.you.alive, hidden: !!s.you.inVent });
          continue;
        }
        let d = disp.get(p.id);
        if (!d) { d = { x: p.x, y: p.y, flip: false, walk: 0 }; disp.set(p.id, d); }
        const k = 1 - Math.exp(-dt * 14);
        const nx = d.x + (p.x - d.x) * k;
        const ny = d.y + (p.y - d.y) * k;
        if (Math.hypot(p.x - d.x, p.y - d.y) > 200) { d.x = p.x; d.y = p.y; } else { d.x = nx; d.y = ny; }
        const moving = Math.hypot(p.x - d.x, p.y - d.y) > 1.5;
        if (moving) d.walk += dt * 14;
        if (p.x < d.x - 1) d.flip = true;
        else if (p.x > d.x + 1) d.flip = false;
        players.push({ ...p, x: d.x, y: d.y, flip: d.flip, walk: d.walk, moving });
      }

      const imp = s.you.role === 'impostor';
      const lightsOut = s.sabotage && s.sabotage.type === 'lights' && !imp;
      const W = canvas.width, H = canvas.height;
      const scale = Math.min(W / 1300, H / 820);
      const near = nearby();
      R.frame(ctx, W, H, {
        cam: { x: me.x, y: me.y },
        scale,
        time: t / 1000,
        players,
        bodies: s.bodies || [],
        hex,
        myTasks: myTaskSet(),
        vision: imp ? VISION.impostor : lightsOut ? VISION.lightsOut : VISION.crew,
        showAll: !s.you.alive,
        sabotageTargets: sabotageTargets(),
        highlight: near.use && near.use.at ? near.use.at : null,
      });

      if (s.phase === 'playing') {
        setBtn('btnUse', near.use);
        setBtn('btnKill', near.kill);
        setBtn('btnReport', near.report);
        setBtn('btnVent', near.vent);
        setBtn('btnSabotage', imp && !s.sabotage && s.sabotageCooldown === 0);
        const room = MAP.roomAt(me.x, me.y);
        $('roomLabel').textContent = room ? room.name : '';
        if (mapOpen) drawMap();
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
