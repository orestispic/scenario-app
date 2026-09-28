import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const appUrl = new URL(process.env.SCENARIO_TEST_APP_URL ?? 'http://127.0.0.1:1420/');
const allowedHosts = new Set(['127.0.0.1', 'localhost']);

assert.equal(appUrl.protocol, 'http:', 'Le test visuel accepte uniquement une application locale en HTTP.');
assert.ok(allowedHosts.has(appUrl.hostname), 'SCENARIO_TEST_APP_URL doit pointer vers localhost ou 127.0.0.1.');

const outputDirectory = resolve('outputs', 'ui-regression');
const profileDirectory = await mkdtemp(join(tmpdir(), 'senario-ui-regression-'));
const viewports = [
  { name: 'wide', width: 1440, height: 960 },
  { name: 'standard', width: 1024, height: 800 },
  { name: 'compact-desktop', width: 820, height: 720 },
];

const technicalColumns = [
  { id: 'plan', name: 'Plan', kind: 'plan', width: 66, hidden: false },
  { id: 'image', name: 'Image', kind: 'image', width: 80, hidden: false },
  { id: 'description', name: 'Description', kind: 'description', width: 110, hidden: false },
  { id: 'actors', name: 'Acteurs', kind: 'actors', width: 85, hidden: false },
  { id: 'focal', name: 'Focale', kind: 'focal', width: 79, hidden: false },
  { id: 'angle', name: 'Angle', kind: 'angle', width: 72, hidden: false },
  { id: 'shot-size', name: 'Valeur de plan', kind: 'shotSize', width: 129, hidden: false },
  { id: 'dialogue', name: 'Dialogue', kind: 'dialogue', width: 91, hidden: false },
  { id: 'duration', name: 'Durée', kind: 'duration', width: 72, hidden: false },
  { id: 'vfx', name: 'VFX', kind: 'vfx', width: 60, hidden: false },
  { id: 'fps', name: 'IPS', kind: 'fps', width: 60, hidden: false },
  { id: 'notes', name: 'Notes', kind: 'notes', width: 72, hidden: false },
];

function breakdownData(itemsByCategory) {
  const names = ['Personnages', 'Décors', 'Accessoires', 'Costumes', 'Son', 'Besoins spéciaux', 'Notes'];
  return JSON.stringify({
    categories: names.map((name, index) => ({
      id: `native-${index + 1}`,
      name,
      items: (itemsByCategory[name] ?? []).map((item, itemIndex) => ({
        id: `item-${index + 1}-${itemIndex + 1}`,
        name: item.name,
        hue: item.hue,
        secondaryHue: item.secondaryHue ?? null,
      })),
    })),
  });
}

function technicalData(sceneId, shotId, values, withColumns = false) {
  return JSON.stringify({
    version: 1,
    ...(withColumns ? { columns: technicalColumns } : {}),
    shots: [{ id: shotId, sceneId, values }],
    adaptedCells: [],
    imageFitDisabledCells: [],
  });
}

function paragraph(scenarioType, blockId, text, attributes = {}) {
  return {
    type: 'paragraph',
    attrs: {
      scenarioType,
      ending: false,
      blockId,
      whiteboardAct: null,
      whiteboardActCount: null,
      whiteboardActDescriptions: '',
      whiteboardSummary: '',
      whiteboardTag: '',
      whiteboardColor: '',
      breakdownData: '',
      technicalBreakdownData: '',
      ...attributes,
    },
    ...(text ? { content: [{ type: 'text', text }] } : {}),
  };
}

function sceneFixture({ id, title, act, summary, tag, color, action, character, dialogue, breakdown, shot, first = false }) {
  return [
    paragraph('SCENE_HEADING', id, title, {
      whiteboardAct: act,
      ...(first ? {
        whiteboardActCount: 3,
        whiteboardActDescriptions: JSON.stringify(['Mise en place', 'Confrontation', 'Résolution']),
      } : {}),
      whiteboardSummary: summary,
      whiteboardTag: tag,
      whiteboardColor: color,
      breakdownData: breakdownData(breakdown),
      technicalBreakdownData: technicalData(id, `shot-${id}`, shot, first),
    }),
    paragraph('ACTION', `${id}-action`, action),
    paragraph('CHARACTER', `${id}-character`, character),
    paragraph('DIALOGUE', `${id}-dialogue`, dialogue),
  ];
}

const scenarioFixture = {
  formatVersion: 1,
  title: 'Régression UI',
  savedAt: '2026-09-21T10:00:00.000Z',
  content: {
    type: 'doc',
    content: [
      ...sceneFixture({
        id: 'scene-a', title: 'INT. OBSERVATOIRE - NUIT', act: 1,
        summary: 'Maya découvre un signal impossible au cœur de la nuit.', tag: 'Ouverture', color: 'blue',
        action: 'Les écrans de contrôle s’allument les uns après les autres.', character: 'MAYA',
        dialogue: 'Ce signal ne vient pas de notre système.',
        breakdown: {
          Personnages: [{ name: 'Maya', hue: 210 }],
          Décors: [{ name: 'Observatoire', hue: 195 }],
          Accessoires: [{ name: 'Console radio', hue: 42 }],
          Costumes: [{ name: 'Blouson de quart', hue: 225 }],
          Son: [{ name: 'Pulsation radio', hue: 280 }],
          Notes: [{ name: 'Atmosphère nocturne', hue: 205 }],
        },
        shot: { description: 'Travelling vers la console qui s’illumine.', actors: 'MAYA', focal: '35 mm', angle: 'Niveau des yeux', 'shot-size': 'Plan moyen', dialogue: 'Ce signal ne vient pas de notre système.', duration: '8 s', fps: '24', notes: 'Lumière froide progressive.' },
        first: true,
      }),
      ...sceneFixture({
        id: 'scene-b', title: 'EXT. ROUTE DES DÔMES - AUBE', act: 2,
        summary: 'Maya et Elias suivent la source avant le lever du soleil.', tag: 'Poursuite', color: 'amber',
        action: 'La voiture fend le brouillard sur une route déserte.', character: 'ELIAS',
        dialogue: 'On a moins de vingt minutes.',
        breakdown: {
          Personnages: [{ name: 'Maya', hue: 210 }, { name: 'Elias', hue: 28 }],
          Décors: [{ name: 'Route des Dômes', hue: 95 }],
          Accessoires: [{ name: 'Véhicule tout-terrain', hue: 18 }],
          Son: [{ name: 'Moteur sous charge', hue: 12 }],
          'Besoins spéciaux': [{ name: 'Brouillard dense', hue: 190 }],
        },
        shot: { description: 'Plan embarqué sur la route noyée de brume.', actors: 'MAYA, ELIAS', focal: '24 mm', angle: 'Trois-quarts', 'shot-size': 'Plan large', dialogue: 'On a moins de vingt minutes.', duration: '6 s', fps: '24', vfx: 'Extension du brouillard.' },
      }),
      ...sceneFixture({
        id: 'scene-c', title: 'INT. LABORATOIRE ORION - JOUR', act: 2,
        summary: 'Noor révèle que le signal répond aux souvenirs de Maya.', tag: 'Révélation', color: 'red',
        action: 'Une carte céleste se superpose au dossier confidentiel.', character: 'NOOR',
        dialogue: 'Il ne cherche pas une fréquence. Il te cherche, toi.',
        breakdown: {
          Personnages: [{ name: 'Maya', hue: 210 }, { name: 'Noor', hue: 330 }],
          Décors: [{ name: 'Laboratoire Orion', hue: 260 }],
          Accessoires: [{ name: 'Dossier confidentiel', hue: 8 }, { name: 'Carte céleste', hue: 48 }],
          Costumes: [{ name: 'Blouse Orion', hue: 250 }],
          Notes: [{ name: 'Révélation centrale', hue: 350 }],
        },
        shot: { description: 'Champ-contrechamp autour de la carte céleste.', actors: 'MAYA, NOOR', focal: '50 mm', angle: 'Niveau des yeux', 'shot-size': 'Plan rapproché', dialogue: 'Il te cherche, toi.', duration: '12 s', fps: '24', notes: 'Tenir le silence après la réplique.' },
      }),
      ...sceneFixture({
        id: 'scene-d', title: 'EXT. ANTENNE PRINCIPALE - ORAGE', act: 3,
        summary: 'L’équipe choisit de répondre alors que l’orage coupe le réseau.', tag: 'Final', color: 'violet',
        action: 'Maya branche le transmetteur tandis que la foudre frappe la crête.', character: 'MAYA',
        dialogue: 'Orion, ici la Terre. Nous vous recevons.',
        breakdown: {
          Personnages: [{ name: 'Maya', hue: 210 }, { name: 'Elias', hue: 28 }, { name: 'Noor', hue: 330 }],
          Décors: [{ name: 'Antenne principale', hue: 275 }],
          Accessoires: [{ name: 'Transmetteur portable', hue: 45 }],
          Son: [{ name: 'Tonnerre', hue: 265 }, { name: 'Signal Orion', hue: 300 }],
          'Besoins spéciaux': [{ name: 'Pluie et éclairs', hue: 215 }],
        },
        shot: { description: 'Grue ascendante révélant l’antenne sous l’orage.', actors: 'MAYA, ELIAS, NOOR', focal: '18 mm', angle: 'Contre-plongée', 'shot-size': 'Plan d’ensemble', dialogue: 'Orion, ici la Terre.', duration: '14 s', fps: '50', vfx: 'Éclairs et ciel renforcé.', notes: 'Ralenti léger sur la réponse.' },
      }),
    ],
  },
  characters: ['MAYA', 'ELIAS', 'NOOR'],
  locations: ['OBSERVATOIRE', 'ROUTE DES DÔMES', 'LABORATOIRE ORION', 'ANTENNE PRINCIPALE'],
  times: ['NUIT', 'AUBE', 'JOUR', 'ORAGE'],
  coverPage: {
    projectName: 'Régression UI', screenwriter: 'Équipe Senario', director: '', production: 'Senario Studio',
    duration: '12 min', version: 'Démo', date: '21 septembre 2026', rights: '', contactName: '',
    contactEmail: '', contactPhone: '', contactWebsite: '',
  },
  coverPageHidden: true,
  comments: [],
};

