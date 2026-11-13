
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
  writeBatch,
  runTransaction,
  query,
  where,
  serverTimestamp
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

let activeEvent = null;
let people = [];
let myPerson = null;
let myMember = null;
let mySecret = null;
let selectedEvent = null;
let exclusionSet = new Set();
let reservations = [];
let refreshing = false;

const el = (tag, txt, cls) => {
  const node = document.createElement(tag);
  if (txt !== undefined) node.textContent = txt;
  if (cls) node.className = cls;
  return node;
};

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
  return [...new Set(
    value.split('\n').map(x => x.trim()).filter(Boolean)
  )];
}

function sortedPeople(list) {
  return list.sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

const eventRef = id =>
  doc(db, 'trekkingen', id);

const personRef = (id, personId) =>
  doc(db, 'trekkingen', id, 'personen', personId);

const memberRef = (id, uid) =>
  doc(db, 'trekkingen', id, 'leden', uid);

const keyRef = (id, key) =>
  doc(db, 'trekkingen', id, 'sleutels', key);

const secretRef = (id, key) =>
  doc(db, 'trekkingen', id, 'geheimen', key);

const reservationRef = (id, wishId) =>
  doc(db, 'trekkingen', id, 'reserveringen', wishId);

function formatDate(value) {
  if (!value) return 'Datum volgt';

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function formatBudget(value) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR'
  }).format(Number(value) || 0);
}

function formatTime(value) {
  if (!value) return '';
  return String(value).replace(':', '.') + ' uur';
}

function cleanLink(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let url;

  try {
    url = new URL(raw);
  } catch {
    throw Error('Gebruik een volledige productlink, beginnend met https://');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Error('Alleen http- en https-links zijn toegestaan.');
  }

  url.hash = '';
  return url.href;
}

function wishContent(wish) {
  const wrap = el('div');
  wrap.className = 'wish-content';

  wrap.append(el('strong', wish.text || ''));

  if (wish.url) {
    try {
      const safeUrl = cleanLink(wish.url);

      if (safeUrl) {
        const link = el('a', 'Bekijk cadeau');
        link.href = safeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        wrap.append(link);
      }
    } catch {
      // Een oude ongeldige link wordt niet klikbaar gemaakt.
    }
  }

  return wrap;
}

function loginSetup() {
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
}

