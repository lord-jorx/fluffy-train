# 🐉 Taberna del Dragón — D&D con DM Automático

Juego de rol tipo D&D 5e para 1 o más jugadores con Dungeon Master generado por IA (Claude).

## Características

- **DM Automático** — Claude narra la historia, gestiona el mundo y reacciona a tus acciones
- **Multijugador** — Comparte el código de sala con amigos para jugar juntos en tiempo real
- **Creación de personaje** — Elige raza, clase y tira atributos con 4d6
- **Sistema de dados** — Tiradas d4–d20 con modificadores automáticos
- **HP y combate** — Sistema de puntos de vida con consecuencias reales
- **Inventario y oro** — Cada personaje lleva su equipo

## Instalación

```bash
npm install
cp .env.example .env
# Añade tu ANTHROPIC_API_KEY en .env
npm start
```

Abre `http://localhost:3000`

## Variables de entorno

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | API key de Anthropic (obligatoria) |
| `PORT` | Puerto del servidor (default: 3000) |

## Cómo jugar

1. Pulsa **Nueva Aventura** para crear una sala (o **Unirse** con un código)
2. Crea tu personaje: elige nombre, raza, clase y tira los atributos
3. Escribe lo que hace tu personaje en el campo de texto
4. El DM responde con narrativa, pide tiradas si es necesario y lleva la historia
5. Comparte el código de sala (5 letras) para que otros se unan

## Stack técnico

- **Backend**: Node.js + Express + Socket.io
- **IA**: Claude claude-sonnet-4-6 (Anthropic)
- **Frontend**: HTML/CSS/JS vanilla (sin build step)
