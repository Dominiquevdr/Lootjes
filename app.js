
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  serverTimestamp,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBc7fJKYOwwoe7qhSBtVpjwr1jZ9vRo1yQ',
  authDomain: 'lootjes-182e6.firebaseapp.com',
  projectId: 'lootjes-182e6',
  storageBucket: 'lootjes-182e6.firebasestorage.app',
  messagingSenderId: '963823887453',
  appId: '1:963823887453:web:67162033f43bd0e9cd99b4'
};

const ADMIN_UID = 'syp8cPy6njSgtsqLxNSX4nIL5I13';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
const eventId = params.get('e');
const token = params.get('t');

let selectedEvent = null;
let activeEvent = null;
let people = [];
let keys = [];
let secrets = [];
let exclusionSet = new Set();

let myPerson = null;
let mySecret = null;
let recipient = null;
let refreshing = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function show(id) {
  for (const name of ['home', 'login', 'admin', 'participant']) {
    $(name).classList.toggle('hidden', name !== id);
  }
}

function status(message) {
  $('status').textContent = message;
}

function fail(error) {
  console.error(error);
  status('Fout: ' + (error?.message || String(error)));
}

function rid() {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    b => b.toString(16).padStart(2, '0')
  ).join('');
}

function names(value) {
  const list = value.split('\n')
    .map(x => x.trim())
    .filter(Boolean);

  if (new Set(list.map(x => x.toLocaleLowerCase('nl'))).size
      !== list.length) {
    throw Error('Deelnemersnamen moeten uniek zijn.');
  }

  return list;
}

function sortPeople(list) {
  return list.sort((a, b) =>
    a.naam.localeCompare(b.naam, 'nl')
  );
}

const eventRef = id => doc(db, 'trekkingen', id);
const personRef = (id, p) =>
  doc(db, 'trekkingen', id, 'personen', p);
const keyRef = (id, t) =>
  doc(db, 'trekkingen', id, 'sleutels', t);
const memberRef = (id, uid) =>
  doc(db, 'trekkingen', id, 'leden', uid);
const secretRef = (id, t) =>
  doc(db, 'trekkingen', id, 'geheimen', t);
const configRef = id =>
  doc(db, 'trekkingen', id, 'instellingen', 'config');

function dateText(value) {
  if (!value) return 'Nog niet bekend';

  const parts = value.split('-');
  if (parts.length !== 3) return value;

  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function money(value) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR'
  }).format(Number(value) || 0);
}

function deadlineTimestamp(value) {
  if (!value) return null;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 23, 59, 59, 999);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw Error('Ongeldige deadline.');
  }

  return Timestamp.fromDate(date);
}

function deadlineOpen() {
  const value = activeEvent?.deadlineAt;
  return !!value && value.toMillis() >= Date.now();
}

function cleanLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Error('Gebruik een volledige link die begint met https://');
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw Error('Alleen http- en https-links zijn toegestaan.');
  }

  url.hash = '';
  return url.href;
}

function wishContent(wish) {
  const wrap = el('div', undefined, 'wish-content');
  wrap.append(el('strong', wish.text || ''));

  if (wish.url) {
    try {
      const link = el('a', 'Bekijk cadeau');
      link.href = cleanLink(wish.url);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      wrap.append(link);
    } catch {
      // Ongeldige oude links niet tonen.
    }
  }

  return wrap;
}

function wishesOf(person) {
  return Array.isArray(person?.wishes) ? person.wishes : [];
}

function linkFor(id, personalToken) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('e', id);
  url.searchParams.set('t', personalToken);
  return url.href;
}

