// Utilidades comunes: sonido, canvas nítido, récords y partículas.
window.Arcade = (function () {
  let actx = null;
  let muted = false;

  function beep(freq, dur = 0.07, type = 'square', vol = 0.05, slideTo) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + dur);
    } catch (_) {}
  }

  // Canvas con resolución lógica fija W×H, nítido en pantallas retina
  function setupCanvas(canvas, W, H) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.aspectRatio = `${W} / ${H}`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = () => {
      const stage = canvas.parentElement;
      const s = Math.min(stage.clientWidth / W, stage.clientHeight / H);
      canvas.style.width = Math.floor(W * s) + 'px';
      canvas.style.height = Math.floor(H * s) + 'px';
    };
    fit();
    addEventListener('resize', fit);
    return ctx;
  }

  // Convierte un evento de puntero a coordenadas lógicas del canvas
  function toLocal(canvas, e, W, H) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  function getBest(key) {
    try { return Number(localStorage.getItem('arcade_' + key)) || 0; } catch (_) { return 0; }
  }
  function setBest(key, v) {
    try { localStorage.setItem('arcade_' + key, String(v)); } catch (_) {}
  }

  function particles() {
    const list = [];
    return {
      burst(x, y, color, n = 12, speed = 220, life = 0.5) {
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = speed * (0.3 + Math.random() * 0.7);
          list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: 2 + Math.random() * 3 });
        }
      },
      update(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.96;
          p.vy *= 0.96;
          p.life -= dt;
          if (p.life <= 0) list.splice(i, 1);
        }
      },
      draw(ctx) {
        for (const p of list) {
          ctx.globalAlpha = Math.max(0, p.life / p.max);
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
      },
      clear() { list.length = 0; },
    };
  }

  // Botón táctil que repite mientras se mantiene pulsado
  function holdButton(el, onPress, onRelease) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      onPress();
    });
    const up = () => { el.classList.remove('on'); onRelease && onRelease(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  return { beep, setupCanvas, toLocal, getBest, setBest, particles, holdButton, setMuted: (m) => (muted = m) };
})();
