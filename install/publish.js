#!/usr/bin/env node
/**
 * Publish the current tree to GitHub through the REST API.
 *
 * Why: on some networks the git smart-HTTP endpoint (github.com/*.git) is reset or
 * times out while api.github.com works. `git push` then fails even though
 * authentication is fine. This script builds the commit server-side from the
 * working tree and moves the branch, using only api.github.com.
 *
 * Usage:
 *   GH_TOKEN=$(gh auth token) node install/publish.js                   # commit on top of remote head
 *   GH_TOKEN=$(gh auth token) node install/publish.js --squash          # flatten to one root commit
 *   GH_TOKEN=$(gh auth token) node install/publish.js --message "..." --branch main
 *
 * Env: GH_OWNER, GH_REPO, GH_TOKEN. Publishes what `git ls-files` reports.
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');

const OWNER = process.env.GH_OWNER || 'dilandaer';
const REPO = process.env.GH_REPO || 'lit-read-sharing';
const TOKEN = process.env.GH_TOKEN;
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const BRANCH = arg('--branch', 'main');
const MESSAGE = arg('--message', null);
const SQUASH = process.argv.includes('--squash');

if (!TOKEN) {
  console.error('GH_TOKEN is required (try: GH_TOKEN=$(gh auth token) node install/publish.js)');
  process.exit(1);
}
const H = { Authorization: 'token ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'lit-read-sharing-publish' };
const API = 'https://api.github.com';

async function call(method, p, body) {
  const r = await fetch(API + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(method + ' ' + p + ' -> ' + r.status + ' ' + text.slice(0, 500));
    err.status = r.status;
    throw err;
  }
  return JSON.parse(text);
}

const files = () => execSync('git ls-files', { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);

function entries(list) {
  return list.map((f) => ({ path: f, mode: '100644', type: 'blob', content: fs.readFileSync(f, 'utf8') }));
}

async function headSha() {
  try {
    return (await call('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)).object.sha;
  } catch (e) {
    if (e.status === 404 || e.status === 409) return null;
    throw e;
  }
}

async function main() {
  const list = files();
  if (!list.length) throw new Error('no tracked files');
  const message = MESSAGE || execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();

  if (SQUASH) {
    if (!(await headSha())) throw new Error('repo has no branch yet; run once without --squash to seed it');
    const t = await call('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: entries(list) });
    console.log('tree', t.sha, 'entries', t.tree.length);
    const c = await call('POST', `/repos/${OWNER}/${REPO}/git/commits`, { message, tree: t.sha, parents: [] });
    console.log('commit', c.sha, '(root)');
    await call('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: c.sha, force: true });
    console.log('branch', BRANCH, '->', c.sha, '(forced)');
  } else {
    let head = await headSha();
    if (!head) {
      // empty repo: the tree API refuses until one object exists
      const seed = list[0];
      await call('PUT', `/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(seed)}`, {
        message: 'seed: ' + seed,
        content: Buffer.from(fs.readFileSync(seed)).toString('base64'),
        branch: BRANCH,
      });
      head = await headSha();
      console.log('seeded empty repo, head', head);
    }
    const parent = await call('GET', `/repos/${OWNER}/${REPO}/git/commits/${head}`);
    const t = await call('POST', `/repos/${OWNER}/${REPO}/git/trees`, { base_tree: parent.tree.sha, tree: entries(list) });
    console.log('parent', parent.sha, '-> tree', t.sha);
    const c = await call('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
      message,
      tree: t.sha,
      parents: [parent.sha],
    });
    console.log('commit', c.sha);
    await call('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: c.sha });
    console.log('branch', BRANCH, '->', c.sha);
  }

  const repo = await call('GET', `/repos/${OWNER}/${REPO}`);
  const tree = await call('GET', `/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`);
  console.log('repo', repo.html_url, repo.visibility, 'default=' + repo.default_branch);
  console.log('blobs', tree.tree.filter((x) => x.type === 'blob').length);
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