async function startAdmin() {
  if (auth.currentUser?.uid !== ADMIN_UID) {
    show('home');
    status('Alleen de organisator kan hier inloggen.');
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

  if (snapshot.empty) {
    target.append(el('p', 'Nog geen trekkingen.', 'muted'));
  }

  snapshot.forEach(item => {
    const data = item.data();

    const button = el(
      'button',
      `${data.naam} · ${data.status === 'definitief' ? 'Definitief' : 'Concept'}`,
      'secondary'
    );

    button.onclick = () => manageEvent(item.id);
    target.append(button);
  });
}

async function createEvent() {
  try {
    const adults = names($('adultNames').value);
    const children = names($('childNames').value);
    const eventName = $('eventName').value.trim();

    if (!eventName || adults.length < 2) {
      throw Error('Vul een naam en minimaal twee deelnemers in.');
    }

    const allNames = [...adults, ...children];

    if (
      new Set(allNames.map(x => x.toLocaleLowerCase('nl'))).size
      !== allNames.length
    ) {
      throw Error('Namen moeten uniek zijn.');
    }

    if (allNames.length > 70) {
      throw Error('Maximaal 70 personen per trekking.');
    }

    const id = rid();
    const batch = writeBatch(db);

    batch.set(eventRef(id), {
      owner: ADMIN_UID,
      naam: eventName,
      datum: $('eventDate').value,
      tijd: $('eventTime').value,
      locatie: $('eventLocation').value.trim(),
      bedrag: Number($('eventBudget').value) || 0,
      info: $('eventInfo').value.trim(),
      status: 'concept',
      createdAt: serverTimestamp()
    });

    const entries = [
      ...adults.map(naam => ({ naam, kind: false })),
      ...children.map(naam => ({ naam, kind: true }))
    ];

    for (const person of entries) {
      const personId = rid();
      const personalKey = rid();

      batch.set(personRef(id, personId), {
        naam: person.naam,
        kind: person.kind,
        wishes: []
      });

      batch.set(keyRef(id, personalKey), {
        participantId: personId,
        eventId: id
      });
    }

    batch.set(
      doc(db, 'trekkingen', id, 'instellingen', 'config'),
      { exclusions: [] }
    );

    await batch.commit();

    status('Trekking aangemaakt.');
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
      throw Error('Trekking niet gevonden.');
    }

    activeEvent = eventSnapshot.data();

    const peopleSnapshot = await getDocs(
      collection(db, 'trekkingen', id, 'personen')
    );

    people = sortedPeople(
      peopleSnapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }))
    );

    const configSnapshot = await getDoc(
      doc(db, 'trekkingen', id, 'instellingen', 'config')
    );

    exclusionSet = new Set(
      (configSnapshot.data()?.exclusions || [])
        .map(x => x.from + '|' + x.to)
    );

    $('manage').classList.remove('hidden');

    $('manageTitle').textContent = activeEvent.naam;

    $('manageDetails').textContent = [
      formatDate(activeEvent.datum),
      activeEvent.tijd ? formatTime(activeEvent.tijd) : '',
      activeEvent.locatie || '',
      formatBudget(activeEvent.bedrag),
      activeEvent.status
    ].filter(Boolean).join(' · ');

    $('editEventName').value = activeEvent.naam || '';
    $('editEventDate').value = activeEvent.datum || '';
    $('editEventTime').value = activeEvent.tijd || '';
    $('editEventLocation').value = activeEvent.locatie || '';
    $('editEventBudget').value = activeEvent.bedrag ?? 0;
    $('editEventInfo').value = activeEvent.info || '';

    const exclusions = $('exclusions');
    exclusions.replaceChildren();

    const adults = people.filter(p => !p.kind);

    for (const person of adults) {
      const group = el('div', undefined, 'item');

      group.append(
        el('strong', person.naam + ' mag niet trekken:')
      );

      for (const other of adults.filter(p => p.id !== person.id)) {
        const label = el('label');
        const checkbox = el('input');

        checkbox.type = 'checkbox';
        checkbox.style.width = 'auto';

        const key = person.id + '|' + other.id;

        checkbox.checked = exclusionSet.has(key);
        checkbox.disabled = activeEvent.status === 'definitief';

        checkbox.onchange = () => {
          if (checkbox.checked) {
            exclusionSet.add(key);
          } else {
            exclusionSet.delete(key);
          }
        };

        label.append(
          checkbox,
          document.createTextNode(' ' + other.naam)
        );

        group.append(label);
      }

      exclusions.append(group);
    }

    $('saveExclusions').disabled =
      activeEvent.status === 'definitief';

    $('drawBtn').disabled =
      activeEvent.status === 'definitief';

    const keys = await getDocs(
      collection(db, 'trekkingen', id, 'sleutels')
    );

    const links = $('links');
    links.replaceChildren();

    for (const key of keys.docs) {
      const person = people.find(
        p => p.id === key.data().participantId
      );

      if (!person) continue;

      const url =
        location.origin + location.pathname +
        '?e=' + encodeURIComponent(id) +
        '&t=' + encodeURIComponent(key.id);

      const box = el('div', undefined, 'item');

      box.append(
        el('strong', person.naam + (person.kind ? ' (kind)' : ''))
      );

      box.append(el('div', url, 'linkbox'));

      const copy = el(
        'button',
        'Kopieer link',
        'secondary smallbtn'
      );

      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          status('Link gekopieerd voor ' + person.naam);
        } catch {
          prompt('Kopieer deze link:', url);
        }
      };

      box.append(copy);
      links.append(box);
    }

    $('manage').scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    fail(error);
  }
}