function setup() {
  $('showLogin').onclick = () => show('login');
  $('backHome').onclick = () => show('home');

  $('loginBtn').onclick = async () => {
    try {
      status('Inloggen…');
      await signInWithEmailAndPassword(
        auth,
        $('email').value.trim(),
        $('password').value
      );
      await startAdmin();
    } catch (error) {
      fail(error);
    }
  };

  $('logout').onclick = async () => {
    await signOut(auth);
    location.href = location.pathname;
  };

  $('createEvent').onclick = createEvent;
  $('saveEventDetails').onclick = saveEventDetails;
  $('saveExclusions').onclick = saveExclusions;
  $('drawBtn').onclick = draw;
  $('deleteEvent').onclick = deleteEvent;

  $('showDrawResults').onclick = () => {
    const box = $('drawResults');
    const opening = box.classList.contains('hidden');

    box.classList.toggle('hidden', !opening);
    $('showDrawResults').textContent = opening
      ? 'Verberg trekkingsresultaten'
      : 'Bekijk trekkingsresultaten';

    if (opening) renderDrawResults();
  };

  $('addWish').onclick = addWish;
  $('newWish').onkeydown = event => {
    if (event.key === 'Enter') addWish();
  };

  $('revealBtn').onclick = reveal;
  $('refreshLists').onclick = refreshParticipant;
}

/* ===========================
   ORGANISATOR
=========================== */

async function startAdmin() {
  if (auth.currentUser?.uid !== ADMIN_UID) {
    show('home');
    status('Alleen de organisator kan inloggen.');
    return;
  }

  show('admin');
  status('Beheerdersomgeving');
  await loadEvents();
}

async function loadEvents() {
  const target = $('events');
  target.replaceChildren();

  const snapshot = await getDocs(query(
    collection(db, 'trekkingen'),
    where('owner', '==', ADMIN_UID)
  ));

  const events = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  events.sort((a, b) =>
    (b.createdAt?.toMillis?.() || 0) -
    (a.createdAt?.toMillis?.() || 0)
  );

  if (!events.length) {
    target.append(el('p', 'Nog geen vieringen.', 'muted'));
  }

  for (const event of events) {
    const button = el(
      'button',
      `${event.naam} · ${
        event.status === 'definitief' ? 'Definitief' : 'Concept'
      }`,
      'secondary'
    );

    button.onclick = () => manageEvent(event.id);
    target.append(button);
  }
}

async function createEvent() {
  try {
    const name = $('eventName').value.trim();
    const participants = names($('adultNames').value);
    const deadline = $('eventDeadline').value;

    if (!name) throw Error('Vul de naam van de viering in.');
    if (participants.length < 2) {
      throw Error('Vul minimaal twee deelnemers in.');
    }
    if (participants.length > 70) {
      throw Error('Maximaal 70 deelnemers per viering.');
    }
    if (!deadline) {
      throw Error('Kies een deadline voor de verlanglijstjes.');
    }

    const deadlineAt = deadlineTimestamp(deadline);
    if (deadlineAt.toMillis() < Date.now()) {
      throw Error('Kies een deadline die nog niet verstreken is.');
    }

    const id = rid();
    const batch = writeBatch(db);

    batch.set(eventRef(id), {
      owner: ADMIN_UID,
      naam: name,
      datum: $('eventDate').value,
      tijd: $('eventTime').value,
      locatie: $('eventLocation').value.trim(),
      bedrag: Number($('eventBudget').value) || 0,
      info: $('eventInfo').value.trim(),
      deadline,
      deadlineAt,
      status: 'concept',
      createdAt: serverTimestamp()
    });

    for (const naam of participants) {
      const personId = rid();
      const personalToken = rid();

      batch.set(personRef(id, personId), {
        naam,
        kind: false,
        wishes: []
      });

      batch.set(keyRef(id, personalToken), {
        participantId: personId,
        eventId: id
      });
    }

    batch.set(configRef(id), { exclusions: [] });

    await batch.commit();

    status('Viering aangemaakt.');
    await loadEvents();
    await manageEvent(id);
  } catch (error) {
    fail(error);
  }
}

