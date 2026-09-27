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

  const builders = {
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
