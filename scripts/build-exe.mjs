// @ts-check
// exe 만들기. npm run exe / npm run release가 dist를 빌드한 다음 부른다.
//   (옵션 없음)      설치 파일만 만든다 → release/AutomationFactory-Setup-<버전>.exe
//   --publish        만든 다음 깃허브 릴리스에 올린다 (GH_TOKEN 필요). 깔려 있는 게임들이 이걸 보고 업데이트한다
//   --feed <주소>    시험용: 깃허브 대신 이 주소에서 업데이트를 찾는 exe를 만든다 (예: http://127.0.0.1:8765/)
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const builder = require('electron-builder');

const args = process.argv.slice(2);
const publish = args.includes('--publish');
const feedAt = args.indexOf('--feed');
const feed = feedAt >= 0 ? args[feedAt + 1] : null;

if (publish && !process.env.GH_TOKEN) {
  console.error('GH_TOKEN이 없어요. README의 "새 버전 올리기"를 보고 토큰을 넣은 다음 다시 해 주세요.');
  process.exit(1);
}
if (publish && feed) {
  console.error('--publish와 --feed는 같이 쓸 수 없어요.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const { version } = pkg;
/** 시험용: package.json의 build 설정을 그대로 쓰되 업데이트 주소만 바꾼 설정 파일 (객체로 넘기면 깃허브 설정과 섞인다) */
let config;
if (feed) {
  config = path.join(tmpdir(), `automation-factory-build-${process.pid}.json`);
  writeFileSync(config, JSON.stringify({ ...pkg.build, publish: [{ provider: 'generic', url: feed }] }));
}
/**
 * 깃허브에 올릴 때: electron-builder는 파일 여러 개를 동시에 올리면서 릴리스를 두 번 만들려다 부딪힌다
 * ("Published releases must have a valid tag", 설치 파일만 올라가고 .blockmap·latest.yml이 빠짐).
 * 그래서 숨김 릴리스(draft)를 먼저 만들어 두고, 다 올린 다음 공개한다 (반쯤 올라간 릴리스가 친구들에게 안 보이게).
 */
const gh = publish ? githubRelease(pkg.build.publish[0], `v${version}`) : null;
const draft = gh ? await gh.prepare() : null;
try {
  await builder.build({ projectDir: root, win: ['nsis'], publish: publish ? 'always' : 'never', config });
} finally {
  if (config) rmSync(config, { force: true });
}
if (gh && draft) await gh.publish(draft);
console.log(`\n완성: ${path.join(root, 'release', `AutomationFactory-Setup-${version}.exe`)}`);
if (gh) {
  await gh.check();
  console.log(`깃허브 릴리스 v${version}에 올렸어요. 깔려 있는 게임은 다음에 켤 때 업데이트 알림이 떠요.`);
}

/** @param {{ owner: string; repo: string }} where @param {string} tag */
function githubRelease({ owner, repo }, tag) {
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'automation-factory' };
  /** @param {string} p @param {RequestInit} [init] */
  const call = async (p, init) => {
    const r = await fetch(api + p, { ...init, headers: { ...headers, 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error(`깃허브 ${init?.method ?? 'GET'} ${p} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  const find = async () => (await call('/releases?per_page=100')).find((/** @type {{ tag_name: string }} */ r) => r.tag_name === tag);
  return {
    /** 숨김 릴리스를 만든다. 이미 공개한 버전이면 멈춘다 (같은 버전을 두 번 올리면 이미 받은 사람에게 업데이트가 안 뜬다) */
    async prepare() {
      const found = await find();
      if (found && !found.draft) {
        const fresh = Date.now() - Date.parse(found.published_at) < 2 * 3600 * 1000;
        if (!fresh) {
          console.error(`${tag}는 이미 올렸어요. 버전을 올린 다음 다시 해 주세요: npm version patch --no-git-tag-version`);
          process.exit(1);
        }
        // 방금(2시간 안) 올리다 만 릴리스: electron-builder가 빠진 파일을 채운다
        return null;
      }
      if (found) return found;
      const repoInfo = await call('');
      return call('/releases', {
        method: 'POST',
        body: JSON.stringify({ tag_name: tag, name: version, draft: true, target_commitish: repoInfo.default_branch }),
      });
    },
    /** @param {{ id: number }} release */
    async publish(release) {
      await call(`/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ draft: false, make_latest: 'true' }) });
    },
    /** 업데이트에 필요한 파일이 다 올라갔는지 */
    async check() {
      const r = await find();
      const names = new Set((r?.assets ?? []).map((/** @type {{ name: string }} */ a) => a.name));
      const need = ['latest.yml', `AutomationFactory-Setup-${version}.exe`, `AutomationFactory-Setup-${version}.exe.blockmap`];
      const missing = need.filter((n) => !names.has(n));
      if (r?.draft || missing.length) {
        console.error(`릴리스가 덜 올라갔어요 (${r?.draft ? '아직 숨김 상태' : ''} ${missing.join(', ')}). npm run release를 한 번 더 해 주세요`);
        process.exit(1);
      }
    },
  };
}