async function manageEvent(id) {
  try {
    selectedEvent = id;

    const eventSnapshot = await getDoc(eventRef(id));
    if (!eventSnapshot.exists()) {
      throw Error('Viering niet gevonden.');
    }

    activeEvent = eventSnapshot.data();

    const [personSnapshot, keySnapshot, configSnapshot, secretSnapshot] =
      await Promise.all([
        getDocs(collection(db, 'trekkingen', id, 'personen')),
        getDocs(collection(db, 'trekkingen', id, 'sleutels')),
        getDoc(configRef(id)),
        getDocs(collection(db, 'trekkingen', id, 'geheimen'))
      ]);

    people = sortPeople(personSnapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    })));

    keys = keySnapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    secrets = secretSnapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    exclusionSet = new Set(
      (configSnapshot.data()?.exclusions || [])
        .map(x => x.from + '|' + x.to)
    );

    $('manage').classList.remove('hidden');
    $('manageTitle').textContent = activeEvent.naam;

    $('manageDetails').textContent = [
      dateText(activeEvent.datum),
      activeEvent.tijd,
      activeEvent.locatie,
      money(activeEvent.bedrag),
      activeEvent.status === 'definitief'
        ? 'Definitief' : 'Concept'
    ].filter(Boolean).join(' · ');

    $('editEventName').value = activeEvent.naam || '';
    $('editEventDate').value = activeEvent.datum || '';
    $('editEventTime').value = activeEvent.tijd || '';
    $('editEventLocation').value = activeEvent.locatie || '';
    $('editEventBudget').value = activeEvent.bedrag ?? 0;
    $('editEventInfo').value = activeEvent.info || '';
    $('editEventDeadline').value = activeEvent.deadline || '';

    $('drawResults').classList.add('hidden');
    $('showDrawResults').textContent = 'Bekijk trekkingsresultaten';

    renderAdminParticipants();
    renderParticipantManagement();
    renderExclusions();
    renderLinks();

    $('drawBtn').disabled = activeEvent.status === 'definitief';
    $('saveExclusions').disabled =
      activeEvent.status === 'definitief';

    $('manage').scrollIntoView({ behavior: 'smooth' });
    status('Viering geopend.');
  } catch (error) {
    fail(error);
  }
}

function renderAdminParticipants() {
  const target = $('adminParticipants');
  target.replaceChildren();

  for (const person of people) {
    const row = el('div', undefined, 'item');
    const personalToken = keys.find(
      key => key.participantId === person.id
    )?.id;

    const secret = secrets.find(
      item => item.id === personalToken
    );

    const opened = secret?.opened === true;

    row.append(el('strong', person.naam));

    row.append(el(
      'p',
      `${wishesOf(person).length} wensen · ${
        activeEvent.status !== 'definitief'
          ? 'Nog niet getrokken'
          : !secret
          ? 'Geen lootje'
          : opened
          ? 'Lootje geopend'
          : 'Lootje nog gesloten'
      }`,
      'hint'
    ));

    const details = el('details');
    const summary = el('summary', 'Bekijk verlanglijstje');
    details.append(summary);

    const list = wishesOf(person);

    if (!list.length) {
      details.append(el('p', 'Nog geen wensen.', 'muted'));
    }

    for (const wish of list) {
      const item = el('div', undefined, 'item');
      item.append(wishContent(wish));
      details.append(item);
    }

    row.append(details);
    target.append(row);
  }
}

