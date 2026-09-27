// Chat de los bots en las reuniones, generado con Claude Haiku 4.5.
// Sin ANTHROPIC_API_KEY los bots usan frases predefinidas.
const AnthropicSDK = require('@anthropic-ai/sdk');
const Anthropic = AnthropicSDK.default || AnthropicSDK;
const MAP = require('./shared/map');

const MODEL = 'claude-haiku-4-5';
const MAX_MSGS_PER_BOT = 4; // por reunión
const MEMORY_SIZE = 10;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 15000, maxRetries: 1 }) : null;
const enabled = () => !!client;

let io = null;
let colorName = (id) => id;
function init(opts) {
  io = opts.io;
  colorName = opts.colorName;
}

const roomName = (p) => {
  const r = MAP.roomAt(p.x, p.y);
  return r ? r.name : 'un pasillo';
};
const label = (p) => `${p.name} (${colorName(p.color)})`;
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- memoria de lo que ve cada bot ----------
function remember(bot, text) {
  bot.ai.memory = bot.ai.memory || [];
  if (bot.ai.memory[bot.ai.memory.length - 1] === text) return;
  bot.ai.memory.push(text);
  if (bot.ai.memory.length > MEMORY_SIZE) bot.ai.memory.shift();
}

function observe(room, bot, now) {
  if (!bot.alive) return;
  if (now - (bot.ai.lastObs || 0) < 3000) return;
  bot.ai.lastObs = now;
  const seen = [...room.players.values()].filter(
    (p) => p !== bot && p.alive && !p.inVent && Math.hypot(p.x - bot.x, p.y - bot.y) < 330
  );
  const where = roomName(bot);
  remember(bot, seen.length ? `En ${where} vi a ${seen.map(label).join(', ')}` : `Estuve en ${where}, solo`);
}

function rememberKill(bot, victim) {
  remember(bot, `(SECRETO) Maté a ${label(victim)} en ${roomName(victim)}`);
}
function rememberTask(bot, taskName) {
  remember(bot, `Hice la tarea "${taskName}" en ${roomName(bot)}`);
}

// ---------- reuniones ----------
function onMeetingStart(room, caller, body) {
  const m = room.meeting;
  m.chat = [];
  m.context = body
    ? `${label(caller)} encontró el cuerpo de ${colorName(body.color)} en ${body.roomName} y convocó la reunión.`
    : `${label(caller)} pulsó el botón de emergencia.`;
  const bots = aliveBots(room);
  bots.forEach((b, i) => {
    b.ai.msgs = 0;
    b.ai.suspect = null;
    // cada bot habla por primera vez en un momento distinto
    schedule(room, b, 2500 + i * 1800 + Math.random() * 2500);
  });
}

function onHumanChat(room, player, text) {
  const m = room.meeting;
  if (!m || !m.chat) return;
  m.chat.push({ name: player.name, color: colorName(player.color), text });
  // si le nombran, contesta ese bot; si no, uno al azar (a veces)
  const bots = aliveBots(room).filter((b) => b.ai.msgs < MAX_MSGS_PER_BOT && !b.ai.pending);
  if (!bots.length) return;
  const lower = text.toLowerCase();
  const named = bots.find((b) => lower.includes(b.name.toLowerCase()) || lower.includes(colorName(b.color).toLowerCase()));
  if (named) schedule(room, named, 1200 + Math.random() * 1500);
  else if (Math.random() < 0.7) schedule(room, rand(bots), 1500 + Math.random() * 2500);
}

const aliveBots = (room) => [...room.players.values()].filter((p) => p.isBot && p.alive);

function schedule(room, bot, delay) {
  const meetingId = room.meeting.id;
  bot.ai.pending = true;
  setTimeout(() => speak(room, bot, meetingId).catch(() => {}).finally(() => (bot.ai.pending = false)), delay);
}

async function speak(room, bot, meetingId) {
  const stillValid = () => room.phase === 'meeting' && room.meeting && room.meeting.id === meetingId && bot.alive && room.players.has(bot.id);
  if (!stillValid() || bot.ai.msgs >= MAX_MSGS_PER_BOT) return;
  bot.ai.msgs++;

  const reply = client ? await askClaude(room, bot).catch(warnOnce) : null;
  const { message, suspect } = reply || fallback(room, bot);
  if (!stillValid()) return;

  const target = suspect && findPlayer(room, suspect);
  if (target && target !== bot && target.alive) bot.ai.suspect = target.id;
  if (!message) return;

  room.meeting.chat.push({ name: bot.name, color: colorName(bot.color), text: message });
  io.to(room.code).emit('chat', { name: bot.name, color: bot.color, text: message, dead: false });

  // de vez en cuando otro bot reacciona
  const others = aliveBots(room).filter((b) => b !== bot && b.ai.msgs < MAX_MSGS_PER_BOT && !b.ai.pending);
  if (others.length && Math.random() < 0.45) schedule(room, rand(others), 2000 + Math.random() * 3000);
}

