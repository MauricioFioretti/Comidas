// ================== CONFIG ==================
// ✅ Usamos Google Sheets API (sin Apps Script) => NO CORS
const SPREADSHEET_ID = "12-sy6cjXen-EsTZhdmDHIflKzMigWUjRfrM1Z7aAarc";
const SHEET_NAME = "comidas"; // la pestaña/hoja

// ================== CONFIG OAUTH (GIS) ==================
// Client ID OAuth de COMIDAS (el que me pasaste)
const OAUTH_CLIENT_ID = "766859524501-tbgvh66sh1b4uqku9ji987a4ce1ofl47.apps.googleusercontent.com";

// IMPORTANTE (igual que tu Lista Compras):
// Pedimos un scope extra para que en "External + Testing" se respete la lista de test users.
const OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  // ✅ leer/escribir en la planilla
  "https://www.googleapis.com/auth/spreadsheets"
].join(" ");


// LocalStorage OAuth
const LS_OAUTH = "comidas_oauth_token_v1";        // {access_token, expires_at}
const LS_OAUTH_EMAIL = "comidas_oauth_email_v1";  // email para hint

// Tipos
const TIPO_SALUDABLE = "saludable";
const TIPO_CHATARRA  = "chatarra";
const TIPO_MERIENDA  = "merienda";

// =====================
// OAuth state
// =====================
let tokenClient = null;
let oauthAccessToken = "";
let oauthExpiresAt = 0;

function isTokenValid() {
  return !!oauthAccessToken && Date.now() < (oauthExpiresAt - 10_000);
}

function loadStoredOAuth() {
  try {
    const raw = localStorage.getItem(LS_OAUTH);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.access_token || !parsed?.expires_at) return null;
    return { access_token: parsed.access_token, expires_at: Number(parsed.expires_at) };
  } catch {
    return null;
  }
}

function saveStoredOAuth(access_token, expires_at) {
  try { localStorage.setItem(LS_OAUTH, JSON.stringify({ access_token, expires_at })); } catch {}
}
function clearStoredOAuth() {
  try { localStorage.removeItem(LS_OAUTH); } catch {}
}