function renderParticipantManagement() {
  const target = $('participantManagement');
  target.replaceChildren();

  if (activeEvent.status !== 'concept') {
    target.append(el(
      'p',
      'Na de definitieve trekking staan de deelnemers vast.',
      'hint'
    ));
    return;
  }

  const input = el('input');
  input.placeholder = 'Naam nieuwe deelnemer';

  const add = el('button', 'Deelnemer toevoegen', 'secondary');
  add.onclick = async () => {
    try {
      const name = input.value.trim();

      if (!name) throw Error('Vul een naam in.');

      if (people.some(p =>
        p.naam.toLocaleLowerCase('nl') ===
        name.toLocaleLowerCase('nl')
      )) {
        throw Error('Deze deelnemer bestaat al.');
      }

      if (people.length >= 70) {
        throw Error('Maximaal 70 deelnemers.');
      }

      const personId = rid();
      const personalToken = rid();
      const batch = writeBatch(db);

      batch.set(personRef(selectedEvent, personId), {
        naam: name,
        kind: false,
        wishes: []
      });

      batch.set(keyRef(selectedEvent, personalToken), {
        participantId: personId,
        eventId: selectedEvent
      });

      await batch.commit();
      await manageEvent(selectedEvent);
      status('Deelnemer toegevoegd.');
    } catch (error) {
      fail(error);
    }
  };

  target.append(input, add);

  for (const person of people) {
    const row = el('div', undefined, 'item');
    row.append(el('strong', person.naam));

    const rename = el('button', 'Naam wijzigen', 'secondary smallbtn');
    rename.onclick = async () => {
      const newName = prompt('Nieuwe naam:', person.naam);
      if (newName === null) return;

      try {
        const name = newName.trim();
        if (!name) throw Error('Een naam mag niet leeg zijn.');

        if (people.some(p =>
          p.id !== person.id &&
          p.naam.toLocaleLowerCase('nl') ===
          name.toLocaleLowerCase('nl')
        )) {
          throw Error('Deze naam bestaat al.');
        }

        await updateDoc(personRef(selectedEvent, person.id), {
          naam: name
        });

        await manageEvent(selectedEvent);
      } catch (error) {
        fail(error);
      }
    };

    const remove = el('button', 'Verwijderen', 'warn smallbtn');
    remove.onclick = async () => {
      if (people.length <= 2) {
        fail(Error('Er moeten minimaal twee deelnemers overblijven.'));
        return;
      }

      if (!confirm(`Deelnemer ${person.naam} verwijderen?`)) return;

      try {
        const personalToken = keys.find(
          key => key.participantId === person.id
        )?.id;

        const batch = writeBatch(db);

        batch.delete(personRef(selectedEvent, person.id));

        if (personalToken) {
          batch.delete(keyRef(selectedEvent, personalToken));
        }

        await batch.commit();

        exclusionSet = new Set(
          [...exclusionSet].filter(value =>
            !value.split('|').includes(person.id)
          )
        );

        await setDoc(configRef(selectedEvent), {
          exclusions: [...exclusionSet].map(value => {
            const [from, to] = value.split('|');
            return { from, to };
          })
        });

        await manageEvent(selectedEvent);
        status('Deelnemer verwijderd.');
      } catch (error) {
        fail(error);
      }
    };

    row.append(document.createTextNode(' '), rename, remove);
    target.append(row);
  }
}

function renderExclusions() {
  const target = $('exclusions');
  target.replaceChildren();

  const adults = people.filter(p => !p.kind);

  for (const person of adults) {
    const group = el('div', undefined, 'item');
    group.append(el('strong', `${person.naam} mag niet trekken:`));

    for (const other of adults.filter(p => p.id !== person.id)) {
      const label = el('label');
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.style.width = 'auto';

      const key = `${person.id}|${other.id}`;
      checkbox.checked = exclusionSet.has(key);
      checkbox.disabled = activeEvent.status === 'definitief';

      checkbox.onchange = () => {
        if (checkbox.checked) exclusionSet.add(key);
        else exclusionSet.delete(key);
      };

      label.append(checkbox, document.createTextNode(' ' + other.naam));
      group.append(label);
    }

    target.append(group);
  }
}

function renderLinks() {
  const target = $('links');
  target.replaceChildren();

  for (const person of people) {
    const key = keys.find(k => k.participantId === person.id);
    if (!key) continue;

    const url = linkFor(selectedEvent, key.id);
    const row = el('div', undefined, 'item');

    row.append(el('strong', person.naam));
    row.append(el('div', url, 'linkbox'));

    const copy = el('button', 'Kopieer link', 'secondary smallbtn');
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        status(`Link van ${person.naam} gekopieerd.`);
      } catch {
        prompt('Kopieer de link:', url);
      }
    };

    row.append(copy);
    target.append(row);
  }
}

async function saveEventDetails() {
  try {
    if (!selectedEvent) throw Error('Geen viering geselecteerd.');

    const name = $('editEventName').value.trim();
    if (!name) throw Error('Vul een naam in.');

    const deadline = $('editEventDeadline').value;

    await updateDoc(eventRef(selectedEvent), {
      naam: name,
      datum: $('editEventDate').value,
      tijd: $('editEventTime').value,
      locatie: $('editEventLocation').value.trim(),
      bedrag: Number($('editEventBudget').value) || 0,
      info: $('editEventInfo').value.trim(),
      deadline,
      deadlineAt: deadlineTimestamp(deadline)
    });

    await loadEvents();
    await manageEvent(selectedEvent);
    status('Vieringsinformatie opgeslagen.');
  } catch (error) {
    fail(error);
  }
}

