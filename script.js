// ============ FIREBASE CONFIG ============
const firebaseConfig = {
  apiKey: "AIzaSyBhh3nIzAWyvT47HQ-hh6umjqoCMYBI1Lk",
  authDomain: "johcards-2db9b.firebaseapp.com",
  projectId: "johcards-2db9b",
  storageBucket: "johcards-2db9b.firebasestorage.app",
  messagingSenderId: "955656442066",
  appId: "1:955656442066:web:3f0d0335191d67eac61d0b"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ============ STATE ============
let activeEventId = null;
let activeEventData = null;
let guestsUnsubscribe = null;
let editingEventId = null; // si null tunapohariri tukio

// ============ HELPERS ============
function randomCode(len){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for(let i=0;i<len;i++){ out += chars[Math.floor(Math.random()*chars.length)]; }
  return out;
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeFilename(name){
  return name.replace(/[^a-z0-9\-_]+/gi, '_');
}

function futaFomuYaTukio(){
  document.getElementById('eventName').value = '';
  document.getElementById('eventCode').value = '';
  document.getElementById('eventDate').value = '';
  document.getElementById('eventVenue').value = '';
}

// ============ EVENTS ============
async function loadEvents(){
  const select = document.getElementById('selectEvent');
  try{
    const snap = await db.collection('events').orderBy('createdAt', 'desc').get();
    select.innerHTML = '<option value="">— Chagua tukio —</option>';
    snap.forEach(doc => {
      const d = doc.data();
      const opt = document.createElement('option');
      opt.value = doc.id;
      opt.textContent = `${d.name} (${d.code})`;
      select.appendChild(opt);
    });
  }catch(err){
    console.error('Imeshindikana kupakia matukio:', err);
    document.getElementById('eventStatusMsg').textContent = 'Hitilafu kupakia matukio.';
  }
}

// Unda tukio jipya AU hifadhi mabadiliko ya tukio linalohaririwa
async function saveEvent(){
  const name = document.getElementById('eventName').value.trim();
  const code = document.getElementById('eventCode').value.trim().toUpperCase().replace(/\s+/g,'');
  const date = document.getElementById('eventDate').value;
  const venue = document.getElementById('eventVenue').value.trim();
  const msg = document.getElementById('eventStatusMsg');

  if(!name || !code){
    msg.textContent = 'Jaza jina la tukio na kodi fupi kwanza.';
    return;
  }

  // ----- Hali ya kuhariri -----
  if(editingEventId){
    const id = editingEventId;
    msg.textContent = 'Inahifadhi mabadiliko...';
    try{
      await db.collection('events').doc(id).update({ name, code, date, venue });
      cancelEditEvent();
      await loadEvents();
      document.getElementById('selectEvent').value = id;
      await onEventSelected(id);
      msg.textContent = 'Mabadiliko yamehifadhiwa!';
    }catch(err){
      console.error(err);
      msg.textContent = 'Hitilafu: ' + err.message;
    }
    return;
  }

  // ----- Hali ya kuunda tukio jipya -----
  msg.textContent = 'Inaunda tukio...';
  try{
    const docRef = await db.collection('events').add({
      name, code, date, venue,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    msg.textContent = 'Tukio limeundwa!';
    futaFomuYaTukio();
    await loadEvents();
    document.getElementById('selectEvent').value = docRef.id;
    onEventSelected(docRef.id);
  }catch(err){
    console.error(err);
    msg.textContent = 'Hitilafu: ' + err.message;
  }
}

function startEditEvent(){
  if(!activeEventId || !activeEventData) return;

  editingEventId = activeEventId;
  document.getElementById('eventName').value = activeEventData.name || '';
  document.getElementById('eventCode').value = activeEventData.code || '';
  document.getElementById('eventDate').value = activeEventData.date || '';
  document.getElementById('eventVenue').value = activeEventData.venue || '';

  document.getElementById('eventSaveBtn').textContent = 'Hifadhi Mabadiliko';
  document.getElementById('eventCancelBtn').style.display = 'inline-block';
  document.getElementById('eventStatusMsg').textContent =
    'Unahariri: ' + (activeEventData.name || '') + '. Badilisha kisha bonyeza Hifadhi Mabadiliko.';
}

function cancelEditEvent(){
  editingEventId = null;
  futaFomuYaTukio();
  document.getElementById('eventSaveBtn').textContent = 'Unda Tukio Jipya';
  document.getElementById('eventCancelBtn').style.display = 'none';
  document.getElementById('eventStatusMsg').textContent = '';
}

async function deleteEvent(){
  if(!activeEventId || !activeEventData) return;

  const eventId = activeEventId;
  const jina = activeEventData.name;
  const msg = document.getElementById('eventStatusMsg');

  if(!confirm('Una uhakika unataka kufuta tukio "' + jina + '" pamoja na wageni wake wote? Hili haliwezi kurudishwa.')) return;

  msg.textContent = 'Inafuta tukio na wageni wake...';

  // Simamisha orodha ya moja kwa moja wakati wa kufuta
  if(guestsUnsubscribe) guestsUnsubscribe();

  try{
    // Futa wageni wote kwa vipande (Firestore haifuti subcollection yenyewe)
    const guestsRef = db.collection('events').doc(eventId).collection('guests');
    while(true){
      const snap = await guestsRef.limit(400).get();
      if(snap.empty) break;
      const batch = db.batch();
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // Kisha futa tukio lenyewe
    await db.collection('events').doc(eventId).delete();

    if(editingEventId === eventId) cancelEditEvent();
    await loadEvents();
    document.getElementById('selectEvent').value = '';
    await onEventSelected('');
    msg.textContent = 'Tukio "' + jina + '" limefutwa.';
  }catch(err){
    console.error(err);
    msg.textContent = 'Hitilafu wakati wa kufuta: ' + err.message;
    // Rudisha orodha ya moja kwa moja kama kufuta kumeshindwa
    if(activeEventId) listenToGuests(activeEventId);
  }
}

async function onEventSelected(eventId){
  if(editingEventId && editingEventId !== eventId) cancelEditEvent();

  activeEventId = eventId;
  if(!eventId){
    activeEventData = null;
    document.getElementById('eventTools').style.display = 'none';
    document.getElementById('guestsPanel').style.display = 'none';
    document.getElementById('listSection').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    if(guestsUnsubscribe) guestsUnsubscribe();
    return;
  }

  try{
    const doc = await db.collection('events').doc(eventId).get();
    if(!doc.exists){
      alert('Tukio hili halipatikani.');
      return;
    }
    activeEventData = doc.data();

    document.getElementById('eventTools').style.display = 'flex';
    document.getElementById('guestsPanel').style.display = 'block';
    document.getElementById('listSection').style.display = 'block';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('activeEventTag').textContent =
      `Tukio hai: ${activeEventData.name} (${activeEventData.code})`;

    listenToGuests(eventId);
  }catch(err){
    console.error('onEventSelected error:', err);
    alert('Imeshindikana kupakia tukio: ' + err.message);
  }
}

// ============ GUESTS ============
async function addGuests(){
  if(!activeEventId){
    alert('Chagua au unda tukio kwanza.');
    return;
  }
  const rawLines = document.getElementById('guestNames').value;
  const lines = rawLines.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if(lines.length === 0){
    alert('Andika jina la mgeni angalau mmoja.');
    return;
  }

  // Hali ya malipo ya mwanzo
  const kisanduku = document.getElementById('guestPaid');
  const amelipaMwanzo = kisanduku ? kisanduku.value === 'true' : false;

  // Aina ya kadi: single au double
  const kisandukuAina = document.getElementById('guestAina');
  const aina = kisandukuAina ? kisandukuAina.value : 'single';

  // Parse kila mstari kuwa {name, phone}
  const parsedGuests = lines.map(line => {
    const parts = line.split(',').map(p => p.trim());
    return { name: parts[0] || '', phone: parts[1] || '' };
  }).filter(g => g.name.length > 0);

  const countTag = document.getElementById('guestCountTag');
  countTag.textContent = 'Inaongeza wageni na kutengeneza QR...';

  const batch = db.batch();
  const guestsRef = db.collection('events').doc(activeEventId).collection('guests');

  parsedGuests.forEach(g => {
    const guestId = `${activeEventData.code}-${randomCode(6)}`;
    const ref = guestsRef.doc(guestId);
    batch.set(ref, {
      name: g.name,
      phone: g.phone,
      paid: amelipaMwanzo,
      aina: aina,
      attended: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  });

  try{
    await batch.commit();
    document.getElementById('guestNames').value = '';
    countTag.textContent = `Wageni ${parsedGuests.length} wameongezwa.`;
  }catch(err){
    console.error(err);
    countTag.textContent = 'Hitilafu: ' + err.message;
  }
}

function listenToGuests(eventId){
  if(guestsUnsubscribe) guestsUnsubscribe();

  const grid = document.getElementById('guestGrid');
  guestsUnsubscribe = db.collection('events').doc(eventId).collection('guests')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      grid.innerHTML = '';
      snap.forEach(doc => {
        renderGuestCard(eventId, doc.id, doc.data());
      });
    }, err => {
      console.error('Guests listener error:', err);
    });
}

function renderGuestCard(eventId, guestId, data){
  const grid = document.getElementById('guestGrid');
  const qrPayload = `${eventId}::${guestId}`;
  const cardId = `qr_${guestId}`;
  const ainaMaandishi = data.aina === 'double' ? 'DOUBLE' : 'SINGLE';

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="qr-box" id="${cardId}"></div>
    <div class="g-name">${escapeHtml(data.name)}</div>
    <div class="g-id">${guestId}${data.phone ? ' · ' + escapeHtml(data.phone) : ''}</div>
    <div class="badges">
      <span class="badge ${data.paid ? 'paid-yes' : 'paid-no'}" onclick="togglePaid('${eventId}','${guestId}', ${data.paid})">
        ${data.paid ? '✓ Amelipa' : '✕ Hajalipa'}
      </span>
      <span class="badge ${data.attended ? 'att-yes' : 'att-no'}">
        ${data.attended ? '✓ Amehudhuria' : 'Bado'}
      </span>
      <span class="badge">${ainaMaandishi}</span>
    </div>
    <div class="card-actions">
      <button class="dl" onclick="downloadQR('${eventId}','${guestId}','${sanitizeFilename(data.name)}')">Pakua QR</button>
      <button class="dl del" onclick="deleteGuest('${eventId}','${guestId}')">Futa</button>
    </div>
  `;
  grid.appendChild(card);

  new QRCode(document.getElementById(cardId), {
    text: qrPayload,
    width: 150,
    height: 150,
    colorDark: "#0a2540",
    colorLight: "#f5f0e6",
    correctLevel: QRCode.CorrectLevel.M
  });
}

async function togglePaid(eventId, guestId, currentValue){
  try{
    await db.collection('events').doc(eventId).collection('guests').doc(guestId)
      .update({ paid: !currentValue });
  }catch(err){
    console.error(err);
    alert('Imeshindikana kubadili hali ya malipo: ' + err.message);
  }
}

async function deleteGuest(eventId, guestId){
  if(!confirm('Una uhakika unataka kufuta mgeni huyu?')) return;
  try{
    await db.collection('events').doc(eventId).collection('guests').doc(guestId).delete();
  }catch(err){
    console.error(err);
    alert('Imeshindikana kufuta: ' + err.message);
  }
}

// Pakua QR: kubwa (pikseli 900) na mpaka mweupe kuzunguka
function downloadQR(eventId, guestId, filename){
  const ukubwaQR = 700;   // ukubwa wa QR yenyewe
  const mpaka = 100;      // mpaka mweupe kuzunguka
  const jumla = ukubwaQR + mpaka * 2;

  // QR kubwa ya muda, haionekani kwenye ukurasa
  const temp = document.createElement('div');
  temp.style.position = 'absolute';
  temp.style.left = '-9999px';
  document.body.appendChild(temp);

  new QRCode(temp, {
    text: `${eventId}::${guestId}`,
    width: ukubwaQR,
    height: ukubwaQR,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  const qrCanvas = temp.querySelector('canvas');

  // Picha ya mwisho: mraba mweupe wenye QR katikati
  const canvas = document.createElement('canvas');
  canvas.width = jumla;
  canvas.height = jumla;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, jumla, jumla);
  ctx.drawImage(qrCanvas, mpaka, mpaka, ukubwaQR, ukubwaQR);

  const link = document.createElement('a');
  link.download = `${filename || 'mgeni'}_QR.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();

  document.body.removeChild(temp);
}

// ============ EVENT LISTENERS ============
document.getElementById('selectEvent').addEventListener('change', (e) => {
  onEventSelected(e.target.value);
});

// ============ INIT ============
loadEvents();
