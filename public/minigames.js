// Minijuegos de tareas y de reparación de sabotajes (DOM).
(function () {
  const $ = (id) => document.getElementById(id);
  const box = $('minigame');
  const titleEl = $('mgTitle');
  const bodyEl = $('mgBody');
  let current = null;

  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  function finish(hooks) {
    if (current) current.finished = true;
    hooks.onDone && hooks.onDone();
    bodyEl.insertAdjacentHTML('beforeend', '<h2 class="mg-center" style="color:#50ef39">✔ ¡Tarea completada!</h2>');
    setTimeout(close, 700);
  }

  // ---------- utilidades para minijuegos con canvas ----------
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr;
    c.height = h * dpr;
    c.className = 'mg-canvas';
    c.style.aspectRatio = `${w} / ${h}`;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, g };
  }
  // Bucle que se detiene solo cuando se cierra el minijuego
  function runLoop(step) {
    const owner = current;
    let last = performance.now();
    let id = requestAnimationFrame(function f(t) {
      if (current !== owner) return;
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      step(dt);
      id = requestAnimationFrame(f);
    });
    return () => cancelAnimationFrame(id);
  }
  // Teclado del minijuego (se retira al cerrar)
  function listenKeys(onDown) {
    const held = new Set();
    const down = (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!e.repeat && onDown) onDown(k);
      held.add(k);
    };
    const up = (e) => held.delete(e.key.toLowerCase());
    addEventListener('keydown', down);
    addEventListener('keyup', up);
    return { held, off: () => { removeEventListener('keydown', down); removeEventListener('keyup', up); } };
  }
  const localPos = (c, e, w, h) => {
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };
  function banner(g, w, h, text, color) {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, h / 2 - 22, w, 44);
    g.fillStyle = color;
    g.font = '800 22px "Baloo 2", sans-serif';
    g.textAlign = 'center';
    g.fillText(text, w / 2, h / 2 + 8);
  }

  const builders = {
    // Pong: gana 3 puntos a la CPU
    pong(hooks) {
      const W = 440, H = 260, PW = 8, PH = 60, BR = 5, GOAL = 2;
      bodyEl.innerHTML = `<p class="mg-center">Gana 2 puntos a la CPU · <b>W/S</b>, flechas o arrastra</p>`;
      const { c, g } = makeCanvas(W, H);
      bodyEl.appendChild(c);
      const me = { y: H / 2 - PH / 2, score: 0, target: null };
      const cpu = { y: H / 2 - PH / 2, score: 0 };
      const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: 0, wait: 0 };
      let msg = null;
      const serve = (dir) => {
        ball.x = W / 2; ball.y = H / 2; ball.speed = 250;
        const a = (Math.random() - 0.5) * 0.9;
        ball.vx = Math.cos(a) * ball.speed * dir; ball.vy = Math.sin(a) * ball.speed;
        ball.wait = 0.7;
      };
      serve(-1);
      const keys = listenKeys();
      c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); me.target = localPos(c, e, W, H).y; });
      c.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || c.hasPointerCapture(e.pointerId)) me.target = localPos(c, e, W, H).y; });
      c.addEventListener('pointerleave', () => (me.target = null));
      const bounce = (py, dir) => {
        const rel = Math.max(-1, Math.min(1, (ball.y - (py + PH / 2)) / (PH / 2)));
        ball.speed = Math.min(ball.speed * 1.07, 520);
        ball.vx = Math.cos(rel * 1.0) * ball.speed * dir;
        ball.vy = Math.sin(rel * 1.0) * ball.speed;
      };
      const stop = runLoop((dt) => {
        if (current.finished) return;
        if (me.target != null) me.y += Math.sign(me.target - PH / 2 - me.y) * Math.min(Math.abs(me.target - PH / 2 - me.y), 700 * dt);
        if (keys.held.has('w') || keys.held.has('arrowup')) me.y -= 380 * dt;
        if (keys.held.has('s') || keys.held.has('arrowdown')) me.y += 380 * dt;
        me.y = Math.max(0, Math.min(H - PH, me.y));
        const cy = ball.vx > 0 ? ball.y : H / 2;
        cpu.y += Math.sign(cy - PH / 2 - cpu.y) * Math.min(Math.abs(cy - PH / 2 - cpu.y), 200 * dt);
        cpu.y = Math.max(0, Math.min(H - PH, cpu.y));
        if (msg) { msg.t -= dt; if (msg.t <= 0) msg = null; }

        if (ball.wait > 0) ball.wait -= dt;
        else for (let i = 0; i < 3; i++) {
          ball.x += ball.vx * dt / 3; ball.y += ball.vy * dt / 3;
          if (ball.y < BR || ball.y > H - BR) { ball.vy *= -1; ball.y = Math.max(BR, Math.min(H - BR, ball.y)); }
          if (ball.vx < 0 && ball.x - BR < 14 + PW && ball.x > 14 && ball.y > me.y - BR && ball.y < me.y + PH + BR) { ball.x = 14 + PW + BR; bounce(me.y, 1); }
          if (ball.vx > 0 && ball.x + BR > W - 14 - PW && ball.x < W - 14 && ball.y > cpu.y - BR && ball.y < cpu.y + PH + BR) { ball.x = W - 14 - PW - BR; bounce(cpu.y, -1); }
          if (ball.x < -10) {
            cpu.score++;
            if (cpu.score >= GOAL) { me.score = cpu.score = 0; msg = { text: '¡La CPU gana! Otra vez', color: '#ff6b6b', t: 1.5 }; }
            serve(-1); break;
          }
          if (ball.x > W + 10) {
            me.score++;
            if (me.score >= GOAL) { finish(hooks); break; }
            serve(1); break;
          }
        }

        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 4; g.setLineDash([10, 14]);
        g.beginPath(); g.moveTo(W / 2, 6); g.lineTo(W / 2, H - 6); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#fff';
        g.font = '800 30px "Baloo 2", sans-serif'; g.textAlign = 'center';
        g.fillText(me.score, W / 2 - 40, 38); g.fillText(cpu.score, W / 2 + 40, 38);
        g.fillRect(14, me.y, PW, PH); g.fillRect(W - 14 - PW, cpu.y, PW, PH);
        g.globalAlpha = ball.wait > 0 ? 0.5 : 1;
        g.beginPath(); g.arc(ball.x, ball.y, BR + 1, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        if (msg) banner(g, W, H, msg.text, msg.color);
      });
      return () => { stop(); keys.off(); };
    },

    // Tetris: completa 2 líneas (el fondo viene medio lleno)
    tetris(hooks) {
      const COLS = 10, ROWS = 14, CELL = 18, GOAL = 2;
      const W = COLS * CELL + 100, H = ROWS * CELL + 8;
      const SHAPES = {
        I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]], O: [[1, 1], [1, 1]],
        T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]], S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]], Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
        J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]], L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
      };
      const COL = { I: '#3ee6ff', O: '#ffd23f', T: '#b44dff', S: '#5dff8a', Z: '#ff4d4d', J: '#4d7cff', L: '#ff9f3f', G: '#5e6a8c' };
      bodyEl.innerHTML = `<p class="mg-center">Completa ${GOAL} líneas · <b>←→</b> mover · <b>↑</b> girar · <b>espacio</b> soltar</p>`;
      const { c, g } = makeCanvas(W, H);
      bodyEl.appendChild(c);
      bodyEl.insertAdjacentHTML('beforeend', `<div class="mg-pad"><button data-a="left">◀</button><button data-a="rot">⟳</button><button data-a="right">▶</button><button data-a="drop">⤓</button></div>`);

      let board, piece, next, lines, dropT, msg = null;
      const rand = () => 'IOTSZJL'[Math.floor(Math.random() * 7)];
      const collide = (m, x, y) => m.some((row, r) => row.some((v, cc) => v && (x + cc < 0 || x + cc >= COLS || y + r >= ROWS || (y + r >= 0 && board[y + r][x + cc]))));
      const rotate = (m) => m.map((row, r) => row.map((_, cc) => m[m.length - 1 - cc][r]));
      function reset() {
        board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
        const hole = Math.floor(Math.random() * COLS);
        for (let y = ROWS - 3; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== hole) board[y][x] = 'G';
        lines = 0; dropT = 0; next = rand(); spawn();
      }
      function spawn() {
        const t = next; next = rand();
        piece = { t, m: SHAPES[t].map((r) => r.slice()), x: 3, y: -1 };
        if (collide(piece.m, piece.x, piece.y)) { msg = { text: '¡Lleno! Otra vez', color: '#ff6b6b', t: 1.3 }; reset(); }
      }
      function lock() {
        piece.m.forEach((row, r) => row.forEach((v, cc) => { if (v && piece.y + r >= 0) board[piece.y + r][piece.x + cc] = piece.t; }));
        for (let y = ROWS - 1; y >= 0; y--) {
          if (board[y].every(Boolean)) { board.splice(y, 1); board.unshift(Array(COLS).fill(null)); lines++; y++; }
        }
        if (lines >= GOAL) return finish(hooks);
        spawn();
      }
      const act = (a) => {
        if (current.finished) return;
        if (a === 'left' && !collide(piece.m, piece.x - 1, piece.y)) piece.x--;
        if (a === 'right' && !collide(piece.m, piece.x + 1, piece.y)) piece.x++;
        if (a === 'down') { if (!collide(piece.m, piece.x, piece.y + 1)) piece.y++; else lock(); dropT = 0; }
        if (a === 'rot' && piece.t !== 'O') {
          const m = rotate(piece.m);
          for (const k of [0, -1, 1, -2, 2]) if (!collide(m, piece.x + k, piece.y)) { piece.m = m; piece.x += k; break; }
        }
        if (a === 'drop') { while (!collide(piece.m, piece.x, piece.y + 1)) piece.y++; lock(); }
      };
      const KEYS = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowdown: 'down', s: 'down', arrowup: 'rot', w: 'rot', x: 'rot', ' ': 'drop' };
      const keys = listenKeys((k) => KEYS[k] && act(KEYS[k]));
      bodyEl.querySelector('.mg-pad').addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); act(b.dataset.a); } });
      reset();

      const cell = (x, y, col) => { g.fillStyle = col; g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 1, y + 1, CELL - 2, 3); };
      const stop = runLoop((dt) => {
        if (current.finished) return;
        dropT += dt;
        if (dropT > 0.55) { dropT = 0; act('down'); }
        if (msg) { msg.t -= dt; if (msg.t <= 0) msg = null; }
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#0d0f14'; g.fillRect(4, 4, COLS * CELL, ROWS * CELL);
        board.forEach((row, y) => row.forEach((v, x) => v && cell(4 + x * CELL, 4 + y * CELL, COL[v])));
        let gy = piece.y; while (!collide(piece.m, piece.x, gy + 1)) gy++;
        piece.m.forEach((row, r) => row.forEach((v, cc) => {
          if (!v) return;
          if (gy + r >= 0) { g.strokeStyle = COL[piece.t]; g.globalAlpha = 0.45; g.strokeRect(4 + (piece.x + cc) * CELL + 2, 4 + (gy + r) * CELL + 2, CELL - 4, CELL - 4); g.globalAlpha = 1; }
          if (piece.y + r >= 0) cell(4 + (piece.x + cc) * CELL, 4 + (piece.y + r) * CELL, COL[piece.t]);
        }));
        const px = COLS * CELL + 20;
        g.fillStyle = '#8f97c4'; g.font = '700 13px "Baloo 2", sans-serif'; g.textAlign = 'left';
        g.fillText('SIGUIENTE', px, 22);
        SHAPES[next].forEach((row, r) => row.forEach((v, cc) => v && cell(px + cc * CELL, 32 + r * CELL, COL[next])));
        g.fillText('LÍNEAS', px, 130);
        g.fillStyle = '#fff'; g.font = '800 26px "Baloo 2", sans-serif';
        g.fillText(`${lines}/${GOAL}`, px, 160);
        if (msg) banner(g, W, H, msg.text, msg.color);
      });
      return () => { stop(); keys.off(); };
    },

    // Breakout: rompe todos los asteroides
    breakout(hooks) {
      const W = 440, H = 300, BR = 6, PY = H - 22, COLS = 6, ROWS = 2;
      bodyEl.innerHTML = `<p class="mg-center">Rompe todos los asteroides · mueve con el ratón/dedo o flechas · clic o espacio para lanzar</p>`;
      const { c, g } = makeCanvas(W, H);
      bodyEl.appendChild(c);
      const bw = (W - 20 - (COLS - 1) * 4) / COLS;
      const colors = ['#ff4d8d', '#ffd23f'];
      let bricks = [];
      for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++)
        bricks.push({ x: 10 + cc * (bw + 4), y: 30 + r * 22, w: bw, h: 16, color: colors[r] });
      const paddle = { x: W / 2, w: 74 };
      const ball = { x: W / 2, y: PY - BR - 1, vx: 0, vy: 0, stuck: true };
      const sparks = [];
      const launch = () => {
        if (!ball.stuck || current.finished) return;
        const a = (Math.random() - 0.5) * 0.8;
        ball.vx = Math.sin(a) * 340; ball.vy = -Math.cos(a) * 340; ball.stuck = false;
      };
      const keys = listenKeys((k) => k === ' ' && launch());
      c.addEventListener('pointermove', (e) => (paddle.x = localPos(c, e, W, H).x));
      c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); paddle.x = localPos(c, e, W, H).x; launch(); });

      const stop = runLoop((dt) => {
        if (current.finished) return;
        if (keys.held.has('arrowleft') || keys.held.has('a')) paddle.x -= 460 * dt;
        if (keys.held.has('arrowright') || keys.held.has('d')) paddle.x += 420 * dt;
        paddle.x = Math.max(paddle.w / 2, Math.min(W - paddle.w / 2, paddle.x));
        if (ball.stuck) { ball.x = paddle.x; ball.y = PY - BR - 1; }
        else for (let i = 0; i < 4; i++) {
          const px = ball.x, py = ball.y;
          ball.x += ball.vx * dt / 4; ball.y += ball.vy * dt / 4;
          if (ball.x < BR || ball.x > W - BR) { ball.vx *= -1; ball.x = Math.max(BR, Math.min(W - BR, ball.x)); }
          if (ball.y < BR) { ball.vy = Math.abs(ball.vy); ball.y = BR; }
          if (ball.vy > 0 && ball.y + BR >= PY && ball.y - BR < PY + 8 && Math.abs(ball.x - paddle.x) < paddle.w / 2 + BR) {
            const a = Math.max(-1, Math.min(1, (ball.x - paddle.x) / (paddle.w / 2))) * 1.0;
            ball.vx = Math.sin(a) * 340; ball.vy = -Math.cos(a) * 340; ball.y = PY - BR;
          }
          if (ball.y > H + 10) { ball.stuck = true; break; }
          for (const b of bricks) {
            const cx = Math.max(b.x, Math.min(ball.x, b.x + b.w)), cy = Math.max(b.y, Math.min(ball.y, b.y + b.h));
            if ((ball.x - cx) ** 2 + (ball.y - cy) ** 2 > BR * BR) continue;
            if (px < b.x || px > b.x + b.w) { ball.vx *= -1; ball.x = px; } else { ball.vy *= -1; ball.y = py; }
            b.dead = true;
            for (let k = 0; k < 8; k++) sparks.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, vx: (Math.random() - 0.5) * 240, vy: (Math.random() - 0.5) * 240, t: 0.4, color: b.color });
            break;
          }
          bricks = bricks.filter((b) => !b.dead);
          if (!bricks.length) { finish(hooks); break; }
        }

        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        for (const b of bricks) { g.fillStyle = b.color; g.beginPath(); g.roundRect ? g.roundRect(b.x, b.y, b.w, b.h, 4) : g.rect(b.x, b.y, b.w, b.h); g.fill(); }
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.x += s.vx * dt; s.y += s.vy * dt; s.t -= dt;
          if (s.t <= 0) { sparks.splice(i, 1); continue; }
          g.globalAlpha = s.t / 0.4; g.fillStyle = s.color; g.fillRect(s.x, s.y, 3, 3);
        }
        g.globalAlpha = 1;
        g.fillStyle = '#fff';
        g.fillRect(paddle.x - paddle.w / 2, PY, paddle.w, 8);
        g.beginPath(); g.arc(ball.x, ball.y, BR, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#8f97c4'; g.font = '700 13px "Baloo 2", sans-serif'; g.textAlign = 'right';
        g.fillText(`Quedan ${bricks.length}`, W - 10, 18);
      });
      return () => { stop(); keys.off(); };
    },

    // Pilotar la nave (estilo Flappy): pasa 5 huecos
    flappy(hooks) {
      const W = 440, H = 280, GOAL = 5, GAP = 96, SPEED = 150, SHIP_X = 90;
      bodyEl.innerHTML = `<p class="mg-center">Pasa ${GOAL} huecos · toca, clic o <b>espacio</b> para subir</p>`;
      const { c, g } = makeCanvas(W, H);
      bodyEl.appendChild(c);
      const stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() }));
      let ship, pipes, passed, started, crash, msg = null;
      function reset() {
        ship = { y: H / 2, vy: 0 };
        pipes = [];
        for (let i = 0; i < GOAL; i++) pipes.push({ x: W + 60 + i * 190, gapY: 60 + Math.random() * (H - 120 - GAP) + GAP / 2, passed: false });
        passed = 0; started = false; crash = 0;
      }
      reset();
      const flap = () => { if (current.finished || crash) return; started = true; ship.vy = -270; };
      const keys = listenKeys((k) => (k === ' ' || k === 'arrowup' || k === 'w') && flap());
      c.addEventListener('pointerdown', (e) => { e.preventDefault(); flap(); });

      const stop = runLoop((dt) => {
        if (current.finished) return;
        for (const st of stars) { st.x -= st.z * 40 * dt; if (st.x < 0) st.x = W; }
        if (msg) { msg.t -= dt; if (msg.t <= 0) msg = null; }
        if (crash) {
          crash -= dt;
          if (crash <= 0) reset();
        } else if (started) {
          ship.vy += 780 * dt;
          ship.y += ship.vy * dt;
          for (const p of pipes) {
            p.x -= SPEED * dt;
            if (!p.passed && p.x + 30 < SHIP_X) { p.passed = true; passed++; if (passed >= GOAL) { finish(hooks); return; } }
            const hitX = SHIP_X + 12 > p.x && SHIP_X - 12 < p.x + 30;
            const hitY = ship.y - 9 < p.gapY - GAP / 2 || ship.y + 9 > p.gapY + GAP / 2;
            if (hitX && hitY) { crash = 1; msg = { text: '¡Choque! Otra vez', color: '#ff6b6b', t: 1 }; }
          }
          if (ship.y < 0 || ship.y > H) { crash = 1; msg = { text: '¡Choque! Otra vez', color: '#ff6b6b', t: 1 }; }
        }

        g.fillStyle = '#05060f'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#fff';
        for (const st of stars) { g.globalAlpha = st.z / 1.3; g.fillRect(st.x, st.y, 2, 2); }
        g.globalAlpha = 1;
        for (const p of pipes) {
          if (p.passed) continue;
          g.fillStyle = '#5e6a8c'; g.strokeStyle = '#111'; g.lineWidth = 3;
          g.fillRect(p.x, 0, 30, p.gapY - GAP / 2); g.strokeRect(p.x, -3, 30, p.gapY - GAP / 2 + 3);
          g.fillRect(p.x, p.gapY + GAP / 2, 30, H); g.strokeRect(p.x, p.gapY + GAP / 2, 30, H);
        }
        // nave
        g.save();
        g.translate(SHIP_X, ship.y);
        g.rotate(Math.max(-0.5, Math.min(0.8, ship.vy / 500)));
        if (started && !crash) { g.fillStyle = '#ff9f3f'; g.beginPath(); g.moveTo(-14, -5); g.lineTo(-24 - Math.random() * 8, 0); g.lineTo(-14, 5); g.fill(); }
        g.fillStyle = crash ? '#ff4d4d' : '#d6e0f0'; g.strokeStyle = '#111'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(16, 0); g.lineTo(-14, -11); g.lineTo(-10, 0); g.lineTo(-14, 11); g.closePath(); g.fill(); g.stroke();
        g.fillStyle = '#95cadc'; g.beginPath(); g.ellipse(3, 0, 6, 4, 0, 0, Math.PI * 2); g.fill();
        g.restore();
        g.fillStyle = '#fff'; g.font = '800 22px "Baloo 2", sans-serif'; g.textAlign = 'center';
        g.fillText(`${passed}/${GOAL}`, W / 2, 30);
        if (!started && !crash) banner(g, W, H, 'Toca para despegar', '#fff');
        if (msg) banner(g, W, H, msg.text, msg.color);
      });
      return () => { stop(); keys.off(); };
    },

    wires(hooks) {
      const colors = ['#e53935', '#1e88e5', '#fdd835', '#d81b60'];
      const L = shuffle(colors), Rr = shuffle(colors);
      bodyEl.innerHTML = `<p class="mg-center">Une cada cable con su color</p>
        <div class="mg-wires"><svg></svg>
          <div class="col">${L.map((c) => `<div class="wire" data-side="L" data-c="${c}" style="background:${c}"></div>`).join('')}</div>
          <div class="col">${Rr.map((c) => `<div class="wire" data-side="R" data-c="${c}" style="background:${c}"></div>`).join('')}</div>
        </div>`;
      const wrap = bodyEl.querySelector('.mg-wires');
      const svg = wrap.querySelector('svg');
      let sel = null, ok = 0;
      wrap.addEventListener('click', (e) => {
        const w = e.target.closest('.wire');
        if (!w || w.classList.contains('ok')) return;
        if (w.dataset.side === 'L') {
          wrap.querySelectorAll('.wire.sel').forEach((x) => x.classList.remove('sel'));
          w.classList.add('sel');
          sel = w;
        } else if (sel) {
          if (sel.dataset.c === w.dataset.c) {
            const base = wrap.getBoundingClientRect();
            const a = sel.getBoundingClientRect(), b = w.getBoundingClientRect();
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', a.right - base.left); line.setAttribute('y1', a.top + a.height / 2 - base.top);
            line.setAttribute('x2', b.left - base.left); line.setAttribute('y2', b.top + b.height / 2 - base.top);
            line.setAttribute('stroke', w.dataset.c); line.setAttribute('stroke-width', '12'); line.setAttribute('stroke-linecap', 'round');
            svg.appendChild(line);
            sel.classList.remove('sel');
            sel.classList.add('ok'); w.classList.add('ok');
            sel = null;
            if (++ok === 4) finish(hooks);
          } else {
            sel.classList.remove('sel');
            sel = null;
          }
        }
      });
    },

    numbers(hooks) {
      const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      bodyEl.innerHTML = `<p class="mg-center">Pulsa los números del 1 al 10 en orden</p>
        <div class="mg-numbers">${nums.map((n) => `<button data-n="${n}">${n}</button>`).join('')}</div>`;
      const grid = bodyEl.querySelector('.mg-numbers');
      let next = 1;
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || b.classList.contains('ok') || current.finished) return;
        if (Number(b.dataset.n) === next) {
          b.classList.add('ok');
          if (++next > 10) finish(hooks);
        } else {
          next = 1;
          grid.classList.add('err');
          grid.querySelectorAll('button').forEach((x) => x.classList.remove('ok'));
          setTimeout(() => grid.classList.remove('err'), 350);
        }
      });
    },

    download(hooks, opts) {
      bodyEl.innerHTML = `<div class="mg-center">
        <p>${opts.label || 'Transfiriendo datos'}</p>
        <div class="mg-progress"><div></div></div>
        <button class="btn">Iniciar</button></div>`;
      const bar = bodyEl.querySelector('.mg-progress div');
      const btn = bodyEl.querySelector('button');
      let timer = null;
      btn.addEventListener('click', () => {
        btn.disabled = true;
        const start = performance.now();
        const DUR = 5000;
        timer = setInterval(() => {
          const p = Math.min(1, (performance.now() - start) / DUR);
          bar.style.width = p * 100 + '%';
          btn.textContent = Math.round(p * 100) + '%';
          if (p >= 1) { clearInterval(timer); finish(hooks); }
        }, 50);
      });
      return () => clearInterval(timer);
    },

    calibrate(hooks) {
      // Deslizador propio: la posición dibujada y el valor comprobado salen del mismo número
      const TOL = 6; // mitad del ancho de la zona verde, en %
      const rows = [0, 1].map(() => {
        const target = 12 + Math.random() * 76;
        let value;
        do value = 4 + Math.random() * 92; while (Math.abs(value - target) < 25);
        return { target, value };
      });
      bodyEl.innerHTML = `<p class="mg-center">Arrastra cada barra amarilla dentro de su zona verde</p>` +
        rows.map((r, i) => `<div class="mg-slider" data-i="${i}"><div class="track">
          <div class="target" style="left:${r.target - TOL}%;width:${TOL * 2}%"></div>
          <div class="handle" style="left:${r.value}%"></div></div></div>`).join('');
      const sliders = [...bodyEl.querySelectorAll('.mg-slider')];

      const check = () => {
        let all = true;
        sliders.forEach((s, i) => {
          const good = Math.abs(rows[i].value - rows[i].target) <= TOL;
          s.classList.toggle('ok', good);
          if (!good) all = false;
        });
        return all;
      };

      sliders.forEach((s, i) => {
        const track = s.querySelector('.track');
        const handle = s.querySelector('.handle');
        const setFrom = (e) => {
          const rect = track.getBoundingClientRect();
          rows[i].value = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
          handle.style.left = rows[i].value + '%';
          check();
        };
        track.addEventListener('pointerdown', (e) => {
          if (current.finished) return;
          track.setPointerCapture(e.pointerId);
          s.classList.add('drag');
          setFrom(e);
        });
        track.addEventListener('pointermove', (e) => {
          if (track.hasPointerCapture(e.pointerId)) setFrom(e);
        });
        const release = () => {
          s.classList.remove('drag');
          if (check() && !current.finished) finish(hooks);
        };
        track.addEventListener('pointerup', release);
        track.addEventListener('pointercancel', release);
      });
      check();
    },

    lights(hooks) {
      bodyEl.innerHTML = `<p class="mg-center">Enciende todos los interruptores</p><div class="mg-switches"></div>`;
      const wrap = bodyEl.querySelector('.mg-switches');
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) hooks.onToggle(Number(b.dataset.i));
      });
      current.update = (sab) => {
        if (!sab || sab.type !== 'lights') {
          wrap.innerHTML = '<h2 style="color:#50ef39">✔ ¡Luces arregladas!</h2>';
          setTimeout(close, 700);
          current.update = null;
          return;
        }
        wrap.innerHTML = sab.switches.map((on, i) => `<button data-i="${i}" class="${on ? 'on' : ''}"></button>`).join('');
      };
      current.update(hooks.sabotage());
    },

    reactor(hooks) {
      bodyEl.innerHTML = `<p class="mg-center">Mantén pulsado. Otra persona debe hacerlo a la vez en el otro panel.</p>
        <button class="mg-hold">MANTENER</button><p class="mg-center" id="mgReactorStatus"></p>`;
      const btn = bodyEl.querySelector('.mg-hold');
      const status = bodyEl.querySelector('#mgReactorStatus');
      let holding = false;
      const set = (v) => {
        if (v === holding) return;
        holding = v;
        btn.classList.toggle('holding', v);
        hooks.onHold(v);
      };
      btn.addEventListener('pointerdown', (e) => { btn.setPointerCapture(e.pointerId); set(true); });
      btn.addEventListener('pointerup', () => set(false));
      btn.addEventListener('pointercancel', () => set(false));
      current.update = (sab) => {
        if (!sab || sab.type !== 'reactor') {
          status.innerHTML = '<b style="color:#50ef39">✔ ¡Reactor estabilizado!</b>';
          setTimeout(close, 700);
          current.update = null;
          return;
        }
        const other = hooks.panel === 'A' ? 'B' : 'A';
        status.textContent = `Otro panel: ${sab.holds[other] ? '✔ activo' : '✖ esperando'} · ${sab.timeLeft}s`;
      };
      current.update(hooks.sabotage());
      return () => set(false);
    },
  };

  function open(kind, title, hooks, opts = {}) {
    close();
    current = { kind, finished: false, update: null, cleanup: null };
    titleEl.textContent = title;
    box.classList.remove('hidden');
    const cleanup = builders[kind](hooks, opts);
    if (current) current.cleanup = cleanup || null;
  }

  function close() {
    if (!current) return;
    const c = current;
    current = null;
    c.cleanup && c.cleanup();
    box.classList.add('hidden');
    bodyEl.innerHTML = '';
  }

  function update(sab) {
    if (current && current.update) current.update(sab);
  }

  $('mgClose').addEventListener('click', close);

  window.Minigames = { open, close, update, isOpen: () => !!current };
})();
