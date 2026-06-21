const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const rooms = new Map();

const RACES = ['Humano', 'Elfo', 'Enano', 'Mediano', 'Gnomo', 'Semiorco', 'Tiefling', 'Draconiano'];
const CLASSES = ['Guerrero', 'Mago', 'Pícaro', 'Clérigo', 'Bárbaro', 'Bardo', 'Paladín', 'Explorador'];
const HIT_DICE = { Guerrero:10, Bárbaro:12, Paladín:10, Explorador:8, Clérigo:8, Bardo:8, Pícaro:8, Mago:6 };

const ACT_GUIDES = {
  1: 'ACTO 1 – INTRODUCCIÓN: Establece la taberna y el mundo. Presenta NPCs interesantes. Introduce el gancho de la aventura (misterio, misión, amenaza). Cuando la aventura esté en marcha, incluye [ACTO:2].',
  2: 'ACTO 2 – DESARROLLO: Los héroes exploran, luchan, descubren secretos y superan pruebas. Crea giros, revela el antagonista o el peligro mayor. Cuando llegue la confrontación final, incluye [ACTO:3].',
  3: 'ACTO 3 – CLÍMAX: La batalla o decisión definitiva. Máxima tensión. El destino está en juego. Tras el resultado del clímax, incluye [ACTO:4].',
  4: 'ACTO 4 – EPÍLOGO: Muestra las consecuencias de las acciones de los héroes. Cierra todas las tramas. Un final emocionante y memorable. Al terminar el epílogo, incluye [FIN_HISTORIA:resumen breve de 1 frase].'
};

function rollDice(sides) { return Math.floor(Math.random() * sides) + 1; }

function rollStats() {
  const r4d6 = () => { const d=[rollDice(6),rollDice(6),rollDice(6),rollDice(6)]; return d.reduce((a,b)=>a+b,0)-Math.min(...d); };
  return { FUE:r4d6(), DES:r4d6(), CON:r4d6(), INT:r4d6(), SAB:r4d6(), CAR:r4d6() };
}

function calcHP(cls, con) { return (HIT_DICE[cls]||8) + Math.floor((con-10)/2); }

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: [],
      history: [],
      state: { act:1, turn:0, storyTitle:null, storySummary:null, isEnded:false, keyEvents:[] }
    });
  }
  return rooms.get(roomId);
}

function buildSystemPrompt(room) {
  const pList = room.players.map(p =>
    `  • ${p.name} (${p.race} ${p.class} | HP ${p.hp}/${p.maxHp} | Oro:${p.gold}mo | ${['FUE','DES','CON','INT','SAB','CAR'].map(s=>`${s}${p.stats[s]}`).join(' ')} | Inv: ${p.inventory.join(', ')})`
  ).join('\n');

  return `Eres un Dungeon Master épico de D&D 5e. Narras en español con viveza, drama y humor cuando corresponde.

JUGADORES:
${pList}

ESTADO: Acto ${room.state.act}/4 | Turno ${room.state.turn}
HISTORIA: "${room.state.storyTitle || 'Por revelar'}"
EVENTOS RECIENTES: ${room.state.keyEvents.slice(-4).join(' → ') || '—'}

${ACT_GUIDES[room.state.act]}

━━━ FORMATO OBLIGATORIO ━━━
Responde con EXACTAMENTE esta estructura (sin saltarte nada):

[NARRATIVA]
2-4 párrafos de narración inmersiva. Primera vez en la historia: incluye [TITULO:Nombre épico de la aventura].
Cuando avanzas de acto incluye la etiqueta [ACTO:N] al final del párrafo donde ocurra el cambio.
En el epílogo final incluye [FIN_HISTORIA:una frase resumen].
Si la acción requiere tirada: [ROLL:STAT:DC] (STAT = FUE/DES/CON/INT/SAB/CAR, DC = dificultad).
[/NARRATIVA]

[SUGERENCIAS]
Opción 1 concreta y obvia|||Opción 2 táctica o exploratoria|||Opción 3 social o diplomática|||Opción 4 inesperada o creativa
[/SUGERENCIAS]

Las sugerencias DEBEN ser específicas al momento actual, no genéricas.`;
}