async function saveEventDetails() {
  try {
    if (!selectedEvent) {
      throw Error('Selecteer eerst een trekking.');
    }

    const name = $('editEventName').value.trim();

    if (!name) {
      throw Error('De naam van de viering is verplicht.');
    }

    await updateDoc(eventRef(selectedEvent), {
      naam: name,
      datum: $('editEventDate').value,
      tijd: $('editEventTime').value,
      locatie: $('editEventLocation').value.trim(),
      bedrag: Number($('editEventBudget').value) || 0,
      info: $('editEventInfo').value.trim()
    });

    await manageEvent(selectedEvent);
    await loadEvents();

    status('Vieringsinformatie opgeslagen.');
  } catch (error) {
    fail(error);
  }
}

async function saveExclusions() {
  try {
    if (activeEvent.status !== 'concept') {
      throw Error('De trekking is definitief.');
    }

    const exclusions = [...exclusionSet].map(value => {
      const [from, to] = value.split('|');
      return { from, to };
    });

    await setDoc(
      doc(db, 'trekkingen', selectedEvent, 'instellingen', 'config'),
      { exclusions }
    );

    status('Uitsluitingen opgeslagen.');
  } catch (error) {
    fail(error);
  }
}

function findDraw(adults, excluded) {
  function recurse(index, remaining, result) {
    if (index === adults.length) return result;

    const giver = adults[index];

    const options = remaining
      .filter(person =>
        person.id !== giver.id &&
        !excluded.has(giver.id + '|' + person.id)
      )
      .sort(() => Math.random() - 0.5);

    for (const receiver of options) {
      const found = recurse(
        index + 1,
        remaining.filter(p => p.id !== receiver.id),
        { ...result, [giver.id]: receiver.id }
      );

      if (found) return found;
    }

    return null;
  }

  return recurse(0, [...adults], {});
}

async function draw() {
  try {
    if (activeEvent.status !== 'concept') {
      throw Error('Deze trekking is al definitief.');
    }

    const adults = people.filter(p => !p.kind);

    if (adults.length > 20) {
      throw Error('Meer dan 20 deelnemers wordt nog niet ondersteund.');
    }

    const assignment = findDraw(adults, exclusionSet);

    if (!assignment) {
      throw Error('Met deze uitsluitingen is geen geldige trekking mogelijk.');
    }

    if (!confirm(
      'De trekking wordt definitief. Wil je doorgaan?'
    )) return;

    const keys = await getDocs(
      collection(db, 'trekkingen', selectedEvent, 'sleutels')
    );

    const batch = writeBatch(db);

    for (const key of keys.docs) {
      const personId = key.data().participantId;
      const person = people.find(p => p.id === personId);

      if (person && !person.kind) {
        batch.set(secretRef(selectedEvent, key.id), {
          participantId: personId,
          recipientId: assignment[personId]
        });
      }
    }

    batch.update(eventRef(selectedEvent), {
      status: 'definitief'
    });

    await batch.commit();

    status('Trekking definitief vastgelegd!');
    await manageEvent(selectedEvent);
  } catch (error) {
    fail(error);
  }
}

function eventInformation() {
  const box = $('eventIntro');
  box.replaceChildren();

  box.append(el('h2', `Hoi ${myPerson.naam}!`));
  box.append(el('p', `Viering: ${activeEvent.naam}`));
  box.append(el('p', `Datum: ${formatDate(activeEvent.datum)}`));

  if (activeEvent.tijd) {
    box.append(
      el('p', `Tijd: ${formatTime(activeEvent.tijd)}`)
    );
  }

  if (activeEvent.locatie) {
    box.append(
      el('p', `Locatie: ${activeEvent.locatie}`)
    );
  }

  box.append(
    el('p', `Budget: ${formatBudget(activeEvent.bedrag)}`)
  );

  if (activeEvent.info) {
    box.append(el('p', activeEvent.info));
  }
}