async function saveExclusions() {
  try {
    if (activeEvent.status !== 'concept') {
      throw Error('Deze trekking is definitief.');
    }

    const exclusions = [...exclusionSet].map(value => {
      const [from, to] = value.split('|');
      return { from, to };
    });

    await setDoc(configRef(selectedEvent), { exclusions });
    status('Uitsluitingen opgeslagen.');
  } catch (error) {
    fail(error);
  }
}

function shuffle(list) {
  const result = [...list];

  for (let i = result.length - 1; i > 0; i--) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const j = random[0] % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function findDraw(participants, excluded) {
  const givers = shuffle(participants);
  const receivers = shuffle(participants);

  const options = new Map();

  for (const giver of givers) {
    options.set(
      giver.id,
      shuffle(receivers.filter(receiver =>
        receiver.id !== giver.id &&
        !excluded.has(`${giver.id}|${receiver.id}`)
      ))
    );
  }

  const matched = new Map();

  function assign(giverId, visited) {
    for (const receiver of options.get(giverId)) {
      if (visited.has(receiver.id)) continue;
      visited.add(receiver.id);

      const previous = matched.get(receiver.id);

      if (!previous || assign(previous, visited)) {
        matched.set(receiver.id, giverId);
        return true;
      }
    }

    return false;
  }

  for (const giver of givers) {
    if (!assign(giver.id, new Set())) return null;
  }

  const result = {};

  for (const [receiverId, giverId] of matched) {
    result[giverId] = receiverId;
  }

  return result;
}

async function draw() {
  try {
    if (!selectedEvent || activeEvent.status !== 'concept') {
      throw Error('Deze trekking is al definitief.');
    }

    const adults = people.filter(p => !p.kind);

    if (adults.length < 2) {
      throw Error('Minimaal twee deelnemers nodig.');
    }

    // Eerst de opgeslagen uitsluitingen ophalen.
    const config = await getDoc(configRef(selectedEvent));
    const savedExclusions = new Set(
      (config.data()?.exclusions || [])
        .map(x => `${x.from}|${x.to}`)
    );

    if (
      [...savedExclusions].sort().join(',') !==
      [...exclusionSet].sort().join(',')
    ) {
      throw Error('Sla eerst je gewijzigde uitsluitingen op.');
    }

    const assignment = findDraw(adults, savedExclusions);

    if (!assignment) {
      throw Error(
        'Met deze uitsluitingen is geen geldige trekking mogelijk.'
      );
    }

    if (!confirm(
      'De trekking wordt definitief. Hierna kun je de uitslag niet wijzigen. Doorgaan?'
    )) return;

    const fresh = await getDoc(eventRef(selectedEvent));

    if (fresh.data()?.status !== 'concept') {
      throw Error('De trekking is inmiddels al uitgevoerd.');
    }

    const batch = writeBatch(db);

    for (const key of keys) {
      if (!assignment[key.participantId]) continue;

      batch.set(secretRef(selectedEvent, key.id), {
        participantId: key.participantId,
        recipientId: assignment[key.participantId],
        opened: false
      });
    }

    batch.update(eventRef(selectedEvent), {
      status: 'definitief'
    });

    await batch.commit();

    await manageEvent(selectedEvent);
    status('De trekking is definitief uitgevoerd.');
  } catch (error) {
    fail(error);
  }
}

function renderDrawResults() {
  const target = $('drawResults');
  target.replaceChildren();

  if (activeEvent.status !== 'definitief') {
    target.append(el('p', 'De trekking is nog niet uitgevoerd.'));
    return;
  }

  for (const secret of secrets) {
    const giver = people.find(
      p => p.id === secret.participantId
    );
    const receiver = people.find(
      p => p.id === secret.recipientId
    );

    if (!giver || !receiver) continue;

    const row = el('div', undefined, 'item');

    row.append(el(
      'strong',
      `${giver.naam} → ${receiver.naam}`
    ));

    row.append(el(
      'p',
      secret.opened === true
        ? 'Envelop geopend'
        : 'Envelop nog gesloten',
      'hint'
    ));

    target.append(row);
  }
}

async function deleteEvent() {
  if (!selectedEvent) return;

  const name = activeEvent.naam;

  if (!confirm(
    `Wil je "${name}" definitief verwijderen, inclusief alle persoonlijke links en verlanglijstjes?`
  )) return;

  const answer = prompt(
    `Typ VERWIJDER om "${name}" definitief te verwijderen.`
  );

  if (answer !== 'VERWIJDER') return;

  try {
    status('Viering verwijderen…');

    const subcollections = [
      'personen',
      'sleutels',
      'leden',
      'geheimen',
      'instellingen',
      'reserveringen',
      'reserveringslog'
    ];

    // Kleine batches om de Firestore-limiet te respecteren.
    for (const name of subcollections) {
      const snapshot = await getDocs(
        collection(db, 'trekkingen', selectedEvent, name)
      );

      for (let i = 0; i < snapshot.docs.length; i += 200) {
        const batch = writeBatch(db);

        for (const item of snapshot.docs.slice(i, i + 200)) {
          batch.delete(item.ref);
        }

        await batch.commit();
      }
    }

    await deleteDoc(eventRef(selectedEvent));

    selectedEvent = null;
    $('manage').classList.add('hidden');
    await loadEvents();
    status('Viering definitief verwijderd.');
  } catch (error) {
    fail(error);
  }
}

/* ===========================
   DEELNEMER
=========================== */

async function startParticipant() {
  try {
    if (!eventId || !token) {
      throw Error('Persoonlijke link ontbreekt.');
    }

    status('Persoonlijke link openen…');

    const keySnapshot = await getDoc(keyRef(eventId, token));

    if (
      !keySnapshot.exists() ||
      keySnapshot.data().eventId !== eventId
    ) {
      throw Error('Deze persoonlijke link is ongeldig.');
    }

    const personId = keySnapshot.data().participantId;

    // Dit vervangt een eventuele oude koppeling.
    // Daardoor kan dezelfde browser een andere link openen.
    await setDoc(memberRef(eventId, auth.currentUser.uid), {
      token,
      participantId: personId,
      eventId
    });

    const [eventSnapshot, personSnapshot] = await Promise.all([
      getDoc(eventRef(eventId)),
      getDoc(personRef(eventId, personId))
    ]);

    if (!eventSnapshot.exists()) {
      throw Error('Deze viering bestaat niet meer.');
    }

    if (!personSnapshot.exists()) {
      throw Error('Deze deelnemer bestaat niet meer.');
    }

    activeEvent = eventSnapshot.data();
    myPerson = {
      id: personSnapshot.id,
      ...personSnapshot.data()
    };

    mySecret = null;
    recipient = null;

    show('participant');

    await refreshParticipant();
    status(`Welkom, ${myPerson.naam}!`);
  } catch (error) {
    fail(error);
    show('home');
  }
}

function eventInformation() {
  const target = $('eventIntro');
  target.replaceChildren();

  target.append(el('div', 'JE BENT UITGENODIGD', 'eyebrow'));
  target.append(el('h2', `Welkom, ${myPerson.naam}!`));
  target.append(el('h3', activeEvent.naam));

  const details = [
    ['Datum', dateText(activeEvent.datum)],
    ['Tijd', activeEvent.tijd
      ? activeEvent.tijd.replace(':', '.') + ' uur'
      : 'Nog niet bekend'],
    ['Locatie', activeEvent.locatie || 'Nog niet bekend'],
    ['Cadeaubudget', money(activeEvent.bedrag)],
    ['Deadline verlanglijstje',
      activeEvent.deadline
        ? dateText(activeEvent.deadline)
        : 'Nog niet ingesteld']
  ];

  for (const [label, value] of details) {
    const line = el('p');
    line.append(el('strong', label + ': '));
    line.append(document.createTextNode(value));
    target.append(line);
  }

  if (activeEvent.info) {
    const info = el('p');
    info.append(el('strong', 'Extra informatie: '));
    info.append(document.createTextNode(activeEvent.info));
    target.append(info);
  }
}

async function refreshParticipant() {
  if (refreshing) return;
  refreshing = true;

  try {
    const [eventSnapshot, personSnapshot] = await Promise.all([
      getDoc(eventRef(eventId)),
      getDoc(personRef(eventId, myPerson.id))
    ]);

    if (!eventSnapshot.exists() || !personSnapshot.exists()) {
      throw Error('Deze viering of deelnemer bestaat niet meer.');
    }

    activeEvent = eventSnapshot.data();
    myPerson = {
      id: personSnapshot.id,
      ...personSnapshot.data()
    };

    eventInformation();
    renderOwnWishes();

    const open = deadlineOpen();

    $('wishEditor').classList.toggle('hidden', !open);

    $('wishHint').textContent = !activeEvent.deadlineAt
      ? 'De organisator moet eerst een deadline instellen.'
      : !open
      ? 'De deadline is verstreken. Je kunt je wensen niet meer aanpassen.'
      : 'Voeg minimaal drie wensen toe om je lootje te openen.';

    // Een geopend geheim mag opnieuw worden gelezen.
    // Een gesloten geheim mag niet worden opgevraagd.
    if (activeEvent.status === 'definitief') {
      try {
        const snapshot = await getDoc(secretRef(eventId, token));

        if (snapshot.exists() && snapshot.data().opened === true) {
          mySecret = snapshot.data();
        }
      } catch (error) {
        if (error.code !== 'permission-denied') throw error;
      }
    }

    await renderReveal();
  } catch (error) {
    fail(error);
  } finally {
    refreshing = false;
  }
}

function renderOwnWishes() {
  const target = $('myWishes');
  target.replaceChildren();

  const list = wishesOf(myPerson);
  const editable = deadlineOpen();

  if (!list.length) {
    target.append(el(
      'p',
      'Je hebt nog geen wensen toegevoegd.',
      'muted'
    ));
  }

  for (const wish of list) {
    const row = el('div', undefined, 'wish item');
    row.append(wishContent(wish));

    if (editable) {
      const actions = el('div', undefined, 'wish-actions');

      const edit = el('button', 'Wijzig', 'secondary smallbtn');
      edit.onclick = () => editWish(wish);

      const remove = el('button', 'Verwijder', 'warn smallbtn');
      remove.onclick = () => removeWish(wish.id);

      actions.append(edit, remove);
      row.append(actions);
    }

    target.append(row);
  }

  const count = el(
    'p',
    `${list.length} ${
      list.length === 1 ? 'wens' : 'wensen'
    } toegevoegd`,
    'hint'
  );

  target.prepend(count);
}

async function updateWishes(nextWishes) {
  if (!deadlineOpen()) {
    throw Error('De deadline voor verlanglijstjes is verstreken.');
  }

  await updateDoc(personRef(eventId, myPerson.id), {
    wishes: nextWishes
  });

  await refreshParticipant();
}

async function addWish() {
  try {
    const description = $('newWish').value.trim();
    const url = cleanLink($('newWishUrl').value);

    if (!description) {
      throw Error('Vul een cadeauomschrijving in.');
    }

    if (description.length > 160) {
      throw Error('Maximaal 160 tekens per omschrijving.');
    }

    const list = wishesOf(myPerson);

    if (list.some(w =>
      w.text.trim().toLocaleLowerCase('nl') ===
      description.toLocaleLowerCase('nl')
    )) {
      throw Error('Deze wens staat al op je lijstje.');
    }

    await updateWishes([
      ...list,
      { id: rid(), text: description, url }
    ]);

    $('newWish').value = '';
    $('newWishUrl').value = '';

    status('Wens toegevoegd.');
  } catch (error) {
    fail(error);
  }
}

async function editWish(wish) {
  if (!deadlineOpen()) {
    fail(Error('De deadline is verstreken.'));
    return;
  }

  const description = prompt('Cadeauomschrijving:', wish.text);
  if (description === null) return;

  const urlText = prompt(
    'Productlink (mag leeg blijven):',
    wish.url || ''
  );
  if (urlText === null) return;

  try {
    const textValue = description.trim();
    const url = cleanLink(urlText);

    if (!textValue || textValue.length > 160) {
      throw Error('Gebruik een omschrijving van maximaal 160 tekens.');
    }

    const list = wishesOf(myPerson);

    if (list.some(w =>
      w.id !== wish.id &&
      w.text.trim().toLocaleLowerCase('nl') ===
      textValue.toLocaleLowerCase('nl')
    )) {
      throw Error('Deze wens staat al op je lijstje.');
    }

    await updateWishes(list.map(item =>
      item.id === wish.id
        ? { ...item, text: textValue, url }
        : item
    ));

    status('Wens gewijzigd.');
  } catch (error) {
    fail(error);
  }
}

async function removeWish(wishId) {
  try {
    await updateWishes(
      wishesOf(myPerson).filter(w => w.id !== wishId)
    );

    status('Wens verwijderd.');
  } catch (error) {
    fail(error);
  }
}

async function reveal() {
  try {
    if (activeEvent.status !== 'definitief') {
      throw Error('De trekking is nog niet uitgevoerd.');
    }

    if (wishesOf(myPerson).length < 3) {
      throw Error('Voeg eerst minimaal drie wensen toe.');
    }

    status('Je envelop openen…');

    // De ontvanger is nog niet leesbaar.
    // Deze update registreert eerst de echte onthulling.
    await updateDoc(secretRef(eventId, token), {
      opened: true,
      openedAt: serverTimestamp()
    });

    const snapshot = await getDoc(secretRef(eventId, token));

    if (!snapshot.exists()) {
      throw Error('Je lootje kon niet worden geopend.');
    }

    mySecret = snapshot.data();
    await renderReveal();

    status('Je lootje is geopend!');
  } catch (error) {
    fail(error);
  }
}

async function renderReveal() {
  const opened = mySecret?.opened === true;
  const enough = wishesOf(myPerson).length >= 3;
  const definitive = activeEvent.status === 'definitief';

  $('envelopeArt').classList.toggle('open', opened);
  $('revealBtn').classList.toggle('hidden', opened);
  $('revealed').classList.toggle('hidden', !opened);
  $('recipientSection').classList.toggle('hidden', !opened);

  if (!opened) {
    $('revealBtn').disabled = !definitive || !enough;

    $('revealText').textContent = !definitive
      ? 'De trekking is nog niet uitgevoerd.'
      : !enough
      ? `Je hebt nog ${
          Math.max(0, 3 - wishesOf(myPerson).length)
        } wensen nodig om je lootje te openen.`
      : 'Je mag je geheime lootje openen!';

    $('revealed').replaceChildren();
    return;
  }

  $('revealText').textContent = 'Jouw geheim is onthuld!';

  const snapshot = await getDoc(
    personRef(eventId, mySecret.recipientId)
  );

  if (!snapshot.exists()) {
    $('revealed').textContent =
      'De ontvanger kon niet worden gevonden.';
    return;
  }

  recipient = {
    id: snapshot.id,
    ...snapshot.data()
  };

  $('revealed').replaceChildren(
    el('h3', `🎁 Jij koopt een cadeau voor ${recipient.naam}!`),
    el(
      'p',
      'Hieronder vind je het verlanglijstje van jouw geheime persoon.'
    )
  );

  renderRecipientWishes();
}

function renderRecipientWishes() {
  const target = $('allWishlists');
  target.replaceChildren();

  if (!recipient) return;

  target.append(el('h3', recipient.naam));

  const list = wishesOf(recipient);

  if (!list.length) {
    target.append(el(
      'p',
      'Er zijn nog geen wensen toegevoegd. Kom later nog eens kijken.',
      'muted'
    ));
    return;
  }

  for (const wish of list) {
    const row = el('div', undefined, 'wish-list-row');
    row.append(wishContent(wish));
    target.append(row);
  }
}

/* ===========================
   START
=========================== */

setup();

onAuthStateChanged(auth, async user => {
  try {
    if (eventId && token) {
      if (!user) {
        await signInAnonymously(auth);
      } else {
        await startParticipant();
      }
    } else if (user?.uid === ADMIN_UID) {
      await startAdmin();
    } else {
      show('home');
      status('Welkom bij Lootjes');
    }
  } catch (error) {
    fail(error);
  }
});
