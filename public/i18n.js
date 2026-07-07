// 🌍 tiny i18n — english, español, suomi
// language comes from the browser (navigator.languages), override with ?lang=fi
// finnish tone: relaxed everyday speech, not stiff kirjakieli, not slang soup

const I18N = {
  en: {
    loading: "loading…",
    credit: "made with 💕 on the road",
    empty: "no adventures logged yet…<br>the map will bloom once the van starts sending its location 💌",
    tripFallback: "our little adventure",
    km: "🛣 {n} km",
    day: "🏕 day {n}",
    photos_1: "📸 1 photo",
    photos: "📸 {n} photos",
    updated: "last waved at us {t} 💌",
    justNow: "just now",
    minAgo: "{n} min ago",
    hAgo: "{n} h ago",
    dAgo: "{n} days ago",
    alongTheWay: "🐾 along the way",
    feels: "🤗 feels {n}°",
    cruising: "🛞 cruising {n} km/h",
    by: "by {name}",
    shoebox: "🥾 shoebox · {n}",
    shoeboxTitle: "📸 the shoebox",
    shoeboxSub: "album photos still waiting for their place on the route",
    stackTitle: "📸 this stop",
    stackSub: "{n} little moments from the same spot",
    recenter: "show the whole route",
    vanBtn: "jump to the van",
    statsBtn: "trip stats",
    statsTitle: "✨ little numbers",
    statsSub: "what the road has been whispering",
    u_d: "d", u_h: "h", u_min: "min",
    stTotal: "of adventure",
    stTotalSub: "{n} h at the wheel",
    stLongestDrive: "longest drive without a break",
    stLongestStop: "longest stop",
    stFastest: "fastest moment",
    stAvg: "average cruising",
    stAvgSub: "while the wheels were rolling",
    stTopCity: "stayed longest in",
    stHighest: "highest point",
    stHottest: "warmest moment",
    stColdest: "chilliest moment",
    stNorth: "northernmost wiggle",
    stChill: "lazy days",
    stChillSub: "vs {n} driving days",
    stCountries: "🗺 time per country",
    // weather words
    w_sunny: "sunny", w_mostly: "mostly sunny", w_partly: "partly cloudy", w_cloudy: "cloudy",
    w_foggy: "foggy", w_drizzly: "drizzly", w_rainy: "rainy", w_snowy: "snowy",
    w_showers: "showers", w_snowshowers: "snow showers", w_stormy: "stormy",
    w_adventuring: "adventuring", w_mystery: "mystery weather",
    // importer
    importTitle: "🧳 the time machine",
    importSub: "Drop photos from your camera roll and their hidden GPS + timestamps become route points, so the map remembers where you've been — even from before the tracker woke up. Photos are read <b>right here in your browser</b> and never leave your device; only the coordinates travel.",
    backToMap: "← back to the map",
    tokenLabel: "ingest token 🔑",
    tokenPlaceholder: "the secret ingest token",
    dropHere: "drop photos here, or tap to choose",
    noGps: "no GPS or time in this file",
    importBtn: "✨ add these moments to the route",
    needToken: "🔑 the map needs its secret token first",
    badToken: "😳 that token wasn't right — double-check it?",
    travelling: "🚐 travelling back in time… {i}/{n}",
    added_1: "💖 1 moment added to the route!",
    added: "💖 {n} moments added to the route!",
    dupes: " ({n} were already there)",
    failedBatches: " — {n} batches failed, try again?",
    seeMap: " head back to the map to see them ✨",
  },

  es: {
    loading: "cargando…",
    credit: "hecho con 💕 en la carretera",
    empty: "aún no hay aventuras…<br>el mapa florecerá cuando la furgo empiece a compartir su ubicación 💌",
    tripFallback: "nuestra pequeña aventura",
    km: "🛣 {n} km",
    day: "🏕 día {n}",
    photos_1: "📸 1 foto",
    photos: "📸 {n} fotos",
    updated: "nos saludó {t} 💌",
    justNow: "ahora mismo",
    minAgo: "hace {n} min",
    hAgo: "hace {n} h",
    dAgo: "hace {n} días",
    alongTheWay: "🐾 por el camino",
    feels: "🤗 sensación de {n}°",
    cruising: "🛞 rodando a {n} km/h",
    by: "de {name}",
    shoebox: "🥾 caja de zapatos · {n}",
    shoeboxTitle: "📸 la caja de zapatos",
    shoeboxSub: "fotos del álbum que aún buscan su lugar en la ruta",
    stackTitle: "📸 esta parada",
    stackSub: "{n} momentitos del mismo lugar",
    recenter: "ver toda la ruta",
    vanBtn: "ir a la furgo",
    statsBtn: "estadísticas del viaje",
    statsTitle: "✨ numeritos",
    statsSub: "lo que el camino va susurrando",
    u_d: "d", u_h: "h", u_min: "min",
    stTotal: "de aventura",
    stTotalSub: "{n} h al volante",
    stLongestDrive: "tramo más largo sin parar",
    stLongestStop: "parada más larga",
    stFastest: "momento más rápido",
    stAvg: "crucero promedio",
    stAvgSub: "con las ruedas girando",
    stTopCity: "donde más nos quedamos",
    stHighest: "punto más alto",
    stHottest: "momento más caluroso",
    stColdest: "momento más fresquito",
    stNorth: "lo más al norte",
    stChill: "días de tranquilidad",
    stChillSub: "vs {n} días de ruta",
    stCountries: "🗺 tiempo por país",
    w_sunny: "soleado", w_mostly: "casi despejado", w_partly: "parcialmente nublado", w_cloudy: "nublado",
    w_foggy: "con niebla", w_drizzly: "llovizna", w_rainy: "lluvioso", w_snowy: "nevando",
    w_showers: "chubascos", w_snowshowers: "chubascos de nieve", w_stormy: "tormenta",
    w_adventuring: "de aventura", w_mystery: "clima misterioso",
    importTitle: "🧳 la máquina del tiempo",
    importSub: "Suelta fotos de tu carrete y su GPS + hora ocultos se convierten en puntos de la ruta, para que el mapa recuerde dónde has estado — incluso antes de que el tracker despertara. Las fotos se leen <b>aquí mismo, en tu navegador</b>, y nunca salen de tu dispositivo; solo viajan las coordenadas.",
    backToMap: "← volver al mapa",
    tokenLabel: "token secreto 🔑",
    tokenPlaceholder: "el token secreto de ingesta",
    dropHere: "suelta las fotos aquí, o toca para elegir",
    noGps: "este archivo no tiene GPS ni hora",
    importBtn: "✨ añadir estos momentos a la ruta",
    needToken: "🔑 el mapa necesita primero su token secreto",
    badToken: "😳 ese token no era correcto — ¿lo compruebas?",
    travelling: "🚐 viajando atrás en el tiempo… {i}/{n}",
    added_1: "💖 ¡1 momento añadido a la ruta!",
    added: "💖 ¡{n} momentos añadidos a la ruta!",
    dupes: " ({n} ya estaban)",
    failedBatches: " — {n} lotes fallaron, ¿otra vez?",
    seeMap: " vuelve al mapa para verlos ✨",
  },

  fi: {
    loading: "latautuu…",
    credit: "tehty 💕 reissussa",
    empty: "ei vielä seikkailuja…<br>kartta herää henkiin, kun paku alkaa jakaa sijaintiaan 💌",
    tripFallback: "meidän pieni seikkailu",
    km: "🛣 {n} km",
    day: "🏕 päivä {n}",
    photos_1: "📸 1 kuva",
    photos: "📸 {n} kuvaa",
    updated: "vilkutti meille {t} 💌",
    justNow: "juuri äsken",
    minAgo: "{n} min sitten",
    hAgo: "{n} h sitten",
    dAgo: "{n} pv sitten",
    alongTheWay: "🐾 matkan varrella",
    feels: "🤗 tuntuu {n}°",
    cruising: "🛞 rullataan {n} km/h",
    by: "kuvasi {name}",
    shoebox: "🥾 kenkälaatikko · {n}",
    shoeboxTitle: "📸 kenkälaatikko",
    shoeboxSub: "albumin kuvia, jotka etsivät vielä paikkaansa reitiltä",
    stackTitle: "📸 tämä pysähdys",
    stackSub: "{n} pientä hetkeä samasta paikasta",
    recenter: "näytä koko reitti",
    vanBtn: "hyppää pakun luo",
    statsBtn: "reissun tilastot",
    statsTitle: "✨ pieniä lukuja",
    statsSub: "mitä tie on kuiskinut matkalla",
    u_d: "pv", u_h: "h", u_min: "min",
    stTotal: "seikkailua",
    stTotalSub: "{n} h ratissa",
    stLongestDrive: "pisin ajo ilman taukoa",
    stLongestStop: "pisin pysähdys",
    stFastest: "nopein hetki",
    stAvg: "keskivauhti",
    stAvgSub: "kun pyörät pyörivät",
    stTopCity: "pisimpään paikassa",
    stHighest: "korkein kohta",
    stHottest: "lämpimin hetki",
    stColdest: "viilein hetki",
    stNorth: "pohjoisin piipahdus",
    stChill: "löhöpäivät",
    stChillSub: "vs {n} ajopäivää",
    stCountries: "🗺 aika per maa",
    w_sunny: "aurinkoista", w_mostly: "enimmäkseen aurinkoista", w_partly: "puolipilvistä", w_cloudy: "pilvistä",
    w_foggy: "sumuista", w_drizzly: "tihkusadetta", w_rainy: "sateista", w_snowy: "lumisadetta",
    w_showers: "sadekuuroja", w_snowshowers: "lumikuuroja", w_stormy: "ukkostaa",
    w_adventuring: "seikkaillaan", w_mystery: "mysteerisää",
    importTitle: "🧳 aikakone",
    importSub: "Pudota kuvia kamerarullasta, niin niiden kätketty GPS ja kellonaika muuttuvat reittipisteiksi — kartta muistaa missä on menty jo ennen kuin trackeri heräsi. Kuvat luetaan <b>suoraan selaimessa</b> eivätkä ne koskaan lähde laitteeltasi; vain koordinaatit matkustavat.",
    backToMap: "← takaisin kartalle",
    tokenLabel: "salainen avain 🔑",
    tokenPlaceholder: "se salainen avain",
    dropHere: "pudota kuvat tähän tai napauta ja valitse",
    noGps: "tässä tiedostossa ei ole GPS:ää eikä aikaa",
    importBtn: "✨ lisää nämä hetket reitille",
    needToken: "🔑 kartta tarvitsee ensin salaisen avaimensa",
    badToken: "😳 tuo avain ei täsmännyt — tarkistatko sen?",
    travelling: "🚐 matkataan ajassa taaksepäin… {i}/{n}",
    added_1: "💖 1 hetki lisätty reitille!",
    added: "💖 {n} hetkeä lisätty reitille!",
    dupes: " ({n} oli jo siellä)",
    failedBatches: " — {n} erää epäonnistui, kokeiletko uudestaan?",
    seeMap: " kurkkaa kartalta miltä ne näyttävät ✨",
  },
};

const LANG = (() => {
  const q = new URLSearchParams(location.search).get("lang");
  if (q && I18N[q]) return q;
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const primary = String(l).toLowerCase().split("-")[0];
    if (I18N[primary]) return primary;
  }
  return "en";
})();

// locale for dates/numbers; english keeps the browser's own regional format
const LOCALE = LANG === "en" ? undefined : LANG;

function t(key, vars) {
  let s = I18N[LANG][key] ?? I18N.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// count-aware variant: uses "<key>_1" when n is exactly 1
function tn(key, n, vars) {
  return t(n === 1 && I18N[LANG][`${key}_1`] ? `${key}_1` : key, { n, ...vars });
}

// static page bits: <el data-i18n="key">, data-i18n-html for rich text,
// data-i18n-title / data-i18n-placeholder for attributes
function applyI18n() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll("[data-i18n-placeholder]"))
    el.placeholder = t(el.dataset.i18nPlaceholder);
}
applyI18n();