async function startParticipant() {
  try {
    if (!eventId || !token) {
      throw Error('Persoonlijke link ontbreekt.');
    }

    status('Persoonlijke link openen…');

    const key = await getDoc(keyRef(eventId, token));

    if (!key.exists() || key.data().eventId !== eventId) {
      throw Error('Ongeldige persoonlijke link.');
    }

    const uid = auth.currentUser.uid;
    const ref = memberRef(eventId, uid);
    const existing = await getDoc(ref);

    if (!existing.exists()) {
      await setDoc(ref, {
        token,
        participantId: key.data().participantId,
        eventId
      });
    } else if (existing.data().token !== token) {
      throw Error(
        'In deze browser is al een andere persoonlijke link geopend. ' +
        'Gebruik een privévenster of een andere browser.'
      );
    }

    myMember = {
      token,
      participantId: key.data().participantId
    };

    const eventSnapshot = await getDoc(eventRef(eventId));

    if (!eventSnapshot.exists()) {
      throw Error('De trekking bestaat niet.');
    }

    activeEvent = eventSnapshot.data();

    const snapshot = await getDocs(
      collection(db, 'trekkingen', eventId, 'personen')
    );

    people = sortedPeople(
      snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }))
    );

    myPerson = people.find(
      p => p.id === myMember.participantId
    );

    if (!myPerson) {
      throw Error('Deelnemer niet gevonden.');
    }

    show('participant');
    eventInformation();

    $('addWish').onclick = addWish;

    $('newWish').onkeydown = event => {
      if (event.key === 'Enter') addWish();
    };

    $('revealBtn').onclick = reveal;
    $('refreshLists').onclick = refreshParticipant;

    // Bestaande, definitieve trekking automatisch herkennen.
    mySecret = null;

    if (
      !myPerson.kind &&
      activeEvent.status === 'definitief'
    ) {
      const secret = await getDoc(secretRef(eventId, token));

      if (secret.exists()) {
        mySecret = secret.data();
      }
    }

    await refreshParticipant();

    status('Welkom, ' + myPerson.naam + '!');
  } catch (error) {
    fail(error);
    show('home');
  }
}

async function loadReservations() {
  reservations = [];

  // Alleen reserveringen van kinderen zijn nog relevant.
  const childWishes = people
    .filter(person => person.kind)
    .flatMap(person =>
      (person.wishes || []).map(wish => ({
        person,
        wish
      }))
    );

  const results = await Promise.all(
    childWishes.map(async ({ wish }) => {
      try {
        const snapshot = await getDoc(
          reservationRef(eventId, wish.id)
        );

        return snapshot.exists()
          ? { id: snapshot.id, ...snapshot.data() }
          : null;
      } catch (error) {
        console.warn(
          'Reservering kon niet worden opgehaald:',
          error
        );
        return null;
      }
    })
  );

  reservations = results.filter(Boolean);
}

async function refreshParticipant() {
  if (refreshing) return;

  refreshing = true;

  try {
    const eventSnapshot = await getDoc(eventRef(eventId));
    if (eventSnapshot.exists()) {
      activeEvent = eventSnapshot.data();
    }

    const snapshot = await getDocs(
      collection(db, 'trekkingen', eventId, 'personen')
    );

    people = sortedPeople(
      snapshot.docs.map(item => ({
        id: item.id,
        ...item.data()
      }))
    );

    myPerson = people.find(
      person => person.id === myMember.participantId
    );

    if (!myPerson) {
      throw Error('Deelnemer niet gevonden.');
    }

    eventInformation();
    await loadReservations();

    const mine = $('myWishes');
    mine.replaceChildren();

    for (const wish of myPerson.wishes || []) {
      const line = el('div', undefined, 'wish item');
      line.append(wishContent(wish));

      const actions = el('div', undefined, 'wish-actions');

      const edit = el(
        'button', 'Wijzig', 'secondary smallbtn'
      );
      edit.onclick = () => editWish(wish);

      const remove = el(
        'button', 'Verwijder', 'warn smallbtn'
      );
      remove.onclick = () => removeWish(wish.id);

      actions.append(edit, remove);
      line.append(actions);
      mine.append(line);
    }

    if (!(myPerson.wishes || []).length) {
      mine.append(
        el('p', 'Je hebt nog geen wensen toegevoegd.', 'muted')
      );
    }

    const enoughWishes =
      (myPerson.wishes || []).length >= 3;

    $('revealCard').classList.toggle(
      'hidden', !!myPerson.kind
    );

    $('revealBtn').disabled =
      myPerson.kind ||
      activeEvent.status !== 'definitief' ||
      !enoughWishes;

    $('revealText').textContent =
      activeEvent.status !== 'definitief'
        ? 'De trekking is nog niet uitgevoerd.'
        : !enoughWishes
        ? 'Voeg eerst minimaal drie wensen toe.'
        : 'Je mag je lootje openen!';

    $('wishHint').textContent = myPerson.kind
      ? 'Voeg cadeaus toe aan dit verlanglijstje. Je hoeft geen lootje te trekken.'
      : 'Voeg minimaal drie wensen toe om jouw geheime lootje te openen.';

    if (mySecret && enoughWishes) {
      renderSecret();
    } else {
      $('revealed').classList.add('hidden');
    }

    renderWishlists();
  } catch (error) {
    fail(error);
  } finally {
    refreshing = false;
  }
}

