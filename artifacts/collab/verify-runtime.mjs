import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const vite = await createServer({
  configFile: resolve('client/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'collaboration-runtime-fixture',
    configureServer(server) {
      server.middlewares.use('/__four-characters', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><body style="margin:0"><main id="arena" style="width:100vw;height:100vh"></main>');
      });
    },
  }],
});
let browser;
try {
  await vite.listen();
  const port = vite.httpServer.address().port;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${port}/__four-characters`);
  const results = await page.evaluate(async () => {
    await import('/src/battle3d/presentation-plugins.ts');
    const { BattleScene3D, preloadCollaborationAssets } = await import('/src/battle3d/scene.ts');
    const { parseBattleEvent } = await import('/src/battle/events.ts');
    const { playMapEvent, projectMapSnapshot } = await import('/src/battle3d/map-playback.ts');
    const ids = ['ghost', 'wild-hunt', 'hunchback-archer', 'water-snake'];
    await preloadCollaborationAssets(ids);
    const host = document.querySelector('#arena');
    const scene = new BattleScene3D(host, { onPickPlayer() {}, onPickRoom() {} });
    const players = ids.map((charId, index) => ({
      id: String(index + 1), name: charId, charId, charName: charId, hp: 3, maxHp: 3,
      room: index < 2 ? 'R1' : 'R2', alive: true, hidden: false, invisible: false, char: {}, effects: [],
    }));
    const snap = { players, roomIds: ['R1', 'R2'], phase: 'act', currentActor: '1', winner: null, domainHolder: null };
    const state = (id, char) => { players.find(p => p.id === id).char = { ...char }; };
    const entity = id => scene.entities.get(id);
    const named = (id, name) => entity(id).rig.root.getObjectByName(name);
    const waitFor = async (predicate, note) => {
      const started = performance.now();
      while (!predicate()) {
        if (performance.now() - started > 6000) throw new Error(note);
        await new Promise(requestAnimationFrame);
      }
    };
    const cue = (action, pid, payload = {}) => {
      const event = parseBattleEvent({ seq: 1, type: 'action', data: { actionName: action, pid, ...payload } });
      if (!event) throw new Error(`No event for ${action}`);
      playMapEvent(scene, event, 1000);
    };
    try {
      scene.syncSnapshot(snap, true);
      const visuals = ids.map((_, i) => entity(String(i + 1)).asset.id);
      if (visuals.includes('humanoid')) throw new Error(`Fallback asset still active: ${visuals.join(', ')}`);

      state('1', { possessing: '2' });
      players[0].invisible = true;
      scene.syncSnapshot(snap, false);
      cue('possess', '1', { targetId: '2' });
      const ghost = entity('1').rig.root.children[0];
      await waitFor(() => ghost.position.lengthSq() > .05, 'Ghost did not attach behind the host');
      cue('possessStrike', '1', { targetId: '2' });
      state('1', {});
      players[0].invisible = false;
      scene.syncSnapshot(snap, false);
      await waitFor(() => ghost.position.lengthSq() < .001, 'Ghost attachment did not clear');

      state('2', { mounted: true });
      scene.syncSnapshot(snap, false);
      cue('mount', '2');
      await waitFor(() => named('2', 'FootForm').position.y > .3, 'Wild Hunt did not mount');
      const charge = parseBattleEvent({ seq: 2, type: 'damage', data: {
        declared: true, source: '2', target: '3',
        presentation: { mounted: true, fromRoom: 'R1', toRoom: 'R2' },
      } });
      players[1].room = 'R2';
      scene.syncSnapshot(projectMapSnapshot(snap, [], snap, charge), false, .8);
      playMapEvent(scene, charge, 1000);
      await waitFor(() => entity('2').curRoom === 'R2' && !entity('2').walk, 'Charged character did not reach the authoritative room');
      if (Math.abs(named('2', 'ChargeOffset').position.z) > .001) throw new Error('Charge applied secondary root movement');

      playMapEvent(scene, { kind: 'attackDecl', seq: 3, sourceId: '3', targetId: '4' }, 1000);
      await waitFor(() => named('3', 'FireArrow').scale.x > .05, 'Archer never released the arrow');
      state('3', { downed: true });
      players[2].hp = 0;
      scene.syncSnapshot(snap, false);
      await waitFor(() => named('3', 'Head').scale.x < .3, 'Archer did not fall apart');
      state('3', {});
      players[2].hp = 1.5;
      scene.syncSnapshot(snap, false);
      await waitFor(() => named('3', 'Head').scale.x > .50, 'Archer did not reassemble');

      state('4', { towerBaseRoom: 'R2', towerHp: 6, buildProgress: 2, inTower: true });
      scene.syncSnapshot(snap, false);
      cue('buildTower', '4');
      await waitFor(() => !!scene.scene.getObjectByName('basalt-tower'), 'Tower was not mounted on the real room');
      state('4', { posthumous: true });
      players[3].hp = 0;
      players[3].invisible = true;
      scene.syncSnapshot(snap, true);
      await waitFor(() => Math.abs(entity('4').rig.materials()[0].opacity - .4) < .001, 'Posthumous water snake did not remain spectral');
      const wind = parseBattleEvent({ seq: 4, type: 'action', data: { pid: '4', actionName: 'blow', presentation: {
        targetIds: ['2','3'], moves: [{ pid: '2', fromRoom: 'R2', toRoom: 'R1' }, { pid: '3', fromRoom: 'R2', toRoom: 'R1' }],
      } } });
      players[1].room = 'R1';
      players[2].room = 'R1';
      scene.syncSnapshot(projectMapSnapshot(snap, [], snap, wind), false, .8);
      playMapEvent(scene, wind, 1000);
      if (!entity('2').walk?.curve || !entity('3').walk?.curve) throw new Error('Missing multi-target wind trajectory');
      await waitFor(() => !entity('2').walk && !entity('3').walk, 'Multi-target wind did not reach the authoritative rooms');
      return visuals;
    } finally {
      scene.dispose();
    }
  });
  assert.deepEqual(results, ['ghost-v1', 'wild-hunt-heathcliff-wraith', 'skeleton-archer-v1', 'flying-leech-v2']);
  assert.deepEqual(failures, []);
  console.log('Chromium: four rigs, mount/charge, attachment/drain, archer break/reassembly, tower and posthumous multi-target wind verified.');
} finally {
  await browser?.close();
  await vite.close();
}