function parseResponse(raw) {
  let text = raw;
  let suggestions = [], roll = null, actChange = null, isEnding = false, title = null, summary = null;

  // Extract narrativa block
  const narMatch = text.match(/\[NARRATIVA\]([\s\S]*?)\[\/NARRATIVA\]/);
  if (narMatch) text = narMatch[1].trim();

  // Extract suggestions
  const sugMatch = text.match(/\[SUGERENCIAS\]([\s\S]*?)\[\/SUGERENCIAS\]/);
  if (sugMatch) {
    suggestions = sugMatch[1].split('|||').map(s=>s.trim()).filter(Boolean).slice(0,4);
    text = text.replace(sugMatch[0],'').trim();
  }
  // Fallback: suggestions after narrativa
  const sugMatch2 = raw.match(/\[SUGERENCIAS\]([\s\S]*?)\[\/SUGERENCIAS\]/);
  if (!suggestions.length && sugMatch2) {
    suggestions = sugMatch2[1].split('|||').map(s=>s.trim()).filter(Boolean).slice(0,4);
  }

  // Title
  const tMatch = text.match(/\[TITULO:([^\]]+)\]/);
  if (tMatch) { title = tMatch[1].trim(); text = text.replace(tMatch[0],'').trim(); }

  // Act change
  const aMatch = text.match(/\[ACTO:(\d)\]/);
  if (aMatch) { actChange = parseInt(aMatch[1]); text = text.replace(aMatch[0],'').trim(); }

  // Ending
  const fMatch = text.match(/\[FIN_HISTORIA:?([^\]]*)\]/);
  if (fMatch) { isEnding = true; summary = fMatch[1].trim() || null; text = text.replace(fMatch[0],'').trim(); }

  // Roll
  const rMatch = text.match(/\[ROLL:(\w+):(\d+)\]/);
  if (rMatch) { roll = { stat:rMatch[1], dc:parseInt(rMatch[2]) }; text = text.replace(rMatch[0],'').trim(); }

  return { text: text.trim(), suggestions, roll, actChange, isEnding, title, summary };
}

function getClient(apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('NO_API_KEY'), { code:'NO_API_KEY' });
  return new Anthropic({ apiKey: key });
}

async function callDM(room, userAction, playerName, apiKey) {
  const client = getClient(apiKey);
  const msgs = [...room.history.slice(-24), { role:'user', content:`${playerName}: ${userAction}` }];
  const res = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 750,
    system: buildSystemPrompt(room),
    messages: msgs
  });
  const raw = res.content[0].text;
  room.history.push({ role:'user', content:`${playerName}: ${userAction}` });
  room.history.push({ role:'assistant', content: raw });
  return raw;
}

// ---- Middleware ----
io.use((socket, next) => {
  if (socket.handshake.auth?.apiKey) socket.apiKey = socket.handshake.auth.apiKey;
  next();
});

