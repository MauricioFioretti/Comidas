// ================== CONFIG ==================
const API_URL = "https://script.google.com/macros/s/AKfycbzAq3njTZRE3g7JuzWYoPscnEi4kUcwWpWRynoud2kOnB74y47ko_KOoI-QINHQFhvE/exec"; // <--- NUEVA URL DE APPS SCRIPT

// Para que puedas cambiar fácilmente los textos/valores:
const TIPO_SALUDABLE = "saludable";
const TIPO_CHATARRA  = "chatarra";

// ================== HEADER: TÍTULO ==================
const header = document.querySelector("header");

const seccionTitulo = document.createElement("section");
seccionTitulo.classList = "titulo";
header.appendChild(seccionTitulo);

const h1 = document.createElement("h1");
h1.innerText = "Comidas para siempre";
seccionTitulo.appendChild(h1);

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

// Columna: chatarra / no saludable
const colChatarra = document.createElement("div");
colChatarra.classList = "columna columna-chatarra";
seccionListas.appendChild(colChatarra);

const tituloChatarra = document.createElement("h2");
tituloChatarra.innerText = "Comidas de antojo";
colChatarra.appendChild(tituloChatarra);

const muroChatarra = document.createElement("div");
muroChatarra.classList = "muro-comidas";
colChatarra.appendChild(muroChatarra);

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
    pill.innerText =
      (item.tipo || "").toLowerCase() === TIPO_SALUDABLE
        ? "Saludable"
        : "Antojo";
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
    const resp = await fetch(API_URL); // modo "list" por defecto
    const comidas = await resp.json();

    // Separar en saludables / chatarra
    const saludables = [];
    const chatarra = [];

    comidas.forEach((item) => {
      const tipo = (item.tipo || "").toLowerCase();

      if (tipo === TIPO_SALUDABLE) {
        saludables.push(item);
      } else if (tipo === TIPO_CHATARRA) {
        chatarra.push(item);
      }
    });

    // Orden alfabético por nombre de comida
    const ordenarPorNombre = (a, b) =>
      (a.comida || "").localeCompare(b.comida || "", "es", {
        sensitivity: "base",
      });

    saludables.sort(ordenarPorNombre);
    chatarra.sort(ordenarPorNombre);

    // Render
    renderLista(saludables, muroSaludables);
    renderLista(chatarra, muroChatarra);
  } catch (err) {
    console.error("Error al cargar comidas", err);
  }
}

// Agregar comida nueva (GET ?modo=add)
async function agregarComidaAPI(nombre, tipo) {
  const nombreLimpio = (nombre || "").trim();
  const tipoLimpio = (tipo || "").trim();

  if (!nombreLimpio || !tipoLimpio) return;

  const url =
    API_URL +
    "?modo=add" +
    "&comida=" +
    encodeURIComponent(nombreLimpio) +
    "&tipo=" +
    encodeURIComponent(tipoLimpio);

  try {
    await fetch(url);
    await cargarComidasDesdeAPI();
  } catch (err) {
    console.error("Error al agregar comida", err);
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
window.addEventListener("load", cargarComidasDesdeAPI);