async function addWish() {
  try {
    const description = $('newWish').value.trim();
    const url = cleanLink($('newWishUrl').value);

    if (!description) {
      throw Error('Vul een cadeauomschrijving in.');
    }

    if (description.length > 160) {
      throw Error('Maximaal 160 tekens per wens.');
    }

    const list = myPerson.wishes || [];

    if (list.length >= 30) {
      throw Error('Maximaal 30 wensen.');
    }

    const duplicate = list.some(wish =>
      wish.text.trim().toLocaleLowerCase('nl') ===
        description.toLocaleLowerCase('nl') ||
      (url && wish.url && cleanLink(wish.url) === url)
    );

    if (duplicate) {
      throw Error('Dit cadeau of deze link staat al op het lijstje.');
    }

    await updateDoc(personRef(eventId, myPerson.id), {
      wishes: [
        ...list,
        { id: rid(), text: description, url }
      ]
    });

    $('newWish').value = '';
    $('newWishUrl').value = '';

    await refreshParticipant();
    status('Wens toegevoegd.');
  } catch (error) {
    fail(error);
  }
}

async function editWish(wish) {
  const description = prompt(
    'Cadeauomschrijving:', wish.text
  );

  if (description === null) return;

  const urlText = prompt(
    'Productlink (mag leeg blijven):', wish.url || ''
  );

  if (urlText === null) return;

  try {
    const textValue = description.trim();
    const url = cleanLink(urlText);

    if (!textValue || textValue.length > 160) {
      throw Error(
        'Vul een omschrijving van maximaal 160 tekens in.'
      );
    }

    const list = myPerson.wishes || [];

    const duplicate = list.some(item =>
      item.id !== wish.id && (
        item.text.trim().toLocaleLowerCase('nl') ===
          textValue.toLocaleLowerCase('nl') ||
        (url && item.url && cleanLink(item.url) === url)
      )
    );

    if (duplicate) {
      throw Error('Dit cadeau of deze link staat al op het lijstje.');
    }

    await updateDoc(personRef(eventId, myPerson.id), {
      wishes: list.map(item =>
        item.id === wish.id
          ? { ...item, text: textValue, url }
          : item
      )
    });

    await refreshParticipant();
    status('Wens gewijzigd.');
  } catch (error) {
    fail(error);
  }
}

async function removeWish(wishId) {
  try {
    await updateDoc(personRef(eventId, myPerson.id), {
      wishes: (myPerson.wishes || []).filter(
        wish => wish.id !== wishId
      )
    });

    await refreshParticipant();
    status('Wens verwijderd.');
  } catch (error) {
    fail(error);
  }
}

async function reveal() {
  try {
    if ((myPerson.wishes || []).length < 3) {
      throw Error('Voeg eerst minimaal drie wensen toe.');
    }

    const snapshot = await getDoc(
      secretRef(eventId, token)
    );

    if (!snapshot.exists()) {
      throw Error('Je lootje is nog niet beschikbaar.');
    }

    mySecret = snapshot.data();

    renderSecret();
    renderWishlists();

    status('Je lootje is geopend!');
  } catch (error) {
    fail(error);
  }
}