const emptyScenarioFixture = {
  ...scenarioFixture,
  title: 'Régression UI — projet vide',
  content: { type: 'doc', content: [paragraph('ACTION', 'empty-block', '')] },
  characters: [],
  locations: [],
  times: [],
  coverPage: { ...scenarioFixture.coverPage, projectName: 'Régression UI — projet vide' },
};

async function findEdge() {
  const candidates = [
    process.env.SCENARIO_EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard installation path.
    }
  }
  throw new Error('Microsoft Edge est introuvable. Définis SCENARIO_EDGE_PATH avec le chemin de msedge.exe.');
}

async function waitForDevToolsPort() {
  const portFile = join(profileDirectory, 'DevToolsActivePort');
  let lastError = '';
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
      if (port) return Number(port);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`Edge n'a pas exposé son port de débogage (${lastError}).`);
}

async function waitForTarget(port) {
  let diagnostic = '';
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      diagnostic = JSON.stringify(targets);
      const target = targets.find(candidate => candidate.type === 'page' && candidate.webSocketDebuggerUrl);
      if (target) return target;
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`Aucune page Edge pilotable n'a été trouvée (${diagnostic}).`);
}

function createCdpClient(socket) {
  let requestId = 0;
  const pending = new Map();
  const listeners = new Map();

  socket.addEventListener('message', event => {
    const rawMessage = typeof event.data === 'string'
      ? event.data
      : Buffer.from(event.data).toString('utf8');
    const message = JSON.parse(rawMessage);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(message.error.message));
      else request?.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params);
  });
  socket.addEventListener('close', event => {
    const error = new Error(`Connexion Edge fermée (${event.code}${event.reason ? ` : ${event.reason}` : ''}).`);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  socket.addEventListener('error', () => {
    const error = new Error('La connexion de pilotage Edge a rencontré une erreur.');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  return {
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) ?? []), listener]);
    },
    async send(method, params = {}) {
      const id = ++requestId;
      const response = new Promise((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
        socket.send(JSON.stringify({ id, method, params }));
      });
      return Promise.race([
        response,
        delay(15000).then(() => {
          pending.delete(id);
          throw new Error(`Délai dépassé pour ${method}.`);
        }),
      ]);
    },
  };
}

let edge;
let socket;
let cdp;
let edgeDiagnostics = '';

