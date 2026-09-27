// Mapa compartido entre servidor (require) y cliente (window.GAME_MAP).
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.GAME_MAP = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const WORLD = { w: 2600, h: 1500 };
  const SPEED = 270; // px/s

  // Caja de colisión del jugador alrededor de su centro
  const BOX = { hw: 18, top: 26, bottom: 26 };

  const ROOMS = [
    { id: 'cafeteria', name: 'Cafetería', x: 950, y: 80, w: 600, h: 420 },
    { id: 'weapons', name: 'Armas', x: 1850, y: 120, w: 380, h: 300 },
    { id: 'navigation', name: 'Navegación', x: 2250, y: 600, w: 300, h: 320 },
    { id: 'shields', name: 'Escudos', x: 1850, y: 1060, w: 360, h: 320 },
    { id: 'comms', name: 'Comunicaciones', x: 1350, y: 1180, w: 320, h: 260 },
    { id: 'storage', name: 'Almacén', x: 950, y: 850, w: 360, h: 480 },
    { id: 'admin', name: 'Administración', x: 1450, y: 660, w: 300, h: 260 },
    { id: 'electrical', name: 'Electricidad', x: 560, y: 940, w: 300, h: 270 },
    { id: 'lowerEngine', name: 'Motor inferior', x: 120, y: 1040, w: 320, h: 300 },
    { id: 'reactor', name: 'Reactor', x: 30, y: 570, w: 270, h: 340 },
    { id: 'upperEngine', name: 'Motor superior', x: 120, y: 110, w: 320, h: 300 },
    { id: 'medbay', name: 'Enfermería', x: 560, y: 420, w: 280, h: 260 },
  ];

  const HALLS = [
    { x: 420, y: 200, w: 550, h: 120 },  // motor sup -> cafetería
    { x: 650, y: 300, w: 110, h: 140 },  // pasillo -> enfermería
    { x: 1530, y: 200, w: 340, h: 110 }, // cafetería -> armas
    { x: 1990, y: 400, w: 120, h: 680 }, // armas -> escudos
    { x: 2090, y: 700, w: 180, h: 120 }, // -> navegación
    { x: 1070, y: 480, w: 120, h: 390 }, // cafetería -> almacén
    { x: 1170, y: 740, w: 300, h: 110 }, // -> administración
    { x: 1290, y: 1220, w: 80, h: 110 }, // almacén -> comunicaciones
    { x: 1650, y: 1230, w: 220, h: 110 }, // comunicaciones -> escudos
    { x: 420, y: 1230, w: 550, h: 100 }, // motor inf -> almacén
    { x: 650, y: 1190, w: 110, h: 60 },  // electricidad -> pasillo inferior
    { x: 170, y: 390, w: 120, h: 670 },  // motores <-> reactor
  ];

  const WALKABLE = ROOMS.concat(HALLS);

  // type: wires | numbers | download | calibrate
  const TASKS = [
    { id: 'cafe_wires', room: 'cafeteria', name: 'Arreglar cables', type: 'wires', x: 1000, y: 130 },
    { id: 'weap_cal', room: 'weapons', name: 'Calibrar armas', type: 'calibrate', x: 2170, y: 170 },
    { id: 'nav_cal', room: 'navigation', name: 'Estabilizar rumbo', type: 'calibrate', x: 2500, y: 760 },
    { id: 'nav_dl', room: 'navigation', name: 'Descargar datos', type: 'download', x: 2300, y: 880 },
    { id: 'shields_num', room: 'shields', name: 'Activar escudos', type: 'numbers', x: 2150, y: 1330 },
    { id: 'comms_dl', room: 'comms', name: 'Descargar datos', type: 'download', x: 1620, y: 1400 },
    { id: 'storage_wires', room: 'storage', name: 'Arreglar cables', type: 'wires', x: 1000, y: 1280 },
    { id: 'admin_dl', room: 'admin', name: 'Subir datos', type: 'download', x: 1700, y: 700 },
    { id: 'elec_wires', room: 'electrical', name: 'Arreglar cables', type: 'wires', x: 610, y: 990 },
    { id: 'elec_cal', room: 'electrical', name: 'Calibrar distribuidor', type: 'calibrate', x: 810, y: 990 },
    { id: 'lower_cal', room: 'lowerEngine', name: 'Alinear motor', type: 'calibrate', x: 170, y: 1290 },
    { id: 'reactor_num', room: 'reactor', name: 'Arrancar reactor', type: 'numbers', x: 80, y: 870 },
    { id: 'upper_cal', room: 'upperEngine', name: 'Alinear motor', type: 'calibrate', x: 170, y: 160 },
    { id: 'medbay_scan', room: 'medbay', name: 'Escaneo médico', type: 'download', x: 790, y: 630 },
    // tareas-juego (rápidas)
    { id: 'comms_pong', room: 'comms', name: 'Sincronizar señal', type: 'pong', x: 1400, y: 1230 },
    { id: 'storage_tetris', room: 'storage', name: 'Ordenar la carga', type: 'tetris', x: 1250, y: 900 },
    { id: 'weap_breakout', room: 'weapons', name: 'Destruir asteroides', type: 'breakout', x: 1950, y: 170 },
    { id: 'nav_flappy', room: 'navigation', name: 'Pilotar la nave', type: 'flappy', x: 2450, y: 645 },
  ];
  const GAME_TASK_TYPES = ['pong', 'tetris', 'breakout', 'flappy'];

  const EMERGENCY = { x: 1250, y: 290 };
  const LIGHTS_PANEL = { x: 600, y: 1160 };
  const REACTOR_PANELS = { A: { x: 60, y: 650 }, B: { x: 262, y: 650 } };

  // Conductos: dentro de un grupo se puede viajar en ciclo
  const VENTS = [
    { id: 'v_upper', group: 'west', x: 400, y: 370 },
    { id: 'v_reactor', group: 'west', x: 240, y: 860 },
    { id: 'v_lower', group: 'west', x: 400, y: 1090 },
    { id: 'v_medbay', group: 'mid', x: 600, y: 640 },
    { id: 'v_elec', group: 'mid', x: 820, y: 1170 },
    { id: 'v_cafe', group: 'center', x: 1500, y: 130 },
    { id: 'v_admin', group: 'center', x: 1710, y: 880 },
    { id: 'v_weapons', group: 'east', x: 1900, y: 380 },
    { id: 'v_nav', group: 'east', x: 2290, y: 650 },
    { id: 'v_shields', group: 'east', x: 1890, y: 1110 },
  ];

  function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }
  function pointWalkable(x, y) {
    for (let i = 0; i < WALKABLE.length; i++) if (inRect(x, y, WALKABLE[i])) return true;
    return false;
  }
  function canStand(x, y) {
    return (
      pointWalkable(x - BOX.hw, y - BOX.top) &&
      pointWalkable(x + BOX.hw, y - BOX.top) &&
      pointWalkable(x - BOX.hw, y + BOX.bottom) &&
      pointWalkable(x + BOX.hw, y + BOX.bottom)
    );
  }
  function moveWithCollision(x, y, dx, dy) {
    if (canStand(x + dx, y)) x += dx;
    if (canStand(x, y + dy)) y += dy;
    return { x, y };
  }
  function clampWorld(x, y) {
    return {
      x: Math.max(0, Math.min(WORLD.w, x)),
      y: Math.max(0, Math.min(WORLD.h, y)),
    };
  }
  function spawnPoint(i, n) {
    const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: EMERGENCY.x + Math.cos(a) * 150, y: EMERGENCY.y + 10 + Math.sin(a) * 130 };
  }
  function roomAt(x, y) {
    for (const r of ROOMS) if (inRect(x, y, r)) return r;
    return null;
  }

  return {
    WORLD, SPEED, BOX, ROOMS, HALLS, WALKABLE, TASKS, GAME_TASK_TYPES, EMERGENCY, LIGHTS_PANEL,
    REACTOR_PANELS, VENTS, canStand, moveWithCollision, clampWorld, spawnPoint, roomAt,
  };
});