function findPlayer(room, text) {
  const t = String(text).toLowerCase().trim();
  if (!t || t === 'null' || t === 'nadie') return null;
  return [...room.players.values()].find(
    (p) => t.includes(p.name.toLowerCase()) || t.includes(colorName(p.color).toLowerCase())
  );
}

function systemPrompt(room, bot) {
  const others = [...room.players.values()].filter((p) => p !== bot);
  const base = `Eres ${label(bot)}, jugando a Among Us. Estás en una reunión escribiendo en el chat del juego.
Escribe como un jugador real en un chat de videojuego: español de España informal, UNA sola frase corta por mensaje (máximo 18 palabras, como alguien que teclea rápido), a veces sin tildes ni mayúsculas. Nada de emojis salvo alguno suelto.
Escribe directamente el mensaje que verían los demás, hablándoles a ellos: nunca narres ni describas lo que vas a decir. Tú eres ${bot.name}: habla de ti en primera persona y nunca te nombres. Nunca digas que eres una IA ni un bot. No repitas lo que ya dijiste.`;
  if (bot.role === 'impostor') {
    const mates = others.filter((p) => p.role === 'impostor').map(label);
    return `${base}
Eres EL IMPOSTOR en secreto${mates.length ? ` (tu compañero impostor: ${mates.join(', ')}; no le acuses)` : ''}. Tus recuerdos marcados como SECRETO nunca los reveles.
Miente con naturalidad: inventa una coartada creíble (una sala y una tarea), echa sospechas sobre otro jugador vivo cuando encaje y defiéndete si te acusan.`;
  }
  return `${base}
Eres tripulante. Quieres descubrir al impostor usando lo que viste de verdad. Si no viste nada útil, dilo o pregunta a los demás. Si te acusan, defiéndete con lo que hiciste.`;
}

function userPrompt(room, bot) {
  const m = room.meeting;
  const all = [...room.players.values()];
  const alive = all.filter((p) => p.alive).map(label).join(', ');
  const dead = all.filter((p) => !p.alive).map(label).join(', ') || 'nadie';
  const memory = (bot.ai.memory || []).join('\n') || '(no recuerdas nada destacable)';
  const chat = m.chat.length ? m.chat.map((c) => `${c.name === bot.name ? 'TÚ' : `${c.name} (${c.color})`}: ${c.text}`).join('\n') : '(nadie ha escrito todavía)';
  return `Qué ha pasado: ${m.context}
Vivos: ${alive}
Muertos: ${dead}

Lo que recuerdas de la ronda (de más antiguo a más reciente):
${memory}

Chat de la reunión hasta ahora:
${chat}

Escribe tu siguiente mensaje en el chat. Responde SOLO con JSON, sin nada más:
{"mensaje": "<tu mensaje, o cadena vacía si prefieres callar>", "sospechoso": "<nombre del jugador vivo del que sospechas, o null>"}`;
}

async function askClaude(room, bot) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: systemPrompt(room, bot),
    messages: [{ role: 'user', content: userPrompt(room, bot) }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) return { message: clean(text), suspect: null };
  try {
    const data = JSON.parse(json[0]);
    return { message: clean(data.mensaje), suspect: data.sospechoso || null };
  } catch (_) {
    return null;
  }
}

// Avisa en consola una vez por tipo de error (clave mala, sin saldo...) y usa frases predefinidas
const warned = new Set();
function warnOnce(err) {
  const kind = err instanceof Anthropic.AuthenticationError ? 'clave de API no válida'
    : err instanceof Anthropic.PermissionDeniedError ? 'la clave no tiene permiso'
    : err instanceof Anthropic.RateLimitError ? 'límite de peticiones alcanzado'
    : err instanceof Anthropic.APIError ? `error de la API (${err.status})`
    : 'error de conexión';
  if (!warned.has(kind)) {
    warned.add(kind);
    console.warn(`[chat bots] ${kind}: se usan frases predefinidas. ${err.message || ''}`);
  }
  return null;
}

// Recorta mensajes largos por el último espacio para no cortar palabras
const clean = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 150) return t;
  const cut = t.slice(0, 150);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:]$/, '') + '...';
};

// ---------- frases sin IA ----------
function fallback(room, bot) {
  const others = [...room.players.values()].filter((p) => p !== bot && p.alive && !(bot.role === 'impostor' && p.role === 'impostor'));
  const sus = others.length ? rand(others) : null;
  const last = (bot.ai.memory || []).filter((x) => !x.startsWith('(SECRETO)')).pop();
  const where = rand(MAP.ROOMS).name.toLowerCase();
  const lines = [
    last ? last.toLowerCase() : `yo estaba en ${where}`,
    'no vi nada raro la verdad',
    sus ? `${sus.name.toLowerCase()} estaba muy raro` : 'no se quien es',
    sus ? `donde estabas ${sus.name.toLowerCase()}?` : 'alguien vio algo?',
    'skip si no hay pruebas',
    `yo estaba haciendo tareas en ${where}`,
  ];
  return { message: rand(lines), suspect: Math.random() < 0.5 && sus ? sus.name : null };
}

module.exports = { init, enabled, observe, rememberKill, rememberTask, onMeetingStart, onHumanChat, MODEL };