function renderSecret() {
  if (!mySecret) return;

  const person = people.find(
    p => p.id === mySecret.recipientId
  );

  const target = $('revealed');

  target.replaceChildren(
    el(
      'h3',
      `🎁 Jij koopt voor ${person?.naam || 'onbekend'}!`
    ),
    el(
      'p',
      'Bekijk hieronder het verlanglijstje. ' +
      'Dit blijft via je persoonlijke link bereikbaar.'
    )
  );

  target.classList.remove('hidden');
}

function canReserve(person) {
  // Reserveren kan uitsluitend voor kinderen.
  return !!myMember && !!person && person.kind === true;
}

function renderWishlists() {
  const target = $('allWishlists');
  target.replaceChildren();

  const adults = people.filter(p => !p.kind);
  const children = people.filter(p => p.kind);

  function addGroup(title, persons) {
    if (!persons.length) return;

    const heading = el('h3', title, 'group-heading');
    target.append(heading);

    for (const person of persons) {
      const section = el('div', undefined, 'item');
      section.append(el('h3', person.naam));

      const wishes = person.wishes || [];

      if (!wishes.length) {
        section.append(
          el('p', 'Nog geen wensen.', 'muted')
        );
      }

      for (const wish of wishes) {
        const reservation = person.kind
          ? reservations.find(x =>
              x.id === wish.id &&
              x.targetId === person.id
            )
          : null;

        const row = el('div', undefined, 'wish wish-list-row');
        row.append(wishContent(wish));

        if (person.kind) {
          const controls = el(
            'div', undefined, 'reservation-controls'
          );

          const isReserved =
            reservation?.reserved === true;

          const isMine =
            isReserved &&
            reservation.actorUid === auth.currentUser?.uid;

          if (isReserved) {
            controls.append(
              el('span', '✓ Gereserveerd', 'pill')
            );
          }

          if (canReserve(person)) {
            const button = el(
              'button',
              isReserved
                ? (isMine ? 'Vrijgeven' : 'Al gereserveerd')
                : 'Reserveren',
              isReserved
                ? 'secondary smallbtn'
                : 'smallbtn'
            );

            button.disabled = isReserved && !isMine;

            if (!button.disabled) {
              button.onclick = () =>
                reserve(person, wish, !isReserved);
            }

            controls.append(button);
          }

          row.append(controls);
        }

        section.append(row);
      }

      target.append(section);
    }
  }

  addGroup('Alle deelnemers', adults);

  addGroup(
    'Geen deelnemers, wel een verlanglijstje',
    children
  );
}

async function reserve(person, wish, shouldReserve) {
  try {
    if (!canReserve(person)) {
      throw Error('Reserveren kan alleen bij kinderen.');
    }

    const buttonStatus = shouldReserve
      ? 'Cadeau reserveren…'
      : 'Reservering vrijgeven…';

    status(buttonStatus);

    const ref = reservationRef(eventId, wish.id);

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(ref);
      const previous = snapshot.exists()
        ? snapshot.data()
        : null;

      if (shouldReserve) {
        if (previous?.reserved === true) {
          throw Error('Dit cadeau is al gereserveerd.');
        }

        if (snapshot.exists()) {
          transaction.update(ref, {
            reserved: true,
            actorUid: auth.currentUser.uid
          });
        } else {
          transaction.set(ref, {
            targetId: person.id,
            wishId: wish.id,
            reserved: true,
            actorUid: auth.currentUser.uid
          });
        }
      } else {
        if (
          previous?.reserved !== true ||
          previous.actorUid !== auth.currentUser.uid
        ) {
          throw Error(
            'Alleen degene die het cadeau reserveerde kan het vrijgeven.'
          );
        }

        transaction.update(ref, {
          reserved: false
        });
      }
    });

    await refreshParticipant();

    status(
      shouldReserve
        ? 'Cadeau gereserveerd!'
        : 'Reservering vrijgegeven.'
    );
  } catch (error) {
    fail(error);
  }
}

loginSetup();

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
