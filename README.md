# 🐉 Taberna del Dragón — D&D con DM Automático

Juego de rol D&D 5e para 1 o más jugadores con Dungeon Master generado por IA (Claude).
Funciona en navegador, desktop (Windows/Linux/Steam Deck) y móvil (Android/iOS).

## Características

- **DM con IA** — Claude narra en español con reglas D&D 5e, reacciona a cualquier acción libre
- **Historias con arco narrativo** — 4 actos: Introducción → Desarrollo → Clímax → Epílogo con final real
- **Sugerencias de acción** — El DM propone 4 opciones contextuales tras cada turno
- **Multijugador** — Sala compartida con código de 5 letras, tiempo real vía WebSockets
- **Creación de personaje** — 8 razas × 8 clases, tirada 4d6 de atributos
- **Dados completos** — d4 a d20 con modificadores automáticos de stat
- **HP y combate** — Vida por clase+CON, tiradas de salvación con DC, daño por fallos
- **Inventario y oro** — Equipo inicial visible por jugador
- **Selector de modelo** — Elige el modelo del DM desde Configuración según calidad/coste: Opus 4.8 (mejor narrativa), Sonnet 4.6 (equilibrado) o Haiku 4.5 (más rápido y barato)

---

## Requisito: Clave API de Anthropic

El juego usa Claude (IA de Anthropic) como DM. Necesitas una clave API gratuita:

1. Regístrate en **https://console.anthropic.com**
2. Ve a "API Keys" y crea una clave
3. Anthropic da créditos gratuitos al registrarse (~$5 USD, suficiente para muchas sesiones)
4. Una sesión de juego suele costar menos de $0.01

---

## Plataformas

### 🌐 Web — Jugar ahora en el navegador

Si hay un servidor desplegado, abre la URL directamente. Si no, usa la opción local.

---

### 💻 Local (cualquier PC con Node.js)

La forma más sencilla para jugar en casa.

```bash
git clone https://github.com/lord-jorx/fluffy-train.git
cd fluffy-train
npm install
```

Crea el archivo `.env` con tu clave:
```bash
echo "ANTHROPIC_API_KEY=sk-ant-TU_CLAVE_AQUI" > .env
```

Inicia el servidor:
```bash
npm start
```

Abre **http://localhost:3000** en tu navegador. Para multijugador en la misma red, usa la IP local (ej: `http://192.168.1.X:3000`).

---

### 🖥️ Windows — App de escritorio (.exe)

Instala Node.js desde https://nodejs.org si no lo tienes, luego:

```bash
git clone https://github.com/lord-jorx/fluffy-train.git
cd fluffy-train
npm install
npm run build:win
```

El instalador `.exe` aparece en la carpeta `dist/`. Ejecútalo para instalar. Al abrir la app la primera vez, se pedirá la clave API (se guarda localmente).

---

### 🐧 Linux — AppImage

```bash
git clone https://github.com/lord-jorx/fluffy-train.git
cd fluffy-train
npm install
npm run build:linux
```

El archivo `.AppImage` aparece en `dist/`. Hazlo ejecutable:

```bash
chmod +x dist/*.AppImage
./dist/Taberna*.AppImage
```

---

### 🎮 Steam Deck

El `.AppImage` de Linux funciona en Steam Deck:

1. Copia el `.AppImage` al Steam Deck (vía USB, Samba o `scp`)
2. En modo desktop, dale permisos de ejecución
3. En Steam: **Añadir juego no-Steam** → selecciona el `.AppImage`
4. Opcional: en Propiedades del juego, activa compatibilidad con Proton (normalmente no necesario)
5. Al abrir por primera vez, entra en la clave API (teclado virtual funciona)

---

### 🤖 Android

Requiere Android Studio instalado.

```bash
npm install
npx cap add android
npx cap sync
npx cap open android
```

En Android Studio: Build → Generate Signed APK.
La app pedirá la clave API al arrancar por primera vez.

---

### 🍎 iPhone / iPad

Requiere Mac con Xcode y cuenta de desarrollador Apple (para instalar en dispositivo físico).

```bash
npm install
npx cap add ios
npx cap sync
npx cap open ios
```

En Xcode: selecciona tu dispositivo y pulsa Run.

---

## Para desarrollo

```bash
# Servidor web
npm start

# App desktop en modo desarrollo (con DevTools)
npm run electron:dev
```

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Backend | Node.js + Express + Socket.io |
| IA / DM | Claude (Opus 4.8 / Sonnet 4.6 / Haiku 4.5, seleccionable) |
| Frontend | HTML5 + CSS3 + JS vanilla |
| Desktop | Electron + electron-builder |
| Móvil | Capacitor |