function loadStoredOAuthEmail() {
  try {
    return String(localStorage.getItem(LS_OAUTH_EMAIL) || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function saveStoredOAuthEmail(email) {
  try { localStorage.setItem(LS_OAUTH_EMAIL, (email || "").toString()); } catch {}
}
function clearStoredOAuthEmail() {
  try { localStorage.removeItem(LS_OAUTH_EMAIL); } catch {}
}

// =====================
// DEBUG: forzar expiración de token (para test)
// =====================
// Uso en consola:
//   expireTokenMemoryOnly();                 // expira sólo en RAM
//   expireTokenStorageOnly();                // expira sólo en localStorage
//   expireTokenEverywhere();                 // expira RAM + localStorage
//   testAutoReconnect();                     // intenta reconectar sin popup y recargar lista
//
// Nota: esto NO revoca el token en Google, sólo hace que tu app lo trate como vencido.

function expireTokenMemoryOnly() {
  oauthAccessToken = "";
  oauthExpiresAt = 0;
  console.warn("[DEBUG] Token expirado en MEMORIA (RAM).");
}

function expireTokenStorageOnly() {
  try {
    const raw = localStorage.getItem(LS_OAUTH);
    const parsed = raw ? JSON.parse(raw) : null;

    // Si existe, lo marcamos como vencido (expires_at en el pasado)
    if (parsed?.access_token) {
      parsed.expires_at = Date.now() - 60_000;
      localStorage.setItem(LS_OAUTH, JSON.stringify(parsed));
      console.warn("[DEBUG] Token marcado como VENCIDO en localStorage (expires_at pasado).");
    } else {
      console.warn("[DEBUG] No había token en localStorage para expirar.");
    }
  } catch (e) {
    console.warn("[DEBUG] No se pudo tocar localStorage:", e);
  }
}

function expireTokenEverywhere() {
  oauthAccessToken = "";
  oauthExpiresAt = 0;

  try {
    const raw = localStorage.getItem(LS_OAUTH);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.access_token) {
      parsed.expires_at = Date.now() - 60_000;
      localStorage.setItem(LS_OAUTH, JSON.stringify(parsed));
    }
  } catch {}

  console.warn("[DEBUG] Token expirado en MEMORIA + localStorage.");

  // 🔁 SOLO PARA TEST: intento reconexión silenciosa inmediata
  setTimeout(() => {
    console.warn("[DEBUG] Intentando auto-reconnect inmediato…");
    runConnectFlow({ interactive: false, prompt: "" });
  }, 0);
}

async function testAutoReconnect() {
  console.warn("[DEBUG] testAutoReconnect(): intentando runConnectFlow(interactive:false, prompt:'')...");
  try {
    const res = await runConnectFlow({ interactive: false, prompt: "" });
    console.warn("[DEBUG] testAutoReconnect() resultado:", res);

    // para ver estado rápido
    console.warn("[DEBUG] isTokenValid():", isTokenValid(), "expiresAt(ms):", oauthExpiresAt);
    return res;
  } catch (e) {
    console.warn("[DEBUG] testAutoReconnect() error:", e);
    throw e;
  }
}

// opcional: exponer en window para que sea fácil en consola aunque esté en módulo/closure
try {
  window.expireTokenMemoryOnly = expireTokenMemoryOnly;
  window.expireTokenStorageOnly = expireTokenStorageOnly;
  window.expireTokenEverywhere = expireTokenEverywhere;
  window.testAutoReconnect = testAutoReconnect;
} catch {}

async function fetchUserEmailFromToken(accessToken) {
  const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error("No se pudo obtener userinfo");
  const data = await r.json();
  return (data?.email || "").toString();
}

function initOAuth() {
  if (!window.google?.accounts?.oauth2?.initTokenClient) {
    throw new Error("GIS no está cargado (falta gsi/client en HTML)");
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPES,
    include_granted_scopes: true,
    use_fedcm_for_prompt: true,
    callback: () => {}
  });
}

// prompt: "" (silent), "consent", "select_account"
function requestAccessToken({ prompt, hint } = {}) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error("OAuth no inicializado"));

    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("popup_timeout_or_closed"));
    }, 45_000);

    tokenClient.callback = (resp) => {
      if (done) return;
      done = true;
      clearTimeout(timer);

      if (!resp || resp.error) {
        const err = String(resp?.error || "oauth_error");
        const sub = String(resp?.error_subtype || "");
        const msg = (err + (sub ? `:${sub}` : "")).toLowerCase();

        const e = new Error(err);
        e.isCanceled =
          msg.includes("popup_closed") ||
          msg.includes("popup_closed_by_user") ||
          msg.includes("access_denied") ||
          msg.includes("user_cancel") ||
          msg.includes("interaction_required");
        return reject(e);
      }

      const accessToken = resp.access_token;
      const expiresIn = Number(resp.expires_in || 3600);
      const expiresAt = Date.now() + (expiresIn * 1000);

      oauthAccessToken = accessToken;
      oauthExpiresAt = expiresAt;
      saveStoredOAuth(accessToken, expiresAt);

      resolve({ access_token: accessToken, expires_at: expiresAt });
    };

    const req = {};
    if (prompt !== undefined) req.prompt = prompt;
    if (hint && String(hint).includes("@")) req.hint = hint;

    try {
      tokenClient.requestAccessToken(req);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

// allowInteractive=false => NO popup
async function ensureOAuthToken(allowInteractive = false, interactivePrompt = "consent") {
  // 1) token en memoria
  if (isTokenValid()) return oauthAccessToken;

  // 2) token guardado válido
  const stored = loadStoredOAuth();
  if (stored?.access_token && stored?.expires_at && Date.now() < (stored.expires_at - 10_000)) {
    oauthAccessToken = stored.access_token;
    oauthExpiresAt = Number(stored.expires_at);
    return oauthAccessToken;
  }

  const hintEmail = (loadStoredOAuthEmail() || "").trim().toLowerCase();

  // corte: si no es interactivo y no hay hint, no llamar GIS
  if (!allowInteractive && !hintEmail) {
    throw new Error("TOKEN_NEEDS_INTERACTIVE");
  }

  // 3) Silent real
  try {
    await requestAccessToken({ prompt: "", hint: hintEmail || undefined });
    if (isTokenValid()) return oauthAccessToken;
  } catch (e) {
    if (!allowInteractive) throw new Error("TOKEN_NEEDS_INTERACTIVE");
  }

  // 4) Interactivo
  await requestAccessToken({ prompt: interactivePrompt ?? "consent", hint: hintEmail || undefined });
  if (!isTokenValid()) throw new Error("TOKEN_NEEDS_INTERACTIVE");

  return oauthAccessToken;
}

// =====================
// API client (POST text/plain + JSON body) — rápido, sin preflight
// =====================
async function apiPost_(payload) {
  // payload: { mode, access_token, ... }
  // Implementación DIRECTA con Google APIs (Sheets + OIDC)
  const mode = (payload?.mode || "").toString().toLowerCase();
  const token = (payload?.access_token || "").toString();
  if (!token) return { ok: false, error: "auth_required" };

  const sheetEsc = encodeURIComponent(SHEET_NAME);

  try {
    // ---------- WHOAMI ----------
    if (mode === "whoami") {
      const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return { ok: false, error: "whoami_failed" };
      const data = await r.json();
      return { ok: true, email: (data?.email || "").toString().toLowerCase().trim() };
    }

    // ---------- LIST ----------
    if (mode === "list") {
      // Lee A2:C (comida, tipo, timestamp)
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}` +
        `/values/${sheetEsc}!A2:C?majorDimension=ROWS`;

      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const txt = await r.text();
      if (!r.ok) return { ok: false, error: "list_failed", detail: txt.slice(0, 800) };

      const json = JSON.parse(txt);
      const values = Array.isArray(json?.values) ? json.values : [];

      const items = values
        .filter(row => (row?.[0] || "").toString().trim() !== "")
        .map(row => ({
          comida: (row?.[0] || "").toString(),
          tipo: (row?.[1] || "").toString(),
          timestamp: (row?.[2] || "").toString()
        }));

      return { ok: true, items };
    }

    // ---------- ADD ----------
    if (mode === "add") {
      const comida = (payload?.comida || "").toString().trim();
      const tipo = (payload?.tipo || "").toString().trim().toLowerCase();
      if (!comida || !tipo) return { ok: false, error: "invalid_data" };

      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}` +
        `/values/${sheetEsc}!A:C:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

      const body = {
        values: [[comida, tipo, new Date().toISOString()]]
      };

      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const txt = await r.text();
      if (!r.ok) return { ok: false, error: "add_failed", detail: txt.slice(0, 800) };

      return { ok: true };
    }

    // ---------- PING ----------
    if (mode === "ping") return { ok: true, pong: true };

    return { ok: false, error: "bad_mode" };
  } catch (e) {
    return { ok: false, error: "network_error", detail: String(e?.message || e) };
  }
}

async function apiCall(mode, payload = {}, opts = {}) {
  const allowInteractive = !!opts.allowInteractive;

  let token = await ensureOAuthToken(allowInteractive, opts.interactivePrompt || "consent");

  const body = { mode, access_token: token, ...(payload || {}) };

  let data = await apiPost_(body);

  // retry si falta scope / auth
  if (!data?.ok && (data?.error === "missing_scope" || data?.error === "auth_required" || data?.error === "whoami_failed")) {
    token = await ensureOAuthToken(true, "consent");
    body.access_token = token;
    data = await apiPost_(body);
  }

  return data || { ok: false, error: "empty_response" };
}

// ================== HEADER: TÍTULO + ESTADO/OAUTH ==================
const header = document.querySelector("header");

const seccionTitulo = document.createElement("section");
seccionTitulo.classList = "titulo";
header.appendChild(seccionTitulo);

const h1 = document.createElement("h1");
h1.innerText = "Comidas para siempre";
seccionTitulo.appendChild(h1);

// fila 2: pill + acciones
const headerRow2 = document.createElement("div");
headerRow2.className = "header-row-2";
seccionTitulo.appendChild(headerRow2);

const syncPill = document.createElement("div");
syncPill.className = "sync-pill";
syncPill.innerHTML = `<span class="sync-dot"></span><span class="sync-text">Cargando…</span>`;
headerRow2.appendChild(syncPill);

const headerActions = document.createElement("div");
headerActions.className = "header-actions";
headerRow2.appendChild(headerActions);

const btnConnect = document.createElement("button");
btnConnect.className = "btn-connect";
btnConnect.type = "button";
btnConnect.textContent = "Conectar";
headerActions.appendChild(btnConnect);

const btnRefresh = document.createElement("button");
btnRefresh.className = "btn-refresh";
btnRefresh.type = "button";
btnRefresh.textContent = "↻";
btnRefresh.title = "Reintentar conexión";
btnRefresh.style.display = "none";
headerActions.appendChild(btnRefresh);

function setSync(state, text) {
  syncPill.classList.remove("ok", "saving", "offline");
  if (state) syncPill.classList.add(state);
  syncPill.querySelector(".sync-text").textContent = text;
}

// ================== UI: estado conectado ==================
let connectedEmail = "";

function setConnectedEmail(email) {
  connectedEmail = (email || "").toString().toLowerCase().trim();

  const isConnected = !!connectedEmail;

  // ✅ Botón cambia según estado real
  btnConnect.textContent = isConnected ? "Cambiar cuenta" : "Conectar";
  btnConnect.title = isConnected ? `Conectado: ${connectedEmail}` : "Conectar";

  // opcional: si querés que se note visualmente que está conectado
  btnConnect.dataset.connected = isConnected ? "1" : "0";
}

// ================== MAIN ==================
const main = document.querySelector("main");

// ------- Sección para agregar comida -------
const seccionAgregar = document.createElement("section");
seccionAgregar.classList = "agregarComida";
main.appendChild(seccionAgregar);

// Campo: nombre de la comida
const labelComida = document.createElement("label");
labelComida.innerText = "Comida:";
labelComida.htmlFor = "nombre-comida";
seccionAgregar.appendChild(labelComida);

const inputComida = document.createElement("input");
inputComida.type = "text";
inputComida.id = "nombre-comida";
inputComida.placeholder = "Ej: Milanesas al horno";
seccionAgregar.appendChild(inputComida);

// Campo: tipo (select)
const labelTipo = document.createElement("label");
labelTipo.innerText = "Tipo de comida:";
labelTipo.htmlFor = "tipo-comida";
seccionAgregar.appendChild(labelTipo);

const selectTipo = document.createElement("select");
selectTipo.id = "tipo-comida";

const optionSaludable = document.createElement("option");
optionSaludable.value = TIPO_SALUDABLE;
optionSaludable.innerText = "Saludable";
selectTipo.appendChild(optionSaludable);

const optionChatarra = document.createElement("option");
optionChatarra.value = TIPO_CHATARRA;
optionChatarra.innerText = "Chatarra / antojo";
selectTipo.appendChild(optionChatarra);

const optionMerienda = document.createElement("option");
optionMerienda.value = TIPO_MERIENDA;
optionMerienda.innerText = "Merienda";
selectTipo.appendChild(optionMerienda);

seccionAgregar.appendChild(selectTipo);

// Botón: agregar comida
const buttonAgregar = document.createElement("button");
buttonAgregar.innerText = "Agregar comida";
seccionAgregar.appendChild(buttonAgregar);

// ------- Listas de comidas (saludables / chatarra) -------
const seccionListas = document.createElement("section");
seccionListas.classList = "listas-comidas";
main.appendChild(seccionListas);

// Columna: saludables
const colSaludable = document.createElement("div");
colSaludable.classList = "columna columna-saludable";
seccionListas.appendChild(colSaludable);

const tituloSaludable = document.createElement("h2");
tituloSaludable.innerText = "Comidas saludables";
colSaludable.appendChild(tituloSaludable);

const muroSaludables = document.createElement("div");
muroSaludables.classList = "muro-comidas";
colSaludable.appendChild(muroSaludables);

// Columna: chatarra / antojo
const colChatarra = document.createElement("div");
colChatarra.classList = "columna columna-chatarra";
seccionListas.appendChild(colChatarra);

const tituloChatarra = document.createElement("h2");
tituloChatarra.innerText = "Comidas de antojo";
colChatarra.appendChild(tituloChatarra);

const muroChatarra = document.createElement("div");
muroChatarra.classList = "muro-comidas";
colChatarra.appendChild(muroChatarra);

// Columna: meriendas (al final)
const colMerienda = document.createElement("div");
colMerienda.classList = "columna columna-merienda";
seccionListas.appendChild(colMerienda);

const tituloMerienda = document.createElement("h2");
tituloMerienda.innerText = "Meriendas";
colMerienda.appendChild(tituloMerienda);

const muroMerienda = document.createElement("div");
muroMerienda.classList = "muro-comidas";
colMerienda.appendChild(muroMerienda);

// ================== FUNCIONES API ==================

// Render de una lista en un contenedor
function renderLista(comidas, contenedor) {
  contenedor.innerHTML = "";

  comidas.forEach((item) => {
    const card = document.createElement("article");
    card.classList.add("comida-card");

    const h3 = document.createElement("h3");
    h3.innerText = item.comida;
    card.appendChild(h3);

    // Etiqueta tipo (pill)
    const pill = document.createElement("span");
    pill.classList.add("comida-tipo");

    const t = (item.tipo || "").toLowerCase();
    if (t === TIPO_SALUDABLE) pill.innerText = "Saludable";
    else if (t === TIPO_MERIENDA) pill.innerText = "Merienda";
    else pill.innerText = "Antojo";

    card.appendChild(pill);

    // Fecha si existe
    if (item.timestamp) {
      const fecha = new Date(item.timestamp);
      const pFecha = document.createElement("p");
      pFecha.classList.add("comida-fecha");
      pFecha.innerText = fecha.toLocaleString("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
      });
      card.appendChild(pFecha);
    }

    contenedor.appendChild(card);
  });
}

// Cargar comidas desde Google Sheets (Apps Script)
async function cargarComidasDesdeAPI() {
  try {
    setSync("saving", "Cargando…");

    const resp = await apiCall("list", {}, { allowInteractive: false });
    if (!resp?.ok) {
      console.error("LIST ERROR FULL:", resp);
      throw new Error(resp?.detail || resp?.error || "list_failed");
    }

    const comidas = Array.isArray(resp?.items) ? resp.items : [];

    // Separar en saludables / chatarra / meriendas
    const saludables = [];
    const chatarra = [];
    const meriendas = [];

    comidas.forEach((item) => {
      const tipo = (item.tipo || "").toLowerCase();
      if (tipo === TIPO_SALUDABLE) saludables.push(item);
      else if (tipo === TIPO_MERIENDA) meriendas.push(item);
      else if (tipo === TIPO_CHATARRA) chatarra.push(item);
    });

    // Orden alfabético por nombre
    const ordenarPorNombre = (a, b) =>
      (a.comida || "").localeCompare(b.comida || "", "es", { sensitivity: "base" });

    saludables.sort(ordenarPorNombre);
    chatarra.sort(ordenarPorNombre);
    meriendas.sort(ordenarPorNombre);

    renderLista(saludables, muroSaludables);
    renderLista(chatarra, muroChatarra);
    renderLista(meriendas, muroMerienda);

    setSync("ok", "Listo ✅");
    btnRefresh.style.display = "none";
  } catch (err) {
    console.error("Error al cargar comidas", err);

    const msg = String(err?.message || err || "");
    if (msg === "TOKEN_NEEDS_INTERACTIVE") {
      setSync("offline", "Necesita Conectar");
      btnRefresh.style.display = "inline-block";
      return;
    }

    setSync("offline", "No se pudo cargar");
    btnRefresh.style.display = "inline-block";
  }
}

// Agregar comida nueva (GET ?modo=add)
async function agregarComidaAPI(nombre, tipo) {
  const nombreLimpio = (nombre || "").trim();
  const tipoLimpio = (tipo || "").trim().toLowerCase();

  if (!nombreLimpio || !tipoLimpio) return;

  try {
    setSync("saving", "Guardando…");

    const saved = await apiCall("add", { comida: nombreLimpio, tipo: tipoLimpio }, { allowInteractive: false });
    if (!saved?.ok) throw new Error(saved?.error || "add_failed");

    // recarga rápida
    await cargarComidasDesdeAPI();

    setSync("ok", "Guardado ✅");
    btnRefresh.style.display = "none";
  } catch (err) {
    console.error("Error al agregar comida", err);

    const msg = String(err?.message || err || "");
    if (msg === "TOKEN_NEEDS_INTERACTIVE") {
      setSync("offline", "Necesita Conectar");
      btnRefresh.style.display = "inline-block";
      return;
    }

    setSync("offline", "No se pudo guardar");
    btnRefresh.style.display = "inline-block";
  }
}

// ================== EVENTOS ==================

buttonAgregar.addEventListener("click", () => {
  agregarComidaAPI(inputComida.value, selectTipo.value);
  inputComida.value = "";
  selectTipo.value = TIPO_SALUDABLE;
  inputComida.focus();
});

// Enter en input -> pasa al select
inputComida.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    event.preventDefault();
    selectTipo.focus();
  }
});

// Cargar al iniciar
// ================== UI: Conectar / Refresh ==================
async function verifyBackendAccessOrThrow(allowInteractive) {
  const who = await apiCall("whoami", {}, { allowInteractive });
  if (!who?.ok) throw new Error(who?.error || "whoami_failed");

  // guardo email (hint) para reconexión silenciosa
  const email = (who?.email || "").toString().toLowerCase().trim();
  if (email) saveStoredOAuthEmail(email);

  // ✅ guardar estado conectado + actualizar botón
  setConnectedEmail(email);

  // ✅ dejamos el pill con algo corto (no lo pisamos con email largo)
  if (email) setSync("ok", "Listo ✅");

  return who;
}

async function runConnectFlow({ interactive, prompt } = { interactive: false, prompt: "consent" }) {
  try {
    setSync("saving", interactive ? "Conectando…" : "Reconectando…");

    // 1) token
    await ensureOAuthToken(!!interactive, prompt || "consent");

    // 2) whoami (valida + guarda email + setConnectedEmail)
    await verifyBackendAccessOrThrow(!!interactive);

    // 3) cargar lista
    btnRefresh.style.display = "none";
    await cargarComidasDesdeAPI();

    return { ok: true };
  } catch (e) {
    // ✅ si falla, no estás conectado => vuelve a "Conectar"
    setConnectedEmail("");

    const msg = String(e?.message || e || "");
    if (msg === "TOKEN_NEEDS_INTERACTIVE") {
      setSync("offline", "Necesita Conectar");
      btnRefresh.style.display = "inline-block";
      return { ok: false, needsInteractive: true };
    }

    if (e?.isCanceled) {
      setSync("offline", "Conexión cancelada");
      btnRefresh.style.display = "inline-block";
      return { ok: false, canceled: true };
    }

    setSync("offline", "Necesita Conectar");
    btnRefresh.style.display = "inline-block";
    return { ok: false, error: msg };
  }
}

btnConnect.addEventListener("click", () => {
  // ✅ iOS/Safari: el popup SOLO se abre si se dispara "sin await" dentro del click.
  // Por eso abrimos el selector de cuenta INMEDIATO y recién luego continuamos el flow.

  try {
    setSync("saving", "Abriendo Google…");

    // Hint (si existe) para acelerar. Pero en "select_account" igual muestra selector.
    const hintEmail = (loadStoredOAuthEmail() || "").trim().toLowerCase();

    // 👇 Esto abre el popup inmediatamente (gesto de usuario).
    requestAccessToken({
      prompt: "select_account",
      hint: hintEmail || undefined
    })
      .then(async () => {
        // Ya tenemos token nuevo en oauthAccessToken/oauthExpiresAt (por requestAccessToken)
        // Validamos + guardamos email + actualizamos UI + cargamos lista
        await verifyBackendAccessOrThrow(true);
        btnRefresh.style.display = "none";
        await cargarComidasDesdeAPI();
      })
      .catch((e) => {
        // Si canceló el popup o fue bloqueado, lo manejamos acá.
        if (e?.isCanceled) {
          setSync("offline", "Conexión cancelada");
        } else {
          setSync("offline", "Necesita Conectar");
        }
        btnRefresh.style.display = "inline-block";
        console.warn("No se pudo conectar:", e);
      });
  } catch (e) {
    setSync("offline", "Necesita Conectar");
    btnRefresh.style.display = "inline-block";
    console.warn("Error abriendo popup:", e);
  }
});

btnRefresh.addEventListener("click", async () => {
  // reintentar sin popup
  await runConnectFlow({ interactive: false, prompt: "" });
});

// auto-refresh token silencioso (evita pedir reconectar manual)
setInterval(async () => {
  try {
    if (document.visibilityState !== "visible") return;
    if (!oauthAccessToken) return;

    // si falta poco para expirar, intento silencioso
    if (Date.now() < (oauthExpiresAt - 120_000)) return;

    await ensureOAuthToken(false);

    // si logró renovar, refresco datos sin popup
    if (isTokenValid()) {
      await runConnectFlow({ interactive: false, prompt: "" });
    }
  } catch {}
}, 20_000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!isTokenValid()) return;
  runConnectFlow({ interactive: false, prompt: "" });
});

// ================== INIT ==================
window.addEventListener("load", async () => {
  // OAuth init + cargar token guardado
  try {
    initOAuth();
    const stored = loadStoredOAuth();
    if (stored?.access_token && Date.now() < (stored.expires_at - 10_000)) {
      oauthAccessToken = stored.access_token;
      oauthExpiresAt = stored.expires_at;
    }
  } catch {
    // si GIS no cargó, se verá al tocar Conectar
  }

  // Auto-sync al cargar (SIN popup)
  if (navigator.onLine !== false) {
    const hint = loadStoredOAuthEmail();
    const stored = loadStoredOAuth();

    if (hint || (stored?.access_token && stored?.expires_at)) {
      await runConnectFlow({ interactive: false, prompt: "" });
    } else {
      setSync("offline", "Necesita Conectar");
      btnRefresh.style.display = "inline-block";
    }
  } else {
    setSync("offline", "Sin conexión");
    btnRefresh.style.display = "none";
  }
});