try {
  try {
    const response = await fetch(appUrl);
    assert.ok(response.ok, `Le serveur de développement répond avec le statut ${response.status}.`);
  } catch (error) {
    throw new Error(`Lance d'abord « npm.cmd run dev -- --host 127.0.0.1 », puis relance ce test. ${error instanceof Error ? error.message : error}`);
  }

  await mkdir(outputDirectory, { recursive: true });
  const edgePath = await findEdge();
  edge = spawn(edgePath, [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-sync',
    '--disable-features=msEdgeFirstRunExperience',
    '--window-size=1440,960',
    appUrl.href,
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  edge.stderr.on('data', chunk => {
    edgeDiagnostics = `${edgeDiagnostics}${chunk}`.slice(-4000);
  });
  edge.on('error', error => {
    edgeDiagnostics = `${edgeDiagnostics}\n${error.message}`.trim();
  });

  const port = await waitForDevToolsPort();
  const target = await waitForTarget(port);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveSocket, rejectSocket) => {
    socket.addEventListener('open', resolveSocket, { once: true });
    socket.addEventListener('error', rejectSocket, { once: true });
  });

  cdp = createCdpClient(socket);
  const browserErrors = [];
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    browserErrors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') browserErrors.push(args.map(argument => argument.value ?? argument.description).join(' '));
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error') browserErrors.push(`${entry.source}: ${entry.text}`);
  });

  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Log.enable'),
  ]);
  await cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async function waitFor(expression, description) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Élément attendu introuvable : ${description}.`);
  }

  async function seedScenario(fixture = scenarioFixture) {
    const recovery = JSON.stringify({ document: fixture, filePath: null });
    const seeded = await evaluate(`(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('senario-browser-project-persistence-v1', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files', { keyPath: 'key' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('files', 'readwrite');
        transaction.objectStore('files').put({
          key: 'recovery',
          contents: ${JSON.stringify(recovery)},
          createdAt: Date.now(),
        });
        transaction.oncomplete = () => { database.close(); resolve(true); };
        transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    }))()`);
    assert.equal(seeded, true, 'Le scénario de démonstration doit être enregistré dans le profil de test.');
  }

  async function grantVisualEntitlements() {
    const granted = await evaluate(`(async () => {
      const runtimeUrl = performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .find(url => url.includes('/src/commercial/runtime.ts'));
      if (!runtimeUrl) return false;
      const { offlineLicense } = await import(runtimeUrl);
      offlineLicense.publish({
        kind: 'valid',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        entitlements: [
          'scene_cards', 'breakdown', 'technical_breakdown', 'personal_comments',
          'voice_reading', 'ai.actions', 'ai_short_action',
        ].map(code => ({ code, enabled: true, value: null })),
      });
      return true;
    })()`);
    assert.equal(granted, true, 'Le runtime commercial doit être accessible dans la session de test.');
    await waitFor(`['Whiteboard', 'Dépouillement', 'Découpage technique'].every(label => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(candidate => candidate.getAttribute('aria-label') === label);
      return tab && !tab.hasAttribute('data-ui-locked');
    })`, 'onglets des espaces métier déverrouillés');
  }

  async function clickButton(label) {
    const clicked = await evaluate(`(() => {
      const expected = ${JSON.stringify(label)};
      const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find(candidate => {
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return !candidate.disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          && (normalize(candidate.getAttribute('aria-label')) === expected || normalize(candidate.textContent) === expected);
      });
      if (!button) return false;
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      button.focus();
      button.click();
      return true;
    })()`);
    assert.equal(clicked, true, `Le bouton « ${label} » doit être disponible.`);
    await delay(100);
  }

  async function pointerPoint(selector, xRatio = 0.5, yRatio = 0.5) {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return null;
      return { x: rect.left + rect.width * ${xRatio}, y: rect.top + rect.height * ${yRatio} };
    })()`);
    assert.ok(point, `La cible souris ${selector} doit être visible.`);
    return point;
  }

  async function pointerMove(selector, xRatio = 0.5, yRatio = 0.5) {
    const point = await pointerPoint(selector, xRatio, yRatio);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
    await delay(100);
  }

  async function pointerMoveBetween(fromSelector, toSelector, steps = 12, toXRatio = 0.5, toYRatio = 0.2) {
    const start = await pointerPoint(fromSelector);
    const end = await pointerPoint(toSelector, toXRatio, toYRatio);
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        button: 'none',
      });
      await delay(16);
    }
    await delay(140);
  }

  async function pointerClick(selector, xRatio = 0.5, yRatio = 0.5) {
    const point = await pointerPoint(selector, xRatio, yRatio);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await delay(100);
  }

  async function pointerClickButton(label) {
    const point = await evaluate(`(() => {
      const expected = ${JSON.stringify(label)};
      const normalize = value => (value || '').replace(/\\s+/g, ' ').trim();
      const button = Array.from(document.querySelectorAll('button')).find(candidate => {
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return !candidate.disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
          && (normalize(candidate.getAttribute('aria-label')) === expected || normalize(candidate.textContent) === expected);
      });
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(point, `Le bouton souris « ${label} » doit être visible.`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await delay(100);
  }

  async function pointerDrag(selector, startRatio = 0.15, endRatio = 0.85) {
    const start = await pointerPoint(selector, startRatio, 0.5);
    const end = await pointerPoint(selector, endRatio, 0.5);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 6; step += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + (end.x - start.x) * step / 6,
        y: start.y + (end.y - start.y) * step / 6,
        button: 'left',
        buttons: 1,
      });
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
    await delay(150);
  }

  async function pressKey(key, code = key) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    await delay(100);
  }

  async function pointerResizeBy(selector, deltaX, steps = 6) {
    const start = await pointerPoint(selector);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= steps; step += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: start.x + deltaX * step / steps, y: start.y, button: 'left', buttons: 1,
      });
      await delay(16);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + deltaX, y: start.y, button: 'left', clickCount: 1 });
    await delay(140);
  }

  async function auditViewport(label) {
    const report = await evaluate(`(() => {
      const inset = 2;
      const selectors = '.ui-dialog, .ui-menu__panel, .ui-menu__submenu-panel, .ui-popover__panel, .ui-context-menu';
      const overlays = Array.from(document.querySelectorAll(selectors)).filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const outside = overlays.flatMap(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < -inset || rect.top < -inset || rect.right > innerWidth + inset || rect.bottom > innerHeight + inset
          ? [{ className: element.className, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }]
          : [];
      });
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        outside,
      };
    })()`);
    assert.ok(report.documentWidth <= report.viewport.width + 1, `${label} crée un défilement horizontal global (${report.documentWidth}px pour ${report.viewport.width}px).`);
    assert.deepEqual(report.outside, [], `${label} contient un panneau hors de la fenêtre : ${JSON.stringify(report.outside)}.`);
  }

  async function screenshot(name) {
    await delay(150);
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(join(outputDirectory, `${name}.png`), Buffer.from(result.data, 'base64'));
    console.log(`CAPTURE ${name}.png`);
  }

  async function loadViewport(viewport) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: appUrl.href });
    await waitFor("document.readyState === 'complete' && Boolean(document.querySelector('.scenario-editor'))", 'éditeur Senario');
    await waitFor("Array.from(document.querySelectorAll('.document-title')).some(element => element.textContent?.includes('Régression UI'))", 'scénario de démonstration restauré');
    await delay(250);
  }

  async function openWorkspace({ label, selector, itemSelector, expectedItems, viewport }) {
    await clickButton(label);
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, `espace ${label}`);
    await waitFor(`document.querySelectorAll(${JSON.stringify(itemSelector)}).length >= ${expectedItems}`, `données de démonstration de ${label}`);
    const bounds = await evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    })()`);
    assert.ok(bounds.width > 0 && bounds.height > 0, `${label} doit occuper une surface visible.`);
    assert.ok(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= viewport.width + 1 && bounds.bottom <= viewport.height + 1,
      `${label} doit rester dans la fenêtre ${viewport.width}×${viewport.height} : ${JSON.stringify(bounds)}.`);
    await auditViewport(`${label} ${viewport.width}×${viewport.height}`);
    await screenshot(`${label === 'Whiteboard' ? 'whiteboard' : label === 'Dépouillement' ? 'breakdown' : 'technical-breakdown'}-${viewport.name}-${viewport.width}x${viewport.height}`);
  }

  async function captureHeaderOverlays(viewport) {
    await grantVisualEntitlements();
    const layoutBefore = await evaluate(`(() => {
      const header = document.querySelector('.menu-bar').getBoundingClientRect();
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      return { headerHeight: header.height, workspaceTop: workspace.top };
    })()`);

    await clickButton('Page de garde');
    await waitFor("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Page de garde\"]'))", 'popover de page de garde');
    const coverLayout = await evaluate(`(() => {
      const header = document.querySelector('.menu-bar').getBoundingClientRect();
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      const panel = document.querySelector('[role="dialog"][aria-label="Page de garde"]');
      return { headerHeight: header.height, workspaceTop: workspace.top, position: getComputedStyle(panel).position };
    })()`);
    assert.equal(coverLayout.headerHeight, layoutBefore.headerHeight, 'La page de garde ne doit pas agrandir le header.');
    assert.equal(coverLayout.workspaceTop, layoutBefore.workspaceTop, 'La page de garde ne doit pas déplacer le workspace.');
    assert.equal(coverLayout.position, 'fixed', 'La page de garde doit être un overlay fixé au viewport.');
    await screenshot(`cover-overlay-${viewport.name}-${viewport.width}x${viewport.height}`);
    await pointerClick('.workspace', 0.96, 0.86);
    await waitFor("!document.querySelector('[role=\"dialog\"][aria-label=\"Page de garde\"]')", 'fermeture extérieure de la page de garde');

    await clickButton('Lecture');
    await waitFor("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"Lecture vocale\"]'))", 'menu de lecture');
    const readingLayout = await evaluate(`(() => {
      const header = document.querySelector('.menu-bar').getBoundingClientRect();
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      return { headerHeight: header.height, workspaceTop: workspace.top };
    })()`);
    assert.equal(readingLayout.headerHeight, layoutBefore.headerHeight, 'Le menu Lecture ne doit pas agrandir le header.');
    assert.equal(readingLayout.workspaceTop, layoutBefore.workspaceTop, 'Le menu Lecture ne doit pas déplacer le workspace.');
    await pointerMove('#audio-menu-slot .menu-button');
    await pointerMove('.audio-menu', 0.5, 0.15);
    assert.equal(await evaluate("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"Lecture vocale\"]'))"), true,
      'Le menu Lecture doit rester ouvert pendant le trajet de la souris vers le panneau.');
    await screenshot(`reading-overlay-${viewport.name}-${viewport.width}x${viewport.height}`);
    await pointerClick('.workspace', 0.96, 0.86);
    await waitFor("!document.querySelector('[role=\"menu\"][aria-label=\"Lecture vocale\"]')", 'fermeture extérieure du menu Lecture');

    await pointerMove('.scenario-editor p[data-scenario-type="ACTION"]', 0.82, 0.5);
    await waitFor("Boolean(document.querySelector('.ai-inline-button'))", 'action IA contextuelle');
    await pointerClick('.ai-inline-button');
    await waitFor("Boolean(document.querySelector('.ai-popover'))", 'popover IA');
    assert.equal(await evaluate("document.querySelector('.ai-popover')?.getAttribute('data-ui-pointer-safe')"), 'true',
      'Le popover IA doit utiliser la sécurité pointeur partagée.');
    await pointerMoveBetween('.ai-inline-button', '.ai-popover');
    assert.equal(await evaluate("Boolean(document.querySelector('.ai-popover'))"), true,
      'Le popover IA doit rester ouvert pendant chaque étape du trajet de la souris.');
    await screenshot(`ai-pointer-path-${viewport.name}-${viewport.width}x${viewport.height}`);
    await pointerMove('.application-bottom-bar', 0.5, 0.5);
    await waitFor("!document.querySelector('.ai-popover')", 'fermeture du popover IA après sortie réelle de la zone interactive');

    await pointerMove('.scenario-editor p[data-scenario-type="ACTION"]', 0.82, 0.5);
    await waitFor("Boolean(document.querySelector('.transition-inline-button'))", 'action Transition contextuelle');
    await pointerClick('.transition-inline-button');
    await waitFor("Boolean(document.querySelector('.transition-popover'))", 'popover Transition');
    assert.equal(await evaluate("document.querySelector('.transition-popover')?.getAttribute('data-ui-pointer-safe')"), 'true',
      'Le popover Transition doit utiliser la même sécurité pointeur que le popover IA.');
    await pointerMoveBetween('.transition-inline-button', '.transition-popover');
    assert.equal(await evaluate("Boolean(document.querySelector('.transition-popover'))"), true,
      'Le popover Transition doit rester ouvert pendant chaque étape du trajet de la souris.');
    await screenshot(`transition-pointer-path-${viewport.name}-${viewport.width}x${viewport.height}`);
    await pointerMove('.application-bottom-bar', 0.5, 0.5);
    await waitFor("!document.querySelector('.transition-popover')", 'fermeture du popover Transition après sortie réelle de la zone interactive');
  }

  async function captureBusinessWorkspaces(viewport) {
    await grantVisualEntitlements();
    await openWorkspace({ label: 'Whiteboard', selector: '.whiteboard-workspace', itemSelector: '.whiteboard-scene-card', expectedItems: 4, viewport });
    await openWorkspace({ label: 'Dépouillement', selector: '.breakdown-workspace', itemSelector: '.breakdown-item', expectedItems: 4, viewport });
    if (viewport.name === 'compact-desktop') {
      await clickButton('Modifier les couleurs de Maya');
      await waitFor("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Couleurs de Maya\"]'))", 'éditeur de couleur partagé');
      assert.ok(await evaluate("document.querySelector('[aria-label=\"Modifier les couleurs de Maya\"]')?.getBoundingClientRect().width >= 32"),
        'La cible de l’éditeur de couleur doit mesurer au moins 32 px.');
      const colorBeforeDrag = await evaluate("document.querySelector('.breakdown-color-editor input[type=\"range\"]')?.value");
      await pointerDrag('.breakdown-color-editor input[type="range"]');
      assert.equal(await evaluate("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Couleurs de Maya\"]'))"), true,
        'L’éditeur de couleur doit rester ouvert pendant et après un glissement réel.');
      assert.notEqual(await evaluate("document.querySelector('.breakdown-color-editor input[type=\"range\"]')?.value"), colorBeforeDrag,
        'Le glissement réel doit modifier la couleur.');
      await auditViewport(`Éditeur de couleur ${viewport.width}×${viewport.height}`);
      await screenshot(`breakdown-color-editor-${viewport.name}-${viewport.width}x${viewport.height}`);
      await pointerClick('.breakdown-scene-list header');
      await waitFor("!document.querySelector('[role=\"dialog\"][aria-label=\"Couleurs de Maya\"]')", 'fermeture extérieure de l’éditeur de couleur');
      await clickButton('Modifier les couleurs de Maya');
      await waitFor("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Couleurs de Maya\"]'))", 'réouverture de l’éditeur de couleur');
      await pressKey('Escape');
      await waitFor("!document.querySelector('[role=\"dialog\"][aria-label=\"Couleurs de Maya\"]')", 'fermeture clavier de l’éditeur de couleur');
      assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), 'Modifier les couleurs de Maya',
        'Échap doit rendre le focus au déclencheur de couleur.');

      await clickButton('Filtrer les scènes');
      await waitFor("Boolean(document.querySelector('.breakdown-filter-panel'))", 'filtres du dépouillement');
      await pointerClickButton('Acte 2');
      await waitFor("document.querySelectorAll('.breakdown-scene-row').length === 2", 'scènes filtrées sur l’acte 2');
      assert.equal(await evaluate("Boolean(document.querySelector('.breakdown-filter-panel'))"), true,
        'Le panneau de filtres du dépouillement doit rester ouvert après un clic réel.');
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Filtrer les scènes\"]')?.getAttribute('aria-pressed')"), 'true',
        'Le déclencheur doit annoncer que le dépouillement est filtré.');
      assert.equal(await evaluate(`(() => {
        const heading = Array.from(document.querySelectorAll('.breakdown-filter-panel .breakdown-filter-category-button'))
          .find(button => button.querySelector('strong')?.textContent?.trim() === 'Personnages');
        if (!heading) return false;
        heading.click();
        return true;
      })()`), true, 'La catégorie Personnages doit être disponible dans les filtres du dépouillement.');
      await waitFor("Boolean(document.querySelector('.breakdown-filter-panel .breakdown-filter-elements'))", 'options de filtre du dépouillement');
      const breakdownFilterSizing = await evaluate(`(() => {
        const panel = document.querySelector('.breakdown-filter-panel');
        const list = panel?.querySelector('.breakdown-filter-elements');
        if (!panel || !list) return null;
        const rect = panel.getBoundingClientRect();
        return {
          sharedPanel: panel.classList.contains('ui-option-popover'),
          panelOverflow: panel.scrollHeight > panel.clientHeight + 1,
          viewportLimited: Math.abs(rect.top - 8) <= 2 || Math.abs(rect.bottom - (innerHeight - 8)) <= 2,
          listMaxHeight: getComputedStyle(list).maxHeight,
          listOverflow: getComputedStyle(list).overflowY,
        };
      })()`);
      assert.ok(breakdownFilterSizing?.sharedPanel, 'Les filtres du dépouillement doivent utiliser le dimensionnement partagé des listes.');
      assert.ok(!breakdownFilterSizing.panelOverflow || breakdownFilterSizing.viewportLimited,
        `Le filtre ne peut défiler que lorsqu'il atteint la fenêtre : ${JSON.stringify(breakdownFilterSizing)}.`);
      assert.equal(breakdownFilterSizing.listMaxHeight, 'none', 'La liste interne des filtres ne doit pas avoir de hauteur fixe.');
      assert.equal(breakdownFilterSizing.listOverflow, 'visible', 'La liste interne des filtres ne doit pas créer une seconde scrollbar.');
      await auditViewport(`Filtres du Dépouillement ${viewport.width}×${viewport.height}`);
      await screenshot(`breakdown-filters-${viewport.name}-${viewport.width}x${viewport.height}`);
      await pressKey('Escape');
      await waitFor("!document.querySelector('[role=\"dialog\"][aria-label=\"Filtres des scènes\"]')", 'fermeture clavier des filtres du dépouillement');
      assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), 'Filtrer les scènes',
        'Échap doit rendre le focus au déclencheur des filtres du dépouillement.');

      await clickButton('Fermer Personnages');
      await waitFor("Boolean(document.querySelector('.breakdown-category-close-menu'))", 'confirmation de fermeture de catégorie');
      assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.breakdown-category-close-menu small')).fontSize) >= 11"),
        'Le texte secondaire de confirmation doit rester lisible.');
      await auditViewport(`Confirmation de catégorie ${viewport.width}×${viewport.height}`);
      await screenshot(`breakdown-category-confirm-${viewport.name}-${viewport.width}x${viewport.height}`);
      await pressKey('Escape');
    }
    await openWorkspace({ label: 'Découpage technique', selector: '.technical-breakdown-workspace', itemSelector: '.technical-shot-row', expectedItems: 4, viewport });
    const technicalScroll = await evaluate(`(() => {
      const element = document.querySelector('.technical-table-scroll');
      if (!element) return null;
      return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: getComputedStyle(element).overflowX };
    })()`);
    assert.ok(technicalScroll && technicalScroll.scrollWidth > technicalScroll.clientWidth,
      `Le tableau technique doit conserver son défilement horizontal interne : ${JSON.stringify(technicalScroll)}.`);
    assert.ok(['auto', 'scroll'].includes(technicalScroll.overflowX),
      `Le débordement du tableau technique doit être interne : ${JSON.stringify(technicalScroll)}.`);
    const automaticTableGeometry = await evaluate(`(() => {
      const table = document.querySelector('.technical-table');
      const headerRow = table?.querySelector('.technical-header-row');
      const corner = headerRow?.querySelector('.technical-corner-cell');
      const headers = Array.from(headerRow?.querySelectorAll('.technical-column-header') ?? []);
      const groups = Array.from(table?.querySelectorAll('.technical-scene-group') ?? []);
      if (!table || !headerRow || !corner || !headers.length) return null;
      const tableRect = table.getBoundingClientRect();
      const lastRect = headers.at(-1).getBoundingClientRect();
      const expectedWidth = corner.getBoundingClientRect().width
        + headers.reduce((total, header) => total + header.getBoundingClientRect().width, 0);
      return {
        tableWidth: tableRect.width,
        expectedWidth,
        headerRowWidth: headerRow.getBoundingClientRect().width,
        lastEdgeDelta: Math.abs(lastRect.right - tableRect.right),
        groupWidthDeltas: groups.map(group => Math.abs(group.getBoundingClientRect().width - tableRect.width)),
        truncatedAutomaticTitles: headers.filter(header => {
          if (header.dataset.widthMode !== 'auto') return false;
          const title = header.querySelector(':scope > span:first-child');
          return title && title.scrollWidth > title.clientWidth + 1;
        }).map(header => header.textContent?.trim()),
      };
    })()`);
    assert.ok(automaticTableGeometry, 'La géométrie du tableau technique doit être mesurable.');
    assert.ok(Math.abs(automaticTableGeometry.tableWidth - automaticTableGeometry.expectedWidth) <= 1,
      `La largeur du tableau doit être la somme exacte de ses colonnes : ${JSON.stringify(automaticTableGeometry)}.`);
    assert.ok(Math.abs(automaticTableGeometry.headerRowWidth - automaticTableGeometry.tableWidth) <= 1,
      'La ligne de header doit se terminer avec le tableau.');
    assert.ok(automaticTableGeometry.lastEdgeDelta <= 1, 'Le tableau doit se terminer au bord de sa dernière catégorie.');
    assert.ok(automaticTableGeometry.groupWidthDeltas.every(delta => delta <= 1),
      'Chaque groupe de scène doit utiliser la largeur réelle du tableau.');
    assert.deepEqual(automaticTableGeometry.truncatedAutomaticTitles, [],
      `Les titres automatiques ne doivent pas être tronqués : ${JSON.stringify(automaticTableGeometry.truncatedAutomaticTitles)}.`);
    const emptySceneButtonGeometry = await evaluate(`(() => {
      const table = document.querySelector('.technical-table');
      const group = table?.querySelector('.technical-scene-group');
      if (!table || !group) return null;
      const button = document.createElement('button');
      button.className = 'ui-button ui-button--ghost technical-scene-empty';
      button.textContent = 'Ajouter le premier plan de cette scène';
      group.append(button);
      const tableRect = table.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const rowToolsWidth = parseFloat(getComputedStyle(table).getPropertyValue('--technical-row-tools-width'));
      const result = {
        leftDelta: Math.abs(buttonRect.left - (tableRect.left + rowToolsWidth)),
        rightDelta: Math.abs(buttonRect.right - tableRect.right),
        width: buttonRect.width,
      };
      button.remove();
      return result;
    })()`);
    assert.ok(emptySceneButtonGeometry && emptySceneButtonGeometry.width > 0,
      'Le bouton d’ajout du premier plan doit être mesurable dans une scène vide.');
    assert.ok(emptySceneButtonGeometry.leftDelta <= 1 && emptySceneButtonGeometry.rightDelta <= 1,
      `Le bouton d’une scène vide doit commencer après la poignée et finir avec le tableau : ${JSON.stringify(emptySceneButtonGeometry)}.`);
    assert.equal(await evaluate(`(() => {
      const header = document.querySelector('.technical-column-header');
      const button = header?.querySelector('.technical-header-menu-button');
      if (!header || !button) return false;
      const parent = header.getBoundingClientRect(); const child = button.getBoundingClientRect();
      return child.left >= parent.left && child.right <= parent.right && child.top >= parent.top && child.bottom <= parent.bottom;
    })()`), true, 'Le bouton … doit rester entièrement contenu dans l’en-tête de sa catégorie.');
    if (viewport.name === 'compact-desktop') {
      const widthBeforeManualResize = await evaluate(`(() => {
        const header = Array.from(document.querySelectorAll('.technical-column-header'))
          .find(candidate => candidate.querySelector(':scope > span:first-child')?.textContent?.trim() === 'Description');
        const table = document.querySelector('.technical-table');
        return header && table ? { column: header.getBoundingClientRect().width, table: table.getBoundingClientRect().width } : null;
      })()`);
      assert.ok(widthBeforeManualResize, 'La catégorie Description doit être redimensionnable.');
      await pointerResizeBy('[aria-label="Redimensionner Description"]', -48);
      const widthAfterManualResize = await evaluate(`(() => {
        const header = Array.from(document.querySelectorAll('.technical-column-header'))
          .find(candidate => candidate.querySelector(':scope > span:first-child')?.textContent?.trim() === 'Description');
        const table = document.querySelector('.technical-table');
        return header && table ? {
          column: header.getBoundingClientRect().width,
          mode: header.dataset.widthMode,
          table: table.getBoundingClientRect().width,
        } : null;
      })()`);
      assert.equal(widthAfterManualResize?.mode, 'manual', 'Un resize doit passer explicitement la catégorie en largeur manuelle.');
      assert.ok(Math.abs((widthBeforeManualResize.column - widthAfterManualResize.column) - 48) <= 1,
        `La largeur manuelle doit suivre le pointeur : ${JSON.stringify({ widthBeforeManualResize, widthAfterManualResize })}.`);
      assert.ok(Math.abs((widthBeforeManualResize.table - widthAfterManualResize.table) - 48) <= 1,
        'Réduire une catégorie doit réduire la largeur totale du tableau de la même valeur.');
      await pointerClick('[aria-label="Options de Description"]');
      await waitFor("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Options de Description\"]'))", 'options de la catégorie Description');
      await clickButton('Ajuster automatiquement');
      await waitFor("document.querySelector('[aria-label=\"Redimensionner Description\"]')?.closest('.technical-column-header')?.dataset.widthMode === 'auto'", 'réinitialisation automatique de Description');

      await clickButton('Catégorie');
      await waitFor("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Ajouter ou réafficher une catégorie\"]'))", 'menu partagé des catégories techniques');
      assert.ok(await evaluate("document.querySelector('[aria-label^=\"Ajouter une catégorie\"]')?.getBoundingClientRect().height >= 32"),
        'La cible du menu Catégorie doit mesurer au moins 32 px de haut.');
      const categoryMenuSizing = await evaluate(`(() => {
        const panel = document.querySelector('[role="dialog"][aria-label="Ajouter ou réafficher une catégorie"]');
        if (!panel) return null;
        const rect = panel.getBoundingClientRect();
        return {
          sharedPanel: panel.classList.contains('ui-option-popover'),
          overflow: panel.scrollHeight > panel.clientHeight + 1,
          viewportLimited: Math.abs(rect.top - 8) <= 2 || Math.abs(rect.bottom - (innerHeight - 8)) <= 2,
        };
      })()`);
      assert.ok(categoryMenuSizing?.sharedPanel, 'Le menu Catégorie doit utiliser le même dimensionnement que les filtres.');
      assert.ok(!categoryMenuSizing.overflow || categoryMenuSizing.viewportLimited,
        `Le menu Catégorie ne peut défiler que lorsqu'il atteint la fenêtre : ${JSON.stringify(categoryMenuSizing)}.`);
      await auditViewport(`Menu Catégorie du Découpage technique ${viewport.width}×${viewport.height}`);
      await screenshot(`technical-breakdown-category-menu-${viewport.name}-${viewport.width}x${viewport.height}`);
      await pressKey('Escape');
      await waitFor("!document.querySelector('[role=\"dialog\"][aria-label=\"Ajouter ou réafficher une catégorie\"]')", 'fermeture clavier du menu des catégories techniques');
      assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')?.startsWith('Ajouter une catégorie')"), true,
        'Échap doit rendre le focus au déclencheur du menu Catégorie.');

      await clickButton('Filtrer les plans');
      await waitFor("Boolean(document.querySelector('.technical-filter-logic-section .ui-switch'))", 'filtres du découpage technique');
      await pointerClickButton('Basculer entre Addition et Restriction');
      assert.equal(await evaluate("document.querySelector('[aria-label=\"Basculer entre Addition et Restriction\"]')?.getAttribute('aria-checked')"), 'false',
        'Le passage au mode Addition doit être annoncé par l’interrupteur partagé.');
      assert.equal(await evaluate("document.querySelector('.technical-filter-toggle-row > span:first-child')?.classList.contains('is-active')"), true,
        'Le libellé Addition doit refléter le mode de filtre actif.');
      const actorsExpanded = await evaluate(`(() => {
        const heading = Array.from(document.querySelectorAll('.breakdown-filter-category-button'))
          .find(button => button.querySelector('strong')?.textContent?.trim() === 'Acteurs');
        if (!heading) return false;
        heading.click();
        return true;
      })()`);
      assert.equal(actorsExpanded, true, 'La catégorie Acteurs doit être disponible dans les filtres.');
      await waitFor("Boolean(document.querySelector('.breakdown-filter-panel .breakdown-filter-elements'))", 'options de filtre du découpage technique');
      const technicalFilterSizing = await evaluate(`(() => {
        const panel = document.querySelector('.breakdown-filter-panel');
        const list = panel?.querySelector('.breakdown-filter-elements');
        if (!panel || !list) return null;
        const rect = panel.getBoundingClientRect();
        return {
          sharedPanel: panel.classList.contains('ui-option-popover'),
          panelOverflow: panel.scrollHeight > panel.clientHeight + 1,
          viewportLimited: Math.abs(rect.top - 8) <= 2 || Math.abs(rect.bottom - (innerHeight - 8)) <= 2,
          listMaxHeight: getComputedStyle(list).maxHeight,
          listOverflow: getComputedStyle(list).overflowY,
        };
      })()`);
      assert.ok(technicalFilterSizing?.sharedPanel, 'Les filtres techniques doivent utiliser le dimensionnement partagé des listes.');
      assert.ok(!technicalFilterSizing.panelOverflow || technicalFilterSizing.viewportLimited,
        `Le filtre technique ne peut défiler que lorsqu'il atteint la fenêtre : ${JSON.stringify(technicalFilterSizing)}.`);
      assert.equal(technicalFilterSizing.listMaxHeight, 'none', 'La liste technique interne ne doit pas avoir de hauteur fixe.');
      assert.equal(technicalFilterSizing.listOverflow, 'visible', 'La liste technique interne ne doit pas créer une seconde scrollbar.');
      await pointerClickButton('NOOR');
      await waitFor("document.querySelectorAll('.technical-shot-row').length === 2", 'plans filtrés sur Noor');
      assert.equal(await evaluate("Boolean(document.querySelector('[role=\"dialog\"][aria-label=\"Filtres des plans\"]'))"), true,
        'Le panneau de filtres techniques doit rester ouvert après un clic réel.');
      await auditViewport(`Filtres du Découpage technique ${viewport.width}×${viewport.height}`);
      await screenshot(`technical-breakdown-filters-${viewport.name}-${viewport.width}x${viewport.height}`);
      await pressKey('Escape');
      await waitFor("!document.querySelector('[role=\"dialog\"][aria-label=\"Filtres des plans\"]')", 'fermeture clavier des filtres techniques');
      assert.equal(await evaluate("document.activeElement?.getAttribute('aria-label')"), 'Filtrer les plans',
        'Échap doit rendre le focus au déclencheur des filtres techniques.');
      await clickButton('NOOR');
      await waitFor("document.querySelectorAll('.technical-shot-row').length === 4", 'retrait du filtre technique');

      const selected = await evaluate(`(() => {
        const cell = document.querySelector('.technical-cell-description');
        if (!cell) return false;
        cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' }));
        return true;
      })()`);
      assert.equal(selected, true, 'Une cellule technique doit pouvoir être sélectionnée.');
      await waitFor("Boolean(document.querySelector('.technical-cell.is-cell-selected')) && Boolean(document.querySelector('.technical-selection-actions'))", 'état de sélection technique');
      await screenshot(`technical-breakdown-selection-${viewport.name}-${viewport.width}x${viewport.height}`);

      const editing = await evaluate(`(() => {
        const cell = document.querySelector('.technical-cell.is-cell-selected');
        if (!cell) return false;
        cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
        return true;
      })()`);
      assert.equal(editing, true, 'Une cellule sélectionnée doit pouvoir entrer en édition.');
      await waitFor("Boolean(document.querySelector('.technical-cell.is-editing input'))", 'édition d’une cellule technique');
      assert.equal(await evaluate("document.activeElement?.matches('.technical-cell.is-editing input')"), true,
        'Le champ d’édition technique doit recevoir le focus.');
      await screenshot(`technical-breakdown-editing-${viewport.name}-${viewport.width}x${viewport.height}`);
      await pressKey('Escape');
      await waitFor("!document.querySelector('.technical-cell.is-editing')", 'sortie du mode édition technique');

      const calculatedCellSelected = await evaluate(`(() => {
        const cell = document.querySelector('.technical-cell-plan');
        if (!cell) return false;
        cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2, pointerType: 'mouse' }));
        return true;
      })()`);
      assert.equal(calculatedCellSelected, true, 'La cellule Plan calculée doit être disponible pour le test d’erreur.');
      await waitFor("document.querySelector('.technical-cell-plan')?.classList.contains('is-cell-selected')", 'sélection de la cellule Plan calculée');
      await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', ctrlKey: true, bubbles: true }))");
      await waitFor("document.querySelector('.technical-clipboard-notice[role=\"alert\"]')?.textContent?.includes('ne peuvent pas être coupées')", 'feedback d’erreur typé du presse-papiers');
      await auditViewport(`Erreur métier du Découpage technique ${viewport.width}×${viewport.height}`);
      await screenshot(`technical-breakdown-error-${viewport.name}-${viewport.width}x${viewport.height}`);
    }
    await clickButton('Scénario');
    await waitFor("!document.querySelector('.technical-breakdown-workspace') && Boolean(document.querySelector('.scenario-editor'))", 'retour au scénario');
  }

  await waitFor(`location.origin === ${JSON.stringify(appUrl.origin)}`, 'origine locale de l’application');
  const compactViewport = viewports.find(viewport => viewport.name === 'compact-desktop');
  assert.ok(compactViewport, 'La taille desktop compacte doit être configurée.');
  await seedScenario(emptyScenarioFixture);
  await loadViewport(compactViewport);
  await grantVisualEntitlements();
  await clickButton('Dépouillement');
  await waitFor("Boolean(document.querySelector('.breakdown-empty.ui-empty-state'))", 'état vide du dépouillement');
  await auditViewport('État vide du Dépouillement compact desktop');
  await screenshot(`breakdown-empty-${compactViewport.width}x${compactViewport.height}`);
  await clickButton('Découpage technique');
  await waitFor("Boolean(document.querySelector('.technical-empty-state.ui-empty-state'))", 'état vide du découpage technique');
  await auditViewport('État vide du Découpage technique compact desktop');
  await screenshot(`technical-breakdown-empty-${compactViewport.width}x${compactViewport.height}`);

  await seedScenario();

  for (const viewport of viewports) {
    await loadViewport(viewport);
    await auditViewport(`Éditeur ${viewport.width}×${viewport.height}`);
    await screenshot(`editor-${viewport.name}-${viewport.width}x${viewport.height}`);

    if (viewport.name === 'wide') {
      await captureBusinessWorkspaces(viewport);
      continue;
    }

    if (viewport.name !== 'compact-desktop') continue;

    await captureHeaderOverlays(viewport);

    await clickButton('Aide');
    await waitFor("Boolean(document.querySelector('.help-panel'))", 'dialogue d’aide');
    await auditViewport('Dialogue d’aide compact desktop');
    await screenshot(`help-${viewport.width}x${viewport.height}`);

    await clickButton('Ouvrir le catalogue UI interne');
    await waitFor("Boolean(document.querySelector('.ui-catalog'))", 'catalogue UI');
    assert.equal(await evaluate("document.querySelector('.ui-catalog .ui-dialog__body')?.scrollTop"), 0, 'Le catalogue doit s’ouvrir en haut de son contenu.');
    assert.ok(await evaluate("document.querySelector('.ui-catalog .ui-tabs')?.getBoundingClientRect().height >= 32"), 'La barre d’onglets du catalogue ne doit pas être comprimée.');
    await auditViewport('Catalogue de composants compact desktop');
    await screenshot(`catalog-components-${viewport.width}x${viewport.height}`);

    await clickButton('Menu contextuel');
    await waitFor("Boolean(document.querySelector('[role=\"menu\"][aria-label=\"Exemple de menu contextuel\"]'))", 'menu contextuel du catalogue');
    await waitFor("document.activeElement?.getAttribute('role') === 'menuitem' && document.activeElement?.textContent?.trim() === 'Ouvrir'", 'focus initial du menu');
    await pressKey('End');
    assert.equal(await evaluate("document.activeElement?.textContent?.trim()"), 'Supprimer', 'La touche Fin doit cibler le dernier élément du menu.');
    await auditViewport('Menu contextuel compact desktop');
    await screenshot(`catalog-context-menu-${viewport.width}x${viewport.height}`);
    await pressKey('Escape');
    await waitFor("!document.querySelector('[role=\"menu\"][aria-label=\"Exemple de menu contextuel\"]')", 'fermeture clavier du menu contextuel');
    assert.equal(await evaluate("Boolean(document.querySelector('.ui-catalog'))"), true, 'Échap doit fermer le menu sans fermer le catalogue.');

    await clickButton('États');
    await waitFor("document.querySelector('[role=\"tabpanel\"][aria-label=\"États interactifs\"]')?.hidden === false", 'onglet États');
    await auditViewport('États du catalogue compact desktop');
    await screenshot(`catalog-states-${viewport.width}x${viewport.height}`);

    await clickButton('Fondations');
    await waitFor("document.querySelector('[role=\"tabpanel\"][aria-label=\"Fondations visuelles\"]')?.hidden === false", 'onglet Fondations');
    await auditViewport('Fondations du catalogue compact desktop');
    await screenshot(`catalog-foundations-${viewport.width}x${viewport.height}`);

    await clickButton('Fermer le catalogue');
    await waitFor("!document.querySelector('.ui-catalog')", 'fermeture du catalogue');
    await clickButton('Raccourcis');
    await waitFor("Boolean(document.querySelector('.text-replacements-panel'))", 'dialogue des raccourcis');
    const shortcutGeometry = await evaluate(`(() => {
      const header = document.querySelector('.text-replacements-panel .ui-dialog__header').getBoundingClientRect();
      const toggle = document.querySelector('.shortcut-toggle').getBoundingClientRect();
      const search = document.querySelector('.text-replacement-search').getBoundingClientRect();
      const add = document.querySelector('.add-text-replacement').getBoundingClientRect();
      const marker = document.createElement('div');
      marker.style.background = 'var(--ui-color-surface-raised)'; document.body.append(marker);
      const expectedSurface = getComputedStyle(marker).backgroundColor; marker.remove();
      return {
        toggleContained: toggle.left >= header.left && toggle.right <= header.right && toggle.top >= header.top && toggle.bottom <= header.bottom,
        controlsDelta: Math.abs((search.top + search.height / 2) - (add.top + add.height / 2)),
        cursorToggle: getComputedStyle(document.querySelector('.shortcut-toggle')).cursor,
        cursorAdd: getComputedStyle(document.querySelector('.add-text-replacement')).cursor,
        panelSurface: getComputedStyle(document.querySelector('.text-replacements-panel')).backgroundColor,
        expectedSurface,
      };
    })()`);
    assert.equal(shortcutGeometry.toggleContained, true, 'Le switch Activer doit tenir dans le header.');
    assert.ok(shortcutGeometry.controlsDelta <= 1, `Ajouter et Rechercher doivent être alignés (${shortcutGeometry.controlsDelta}px).`);
    assert.equal(shortcutGeometry.cursorToggle, 'pointer', 'Le switch Activer doit afficher un curseur interactif.');
    assert.equal(shortcutGeometry.cursorAdd, 'pointer', 'Le bouton Ajouter doit afficher un curseur interactif.');
    assert.equal(shortcutGeometry.panelSurface, shortcutGeometry.expectedSurface, 'Les raccourcis doivent utiliser la surface partagée des réglages.');
    await auditViewport('Dialogue des raccourcis compact desktop');
    await screenshot(`text-replacements-${viewport.width}x${viewport.height}`);
    await clickButton('Annuler');
    await waitFor("!document.querySelector('.text-replacements-panel')", 'fermeture du dialogue des raccourcis');

    await clickButton('IA');
    await waitFor("Boolean(document.querySelector('.ai-settings-panel'))", 'dialogue des réglages IA');
    assert.equal(await evaluate("document.activeElement === document.querySelector('.ai-settings-panel')"), true,
      'Le dialogue IA doit recevoir le focus sans cibler automatiquement sa croix de fermeture.');
    assert.equal(await evaluate("Boolean(document.querySelector('[role=\"tooltip\"]'))"), false,
      'L’infobulle de fermeture ne doit pas apparaître à l’ouverture du dialogue IA.');
    assert.equal(await evaluate(`(() => {
      const marker = document.createElement('div'); marker.style.background = 'var(--ui-color-surface-raised)'; document.body.append(marker);
      const expected = getComputedStyle(marker).backgroundColor; marker.remove();
      const panel = document.querySelector('.ai-settings-panel');
      const enabledButtons = Array.from(panel.querySelectorAll('button:not(:disabled)'));
      return getComputedStyle(panel).backgroundColor === expected && enabledButtons.every(button => getComputedStyle(button).cursor === 'pointer');
    })()`), true, 'Le dialogue IA doit utiliser la surface et les curseurs partagés.');
    const aiDialogGeometry = await evaluate(`(() => {
      const panel = document.querySelector('.ai-settings-panel');
      const body = panel?.querySelector('.ai-settings-body');
      const footer = panel?.querySelector('.ui-dialog__footer');
      const editor = panel?.querySelector('.prompt-editor');
      const list = panel?.querySelector('.prompt-editor-list');
      const textarea = panel?.querySelector('.prompt-instruction-input');
      if (!panel || !body || !footer || !editor || !list || !textarea) return null;
      const panelRect = panel.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const editorRect = editor.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const textareaRect = textarea.getBoundingClientRect();
      const bodyStyle = getComputedStyle(body);
      return {
        footerBottomGap: Math.abs(panelRect.bottom - footerRect.bottom),
        editorBottomGap: Math.abs(editorRect.bottom - (bodyRect.bottom - parseFloat(bodyStyle.paddingBottom))),
        listHeightDelta: Math.abs(listRect.height - editorRect.height),
        textareaHeight: textareaRect.height,
      };
    })()`);
    assert.ok(aiDialogGeometry, 'La géométrie du dialogue IA doit être mesurable.');
    assert.ok(aiDialogGeometry.footerBottomGap <= 2,
      `Les actions Annuler et Enregistrer doivent rester ancrées en bas du dialogue : ${JSON.stringify(aiDialogGeometry)}.`);
    assert.ok(aiDialogGeometry.editorBottomGap <= 2 && aiDialogGeometry.listHeightDelta <= 2,
      `La liste et l’éditeur de prompts doivent occuper toute la hauteur disponible : ${JSON.stringify(aiDialogGeometry)}.`);
    assert.ok(aiDialogGeometry.textareaHeight >= 140,
      `La zone d’instruction doit utiliser l’espace disponible plutôt qu’une petite hauteur fixe : ${JSON.stringify(aiDialogGeometry)}.`);
    await pointerMove('.ai-settings-panel [aria-label="Fermer"]');
    await waitFor("Boolean(document.querySelector('[role=\"tooltip\"]'))", 'infobulle de fermeture au survol');
    await pointerMove('.prompt-editor-heading');
    await waitFor("!document.querySelector('[role=\"tooltip\"]')", 'masquage de l’infobulle hors de la croix');
    await auditViewport('Dialogue IA compact desktop');
    await screenshot(`ai-settings-${viewport.width}x${viewport.height}`);
    await clickButton('Annuler');
    await waitFor("!document.querySelector('.ai-settings-panel')", 'fermeture du dialogue IA');

    await captureBusinessWorkspaces(viewport);
  }

  assert.deepEqual(browserErrors, [], `La console du navigateur contient des erreurs :\n${browserErrors.join('\n')}`);
  console.log(`PASS régression UI desktop : ${viewports.length} tailles, espaces métier, overlays bornés, navigation clavier valide.`);
  console.log(`Captures : ${outputDirectory}`);
} catch (error) {
  if (edge && edge.exitCode !== null) console.error(`Edge s'est arrêté avec le code ${edge.exitCode}.`);
  if (edgeDiagnostics) console.error(edgeDiagnostics);
  throw error;
} finally {
  try {
    await cdp?.send('Browser.close');
  } catch {
    // Closing the browser can close the transport before the acknowledgement.
  }
  socket?.close();
  edge?.kill();
  let cleanupError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(profileDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      cleanupError = undefined;
      break;
    } catch (error) {
      cleanupError = error;
      await delay(150);
    }
  }
  if (cleanupError) console.warn(`Profil Edge temporaire encore verrouillé : ${profileDirectory}`);
}
