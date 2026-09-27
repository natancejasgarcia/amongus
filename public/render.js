// Dibujo con canvas: tripulantes, mapa, niebla y minimapa.
(function () {
  const MAP = window.GAME_MAP;

  function rr(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c * (1 + amt))));
    const r = f(n >> 16), gg = f((n >> 8) & 255), b = f(n & 255);
    return `rgb(${r},${gg},${b})`;
  }

  // Tripulante centrado en (x, y); ~60px de alto
  function drawCrewmate(g, x, y, hex, o = {}) {
    const walk = o.walk == null ? null : o.walk;
    const l = walk == null ? 0 : Math.sin(walk) * 6;
    const dark = shade(hex, -0.35);
    g.save();
    g.translate(x, y);
    g.scale((o.flip ? -1 : 1) * (o.s || 1), o.s || 1);
    g.globalAlpha = o.alpha == null ? 1 : o.alpha;
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.strokeStyle = '#111';

    if (!o.ghost) {
      g.fillStyle = dark;
      rr(g, -16 + l * 0.6, 8, 13, 20 - Math.max(0, l) * 0.5, 5); g.fill(); g.stroke();
      rr(g, 3 - l * 0.6, 8, 13, 20 - Math.max(0, -l) * 0.5, 5); g.fill(); g.stroke();
    }
    g.fillStyle = dark;
    rr(g, -26, -14, 12, 26, 5); g.fill(); g.stroke();

    g.fillStyle = hex;
    if (o.ghost) {
      // cola ondulada de fantasma
      g.beginPath();
      g.moveTo(-18, -12);
      g.arcTo(-18, -30, 0, -30, 18);
      g.arcTo(18, -30, 18, -12, 18);
      g.lineTo(18, 14);
      const t = (o.time || 0) * 4;
      for (let i = 0; i <= 6; i++) g.lineTo(18 - i * 6, 14 + Math.sin(t + i) * 4 + (i % 2 ? 6 : 0));
      g.closePath();
      g.fill(); g.stroke();
    } else {
      rr(g, -18, -30, 36, 48, [18, 18, 8, 8]); g.fill(); g.stroke();
    }

    g.fillStyle = '#95cadc';
    rr(g, -2, -22, 24, 14, 7); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    rr(g, 6, -20, 10, 4, 2); g.fill();
    g.restore();
  }

  function drawBody(g, x, y, hex) {
    const dark = shade(hex, -0.35);
    g.save();
    g.translate(x, y);
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.strokeStyle = '#111';
    g.fillStyle = dark;
    rr(g, -16, 8, 13, 18, 5); g.fill(); g.stroke();
    rr(g, 3, 8, 13, 18, 5); g.fill(); g.stroke();
    g.fillStyle = '#eee';
    rr(g, -4, -14, 8, 14, 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(-4, -15, 5, 0, Math.PI * 2); g.arc(4, -15, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = hex;
    rr(g, -18, -4, 36, 22, [6, 6, 8, 8]); g.fill(); g.stroke();
    g.fillStyle = '#b30000';
    g.beginPath(); g.ellipse(0, -3, 12, 4, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function crewIcon(hex, size = 44, o = {}) {
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = size * dpr;
    c.style.width = c.style.height = size + 'px';
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    if (o.dead) drawBody(g, size / 2, size / 2 + 2, hex);
    else drawCrewmate(g, size / 2 + 3, size / 2 + 1, hex, { s: size / 64 });
    return c;
  }

  // ---------- capa estática del mapa ----------
  let layer = null;
  function buildLayer() {
    layer = document.createElement('canvas');
    layer.width = MAP.WORLD.w;
    layer.height = MAP.WORLD.h;
    const g = layer.getContext('2d');

    for (const r of MAP.WALKABLE) {
      g.fillStyle = '#151a2e';
      g.fillRect(r.x - 30, r.y - 56, r.w + 60, r.h + 86);
    }
    for (const r of MAP.WALKABLE) {
      g.fillStyle = '#4a5378';
      g.fillRect(r.x - 22, r.y - 48, r.w + 44, r.h + 70);
    }
    // pared frontal (efecto 3D)
    for (const r of MAP.WALKABLE) {
      g.fillStyle = '#39405e';
      g.fillRect(r.x, r.y - 48, r.w, 48);
    }
    for (const r of MAP.HALLS) {
      g.fillStyle = '#6c7386';
      g.fillRect(r.x, r.y, r.w, r.h);
    }
    for (const r of MAP.ROOMS) {
      g.fillStyle = '#8f98ab';
      g.fillRect(r.x, r.y, r.w, r.h);
      g.save();
      g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 2;
      for (let x = r.x; x < r.x + r.w; x += 50) { g.beginPath(); g.moveTo(x, r.y); g.lineTo(x, r.y + r.h); g.stroke(); }
      for (let y = r.y; y < r.y + r.h; y += 50) { g.beginPath(); g.moveTo(r.x, y); g.lineTo(r.x + r.w, y); g.stroke(); }
      g.restore();
    }
    // los pasillos tapan la pared frontal donde conectan
    for (const r of MAP.HALLS) {
      g.fillStyle = '#6c7386';
      g.fillRect(r.x, r.y, r.w, r.h);
    }

    // mesa y botón de emergencia
    const E = MAP.EMERGENCY;
    g.fillStyle = '#5b6680'; g.strokeStyle = '#111'; g.lineWidth = 4;
    g.beginPath(); g.arc(E.x, E.y, 60, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#c51111';
    g.beginPath(); g.arc(E.x, E.y, 20, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#ff6b6b';
    g.beginPath(); g.arc(E.x - 5, E.y - 6, 7, 0, Math.PI * 2); g.fill();

    // mesas decorativas en la cafetería
    for (const [tx, ty] of [[1060, 190], [1440, 190], [1060, 420], [1440, 420]]) {
      g.fillStyle = '#6a758f';
      g.beginPath(); g.arc(tx, ty, 34, 0, Math.PI * 2); g.fill(); g.stroke();
    }

    for (const t of MAP.TASKS) drawConsole(g, t.x, t.y, '#4d5b82');
    drawConsole(g, MAP.LIGHTS_PANEL.x, MAP.LIGHTS_PANEL.y, '#7a6b2a');
    for (const p of Object.values(MAP.REACTOR_PANELS)) drawConsole(g, p.x, p.y, '#2a6b7a');

    for (const v of MAP.VENTS) {
      g.fillStyle = '#3b4252'; g.strokeStyle = '#111'; g.lineWidth = 3;
      rr(g, v.x - 22, v.y - 12, 44, 24, 4); g.fill(); g.stroke();
      g.strokeStyle = '#222'; g.lineWidth = 2;
      for (let i = -14; i <= 14; i += 7) { g.beginPath(); g.moveTo(v.x + i, v.y - 8); g.lineTo(v.x + i, v.y + 8); g.stroke(); }
    }

    g.font = '800 26px "Baloo 2", sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(20,24,40,0.35)';
    for (const r of MAP.ROOMS) g.fillText(r.name.toUpperCase(), r.x + r.w / 2, r.y + 36);
  }

  function drawConsole(g, x, y, col) {
    g.fillStyle = col; g.strokeStyle = '#111'; g.lineWidth = 3;
    rr(g, x - 18, y - 16, 36, 32, 5); g.fill(); g.stroke();
    g.fillStyle = '#9fe8ff';
    rr(g, x - 11, y - 10, 22, 12, 2); g.fill();
  }

  // ---------- fotograma ----------
  const fog = document.createElement('canvas');

  function frame(ctx, W, H, v) {
    if (!layer) buildLayer();
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(v.scale, v.scale);
    ctx.translate(-v.cam.x, -v.cam.y);
    ctx.drawImage(layer, 0, 0);

    const pulse = 0.5 + Math.sin(v.time * 5) * 0.5;
    ctx.lineWidth = 4;
    for (const t of MAP.TASKS) {
      if (!v.myTasks.has(t.id)) continue;
      ctx.strokeStyle = `rgba(245,245,87,${0.5 + pulse * 0.5})`;
      rr(ctx, t.x - 23, t.y - 21, 46, 42, 7); ctx.stroke();
    }
    if (v.sabotageTargets) {
      for (const p of v.sabotageTargets) {
        ctx.strokeStyle = `rgba(255,50,50,${0.4 + pulse * 0.6})`;
        rr(ctx, p.x - 25, p.y - 23, 50, 46, 8); ctx.stroke();
      }
    }
    if (v.highlight) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(v.highlight.x, v.highlight.y, 36, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    const visible = (p) => v.showAll || Math.hypot(p.x - v.cam.x, p.y - v.cam.y) < v.vision + 30;
    for (const b of v.bodies) if (visible(b)) drawBody(ctx, b.x, b.y, v.hex(b.color));

    const list = v.players.filter((p) => p.self || visible(p)).sort((a, b) => a.y - b.y);
    for (const p of list) {
      if (p.hidden) continue;
      drawCrewmate(ctx, p.x, p.y, v.hex(p.color), {
        flip: p.flip, walk: p.moving ? p.walk : null, alpha: p.alive ? 1 : 0.5, ghost: !p.alive, time: v.time,
      });
    }
    ctx.font = '700 17px "Baloo 2", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    for (const p of list) {
      if (p.hidden) continue;
      ctx.globalAlpha = p.alive ? 1 : 0.6;
      ctx.fillStyle = p.impostor ? '#ff3b3b' : '#fff';
      ctx.strokeText(p.name, p.x, p.y - 38);
      ctx.fillText(p.name, p.x, p.y - 38);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (!v.showAll) {
      if (fog.width !== W || fog.height !== H) { fog.width = W; fog.height = H; }
      const f = fog.getContext('2d');
      const r = v.vision * v.scale;
      f.globalCompositeOperation = 'source-over';
      f.clearRect(0, 0, W, H);
      f.fillStyle = 'rgba(0,0,0,0.9)';
      f.fillRect(0, 0, W, H);
      f.globalCompositeOperation = 'destination-out';
      const grad = f.createRadialGradient(W / 2, H / 2, r * 0.65, W / 2, H / 2, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = grad;
      f.beginPath(); f.arc(W / 2, H / 2, r, 0, Math.PI * 2); f.fill();
      ctx.drawImage(fog, 0, 0);
    }

    // flechas hacia el sabotaje
    if (v.sabotageTargets) {
      for (const t of v.sabotageTargets) {
        const dx = t.x - v.cam.x, dy = t.y - v.cam.y;
        const d = Math.hypot(dx, dy);
        if (d * v.scale < Math.min(W, H) / 2 - 40) continue;
        const a = Math.atan2(dy, dx);
        const rad = Math.min(W, H) / 2 - 40;
        ctx.save();
        ctx.translate(W / 2 + Math.cos(a) * rad, H / 2 + Math.sin(a) * rad);
        ctx.rotate(a);
        ctx.fillStyle = `rgba(255,40,40,${0.6 + pulse * 0.4})`;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-12, -16); ctx.lineTo(-12, 16); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ---------- minimapa ----------
  function drawMiniMap(canvas, info) {
    const maxW = Math.min(window.innerWidth - 40, 1100);
    const s = Math.min(maxW / MAP.WORLD.w, (window.innerHeight * 0.8) / MAP.WORLD.h);
    canvas.width = MAP.WORLD.w * s;
    canvas.height = MAP.WORLD.h * s;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(10,30,60,0.9)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.scale(s, s);
    g.fillStyle = '#3d7fb8';
    for (const r of MAP.WALKABLE) g.fillRect(r.x - 10, r.y - 10, r.w + 20, r.h + 20);
    g.fillStyle = '#1b4a78';
    for (const r of MAP.WALKABLE) g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#fff';
    g.font = '700 44px "Baloo 2", sans-serif';
    g.textAlign = 'center';
    for (const r of MAP.ROOMS) g.fillText(r.name, r.x + r.w / 2, r.y + r.h / 2 + 14);
    g.fillStyle = '#f5f557';
    for (const t of MAP.TASKS) {
      if (!info.myTasks.has(t.id)) continue;
      g.beginPath(); g.arc(t.x, t.y, 22, 0, Math.PI * 2); g.fill();
    }
    if (info.sabotageTargets) {
      g.fillStyle = '#ff3b3b';
      for (const t of info.sabotageTargets) { g.beginPath(); g.arc(t.x, t.y, 28, 0, Math.PI * 2); g.fill(); }
    }
    drawCrewmate(g, info.me.x, info.me.y, info.hex, { s: 1.6 });
  }

  // ---------- fondo de estrellas ----------
  function starfield(canvas) {
    const g = canvas.getContext('2d');
    let stars = [];
    function resize() {
      canvas.width = innerWidth;
      canvas.height = innerHeight;
      stars = Array.from({ length: 160 }, () => ({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        z: Math.random() * 2 + 0.3,
      }));
    }
    resize();
    addEventListener('resize', resize);
    (function tick() {
      if (canvas.offsetParent !== null || getComputedStyle(canvas).display !== 'none') {
        g.fillStyle = '#07091a';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = '#fff';
        for (const s of stars) {
          s.x -= s.z * 0.6;
          if (s.x < 0) s.x = canvas.width;
          g.globalAlpha = s.z / 2.3;
          g.fillRect(s.x, s.y, s.z, s.z);
        }
        g.globalAlpha = 1;
      }
      requestAnimationFrame(tick);
    })();
  }

  window.R = { drawCrewmate, drawBody, crewIcon, frame, drawMiniMap, starfield };
})();
