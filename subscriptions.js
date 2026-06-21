// Gestión de derechos (entitlements): prueba gratis + suscripción de Google Play.
// Persistencia simple en JSON. En producción real conviene una base de datos.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'entitlements.json');

const TRIAL_ACTIONS = parseInt(process.env.TRIAL_ACTIONS || '15', 10);
const PLAY_PACKAGE = process.env.PLAY_PACKAGE_NAME || 'com.tabernadel.dragon';
const SUB_PRODUCT_ID = process.env.SUB_PRODUCT_ID || 'taberna_premium_monthly';
const SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
const DEV_BILLING = process.env.DEV_BILLING === 'true';

let store = {};   // { userId: { trialUsed, sub: { active, expiry, productId, token } } }
let saveTimer = null;

function load() {
  try {
    store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {
    store = {};
  }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(store), 'utf8');
    } catch (e) {
      console.error('No se pudo guardar entitlements:', e.message);
    }
  }, 500);
}

function getUser(userId) {
  if (!store[userId]) store[userId] = { trialUsed: 0, sub: null };
  return store[userId];
}

function subActive(user) {
  if (!user.sub || !user.sub.active) return false;
  if (user.sub.expiry && Date.now() > user.sub.expiry) {
    user.sub.active = false;
    saveSoon();
    return false;
  }
  return true;
}

// Estado para el cliente: ¿puede jugar?, ¿cuánta prueba le queda?, ¿está suscrito?
function status(userId) {
  if (!userId) return { allowed: false, subscribed: false, trialRemaining: 0, trialTotal: TRIAL_ACTIONS };
  const user = getUser(userId);
  const subscribed = subActive(user);
  const trialRemaining = Math.max(0, TRIAL_ACTIONS - user.trialUsed);
  return {
    allowed: subscribed || trialRemaining > 0,
    subscribed,
    trialRemaining,
    trialTotal: TRIAL_ACTIONS,
    expiry: subscribed ? user.sub.expiry : null
  };
}

// Consume una acción de prueba (solo si no está suscrito). Devuelve el estado nuevo.
function consumeTrial(userId) {
  const user = getUser(userId);
  if (!subActive(user)) {
    user.trialUsed += 1;
    saveSoon();
  }
  return status(userId);
}

// Verifica un token de compra contra la API de Google Play y guarda la suscripción.
async function verifyPurchase(userId, purchaseToken, productId) {
  if (!userId || !purchaseToken) throw new Error('Faltan datos de la compra');
  const pid = productId || SUB_PRODUCT_ID;

  // Modo desarrollo: concede 30 días sin contactar con Google (para probar el flujo).
  if (DEV_BILLING) {
    const user = getUser(userId);
    user.sub = { active: true, expiry: Date.now() + 30 * 86400000, productId: pid, token: purchaseToken, dev: true };
    saveSoon();
    return status(userId);
  }

  if (!SERVICE_ACCOUNT) throw new Error('Verificación de Google Play no configurada (GOOGLE_SERVICE_ACCOUNT_JSON)');

  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    keyFile: SERVICE_ACCOUNT,
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Play rechazó la verificación (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  // subscriptionsv2: estado + lineItems con expiryTime
  const state = data.subscriptionState; // SUBSCRIPTION_STATE_ACTIVE, _IN_GRACE_PERIOD, etc.
  const okStates = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'];
  const isActive = okStates.includes(state);
  let expiry = null;
  if (data.lineItems && data.lineItems.length) {
    const exp = data.lineItems.map(li => li.expiryTime).filter(Boolean).sort().pop();
    if (exp) expiry = new Date(exp).getTime();
  }

  const user = getUser(userId);
  user.sub = { active: isActive, expiry, productId: pid, token: purchaseToken, state };
  saveSoon();
  return status(userId);
}

load();

module.exports = {
  status,
  consumeTrial,
  verifyPurchase,
  TRIAL_ACTIONS,
  SUB_PRODUCT_ID,
  config: { hasBilling: DEV_BILLING || !!SERVICE_ACCOUNT, devBilling: DEV_BILLING }
};
