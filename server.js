const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// rooms: { roomId: { players: [], history: [], state: {} } }
const rooms = new Map();

const RACES = ['Humano', 'Elfo', 'Enano', 'Mediano', 'Gnomo', 'Semiorco', 'Tiefling', 'Draconiano'];
const CLASSES = ['Guerrero', 'Mago', 'Pícaro', 'Clérigo', 'Bárbaro', 'Bardo', 'Paladín', 'Explorador'];

function rollDice(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function rollStats() {
  const roll4d6 = () => {
    const dice = [rollDice(6), rollDice(6), rollDice(6), rollDice(6)];
    return dice.reduce((a, b) => a + b, 0) - Math.min(...dice);
  };
  return {
    FUE: roll4d6(), DES: roll4d6(), CON: roll4d6(),
    INT: roll4d6(), SAB: roll4d6(), CAR: roll4d6()
  };
}

function calcHP(cls, con) {
  const hitDice = { Guerrero: 10, Bárbaro: 12, Paladín: 10, Explorador: 8, Clérigo: 8, Bardo: 8, Pícaro: 8, Mago: 6 };
  const hd = hitDice[cls] || 8;
  const mod = Math.floor((con - 10) / 2);
  return hd + mod;
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: [],
      history: [],
      state: { scene: 'tavern', turn: 0, combat: false }
    });
  }
  return rooms.get(roomId);
}

async function callDM(room, userAction, playerName) {
  const playerList = room.players
    .map(p => `- ${p.name} (${p.race} ${p.class}, HP: ${p.hp}/${p.maxHp}, Stats: FUE${p.stats.FUE} DES${p.stats.DES} CON${p.stats.CON} INT${p.stats.INT} SAB${p.stats.SAB} CAR${p.stats.CAR}, Inventario: ${p.inventory.join(', ') || 'vacío'})`)
    .join('\n');

  const systemPrompt = `Eres un Dungeon Master experto de D&D 5e que narra aventuras épicas en español.
Eres creativo, dramático y justo. Describes escenas con detalle vívido.

JUGADORES ACTUALES:
${playerList}

ESTADO DEL MUNDO: ${JSON.stringify(room.state)}

REGLAS:
- Cuando un jugador intenta algo que requiere habilidad, pide una tirada o decide el resultado según sus stats.
- Menciona tiradas de dados cuando sean relevantes (ej: "necesitas sacar 12+ en Destreza").
- Mantén la narrativa coherente con lo que ha pasado antes.
- Respuestas de 2-4 párrafos máximo, directas y emocionantes.
- Puedes añadir consecuencias para acciones peligrosas (daño, etc).
- Si hay combate, describe las acciones y resultados con detalle.
- Formato: narración pura, sin metaComentarios sobre ser IA.
- Cuando el resultado depende de dados, incluye al final: [ROLL:TIPO:DC] ejemplo [ROLL:DES:12] o [ROLL:FUE:15]`;

  const messages = [
    ...room.history.slice(-20),
    { role: 'user', content: `${playerName} hace: ${userAction}` }
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: systemPrompt,
    messages
  });

  const dmText = response.content[0].text;

  room.history.push({ role: 'user', content: `${playerName} hace: ${userAction}` });
  room.history.push({ role: 'assistant', content: dmText });

  return dmText;
}

function parseRollRequest(dmText) {
  const match = dmText.match(/\[ROLL:(\w+):(\d+)\]/);
  if (match) return { stat: match[1], dc: parseInt(match[2]) };
  return null;
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayer = null;

  socket.on('create_room', (cb) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    getRoom(roomId);
    cb({ roomId });
  });

  socket.on('join_room', ({ roomId, character }, cb) => {
    const room = getRoom(roomId.toUpperCase());
    if (!room) return cb({ error: 'Sala no encontrada' });

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
    player.hp = player.maxHp;

    room.players.push(player);
    currentRoom = roomId.toUpperCase();
    currentPlayer = player;
    socket.join(currentRoom);

    cb({ success: true, player, roomId: currentRoom });

    const joinMsg = room.players.length === 1
      ? `**${player.name}** entra a la taberna. El ambiente es cálido y huele a cerveza y madera quemada. El tabernero te hace un gesto con la cabeza.`
      : `**${player.name}** se une al grupo. Los aventureros se saludan con cautela.`;

    io.to(currentRoom).emit('dm_message', {
      text: joinMsg,
      type: 'narrative',
      players: room.players
    });
  });

  socket.on('player_action', async ({ action }) => {
    if (!currentRoom || !currentPlayer) return;
    const room = getRoom(currentRoom);

    io.to(currentRoom).emit('player_message', {
      player: currentPlayer.name,
      text: action
    });

    io.to(currentRoom).emit('dm_thinking');

    try {
      const dmResponse = await callDM(room, action, currentPlayer.name);
      const rollReq = parseRollRequest(dmResponse);
      const cleanText = dmResponse.replace(/\[ROLL:\w+:\d+\]/g, '').trim();

      if (rollReq) {
        const roll = rollDice(20);
        const statVal = currentPlayer.stats[rollReq.stat] || 10;
        const mod = Math.floor((statVal - 10) / 2);
        const total = roll + mod;
        const success = total >= rollReq.dc;

        io.to(currentRoom).emit('dm_message', {
          text: cleanText,
          type: 'narrative',
          roll: { player: currentPlayer.name, dice: 'd20', result: roll, mod, total, dc: rollReq.dc, stat: rollReq.stat, success },
          players: room.players
        });

        if (!success && currentPlayer.hp > 0) {
          const damage = rollDice(6);
          currentPlayer.hp = Math.max(0, currentPlayer.hp - damage);
          if (currentPlayer.hp === 0) {
            io.to(currentRoom).emit('dm_message', {
              text: `**${currentPlayer.name}** ha caído inconsciente con ${damage} de daño!`,
              type: 'danger',
              players: room.players
            });
          }
        }
      } else {
        io.to(currentRoom).emit('dm_message', {
          text: cleanText,
          type: 'narrative',
          players: room.players
        });
      }

      room.state.turn++;
    } catch (err) {
      console.error('DM error:', err);
      io.to(currentRoom).emit('dm_message', {
        text: 'El Dungeon Master parece distraído... intenta de nuevo.',
        type: 'error'
      });
    }
  });

  socket.on('roll_dice', ({ sides }) => {
    if (!currentRoom || !currentPlayer) return;
    const result = rollDice(sides || 20);
    io.to(currentRoom).emit('dice_roll', {
      player: currentPlayer.name,
      sides: sides || 20,
      result
    });
  });

  socket.on('disconnect', () => {
    if (currentRoom && currentPlayer) {
      const room = getRoom(currentRoom);
      room.players = room.players.filter(p => p.id !== socket.id);
      io.to(currentRoom).emit('dm_message', {
        text: `**${currentPlayer.name}** abandonó la aventura.`,
        type: 'system',
        players: room.players
      });
    }
  });
});

app.get('/api/races', (_, res) => res.json(RACES));
app.get('/api/classes', (_, res) => res.json(CLASSES));
app.get('/api/roll-stats', (_, res) => res.json(rollStats()));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DnD server running on port ${PORT}`));