// ---- Socket handlers ----
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayer = null;

  socket.on('create_room', (cb) => {
    const roomId = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0,5);
    getRoom(roomId);
    cb({ roomId });
  });

  socket.on('join_room', ({ roomId, character }, cb) => {
    const rid = (roomId||'').toUpperCase().trim();
    if (!rid) return cb({ error: 'Código de sala inválido' });
    const room = getRoom(rid);

    const player = {
      id: socket.id,
      name: character.name,
      race: character.race,
      class: character.class,
      stats: character.stats,
      maxHp: calcHP(character.class, character.stats.CON),
      hp: calcHP(character.class, character.stats.CON),
      inventory: ['Mochila', 'Antorcha x3', 'Ración x5'],
      gold: rollDice(6) * 10
    };

    room.players.push(player);
    currentRoom = rid;
    currentPlayer = player;
    socket.join(rid);
    cb({ success:true, player, roomId:rid });

    const isFirst = room.players.length === 1;
    io.to(rid).emit('dm_message', {
      text: isFirst
        ? `**${player.name}** empuja la puerta de La Taberna del Dragón. El calor del fuego y el aroma a cerveza te envuelven. Un enano corpulento tras la barra te mira con ojos astutos. En la pared hay un tablón de corcho lleno de pergaminos con misiones y recompensas. Una anciana en el rincón parece estudiar algo muy interesante en su pócima...`
        : `**${player.name}** entra a la taberna y se une al grupo. Los aventureros se miran con curiosidad.`,
      type: 'narrative',
      suggestions: isFirst
        ? ['Pedir una jarra de cerveza al tabernero', 'Examinar el tablón de anuncios', 'Acercarse a la anciana misteriosa', 'Buscar un lugar discreto para observar el ambiente']
        : ['Saludar a tus nuevos compañeros', 'Pedir que te pongan al día de la situación', 'Ordenar algo de beber y escuchar', 'Proponer un brindis antes de comenzar'],
      players: room.players
    });
  });

  socket.on('player_action', async ({ action }) => {
    if (!currentRoom || !currentPlayer) return;
    const room = getRoom(currentRoom);

    if (room.state.isEnded) {
      socket.emit('dm_message', { text:'Esta historia ha concluido. ¡Inicia una nueva aventura!', type:'system', suggestions:[] });
      return;
    }

    io.to(currentRoom).emit('player_message', { player: currentPlayer.name, text: action });
    io.to(currentRoom).emit('dm_thinking');

    try {
      const raw = await callDM(room, action, currentPlayer.name, socket.apiKey);
      const parsed = parseResponse(raw);

      // Update state
      if (parsed.title && !room.state.storyTitle) room.state.storyTitle = parsed.title;
      if (parsed.actChange && parsed.actChange > room.state.act) {
        room.state.act = parsed.actChange;
        room.state.keyEvents.push(`Acto ${parsed.actChange} comienza`);
      }
      if (parsed.isEnding) {
        room.state.isEnded = true;
        if (parsed.summary) room.state.storySummary = parsed.summary;
      }
      room.state.turn++;
      if (room.state.turn % 4 === 0) room.state.keyEvents.push(action.slice(0,50));

      // Process roll
      let rollResult = null;
      if (parsed.roll) {
        const { stat, dc } = parsed.roll;
        const die = rollDice(20);
        const mod = Math.floor(((currentPlayer.stats[stat]||10)-10)/2);
        const total = die + mod;
        const success = total >= dc;
        rollResult = { player:currentPlayer.name, stat, die, mod, total, dc, success };
        if (!success) {
          const dmg = rollDice(6);
          currentPlayer.hp = Math.max(0, currentPlayer.hp - dmg);
          rollResult.damage = dmg;
        }
      }

      io.to(currentRoom).emit('dm_message', {
        text: parsed.text,
        type: parsed.isEnding ? 'ending' : 'narrative',
        roll: rollResult,
        suggestions: parsed.suggestions,
        actChange: parsed.actChange,
        isEnding: parsed.isEnding,
        storyTitle: parsed.title,
        storySummary: room.state.storySummary,
        currentAct: room.state.act,
        storyTitleFull: room.state.storyTitle,
        players: room.players
      });

    } catch (err) {
      const isKey = err.code === 'NO_API_KEY' || err.status === 401;
      socket.emit('dm_message', {
        text: isKey
          ? '⚙️ Necesitas configurar tu clave API de Anthropic. Pulsa el botón de Configuración (⚙️) arriba a la derecha.'
          : `El Dungeon Master tartamudea... (${err.message}). Intenta de nuevo.`,
        type: 'error',
        suggestions: ['Intentar de nuevo', 'Abrir configuración', 'Hacer algo diferente']
      });
    }
  });

  socket.on('roll_dice', ({ sides }) => {
    if (!currentRoom || !currentPlayer) return;
    io.to(currentRoom).emit('dice_roll', { player:currentPlayer.name, sides, result:rollDice(sides) });
  });

  socket.on('request_state', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    socket.emit('room_state', { act: room.state.act, storyTitle: room.state.storyTitle, players: room.players });
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !currentPlayer) return;
    const room = getRoom(currentRoom);
    room.players = room.players.filter(p => p.id !== socket.id);
    io.to(currentRoom).emit('dm_message', {
      text:`**${currentPlayer.name}** se desvanece en la niebla.`,
      type:'system', suggestions:[], players: room.players
    });
  });
});

app.get('/api/races', (_, res) => res.json(RACES));
app.get('/api/classes', (_, res) => res.json(CLASSES));
app.get('/api/roll-stats', (_, res) => res.json(rollStats()));
app.get('/health', (_, res) => res.json({ ok:true }));

async function start(port) {
  const p = port || parseInt(process.env.PORT) || 3000;
  await new Promise((resolve, reject) => server.listen(p, resolve).on('error', reject));
  console.log(`🐉 Taberna del Dragón en http://localhost:${p}`);
  return p;
}

if (require.main === module) start();
module.exports = { app, server, start };
