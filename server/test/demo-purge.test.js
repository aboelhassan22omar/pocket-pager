import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { openStorage } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { ensureDemo, purgeSandboxes } from '../src/demo.js';

// The real removal: control rows and the café's files on disk, nothing else.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-demo-purge-'));
const config = loadConfig({ DATA_DIR: dataDir, PUBLIC_URL: 'http://localhost', COOKIE_SECRET: 'x'.repeat(40) });
const { control, tenants } = openStorage(config);
after(() => {
  tenants.closeAll();
  control.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('an idle visitor café is removed with its files; a fresh one and real brands stay', async () => {
  const old = await ensureDemo({ control, tenants, config });
  const fresh = await ensureDemo({ control, tenants, config });
  control.createBrand({ id: 'real', name: 'Real' });
  control.createBranch({ id: 'real-a', brandId: 'real', name: 'Real A' });
  tenants.get('real-a');
  const dir = path.join(dataDir, 'tenants', old.id);
  assert.ok(fs.existsSync(dir));

  control.touch(old.id, Date.now() - 25 * 3600_000);
  assert.equal(purgeSandboxes({ control, tenants }), 1);
  assert.equal(control.getBrand(old.id), undefined);
  assert.equal(control.getBranch(old.id), undefined);
  assert.equal(control.ownersOfBrand(old.id).length, 0);
  assert.ok(!fs.existsSync(dir), 'files gone');
  assert.ok(control.getBranch(fresh.id));
  assert.ok(control.getBranch('real-a'));
  assert.ok(fs.existsSync(path.join(dataDir, 'tenants', 'real')));
});
