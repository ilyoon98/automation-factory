// @ts-check
// exe 만들기. npm run exe / npm run release가 dist를 빌드한 다음 부른다.
//   (옵션 없음)      설치 파일만 만든다 → release/AutomationFactory-Setup-<버전>.exe
//   --publish        만든 다음 깃허브 릴리스에 올린다 (GH_TOKEN 필요). 깔려 있는 게임들이 이걸 보고 업데이트한다
//   --out <폴더>    실행 중인 기존 빌드와 겹치지 않는 별도 출력 폴더
//   --feed <주소>    시험용: 깃허브 대신 이 주소에서 업데이트를 찾는 exe를 만든다 (예: http://127.0.0.1:8765/)
// 시험용 환경 변수 GH_API · GH_UPLOADS: --publish가 깃허브 대신 이 주소로 올린다 (가짜 깃허브 서버로 올리기 흐름을 시험할 때)
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
const outAt = args.indexOf('--out');
if (outAt >= 0 && (!args[outAt + 1] || args[outAt + 1].startsWith('--'))) {
  console.error('--out 다음에 출력 폴더를 지정해 주세요.');
  process.exit(1);
}
const out = path.resolve(root, outAt >= 0 ? args[outAt + 1] : 'release');

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
if (feed || outAt >= 0) {
  config = path.join(tmpdir(), `automation-factory-build-${process.pid}.json`);
  writeFileSync(config, JSON.stringify({ ...pkg.build,
    directories: { ...pkg.build.directories, output: out },
    ...(feed ? { publish: [{ provider: 'generic', url: feed }] } : {}),
  }));
}
// 올릴 릴리스를 먼저 준비한다 (이미 올린 버전이면 빌드하기 전에 멈춘다)
const gh = publish ? githubRelease(pkg.build.publish[0], `v${version}`) : null;
const release = gh ? await gh.prepare() : null;
try {
  // 올리기는 electron-builder에게 맡기지 않고 아래에서 직접 한다 (githubRelease 설명). 빌드만 해도 latest.yml은 만들어진다
  await builder.build({ projectDir: root, win: ['nsis'], publish: 'never', config });
} finally {
  if (config) rmSync(config, { force: true });
}
const exe = `AutomationFactory-Setup-${version}.exe`;
console.log(`\n완성: ${path.join(out, exe)}`);
if (gh && release) {
  // 설치 파일 → 조각 지도 → latest.yml 차례로: latest.yml이 가리키는 설치 파일이 늘 먼저 올라가 있게
  await gh.upload(release, [exe, `${exe}.blockmap`, 'latest.yml'].map((n) => path.join(out, n)));
  await gh.publish(release, releaseNotes(version));
  await gh.check([exe, `${exe}.blockmap`, 'latest.yml']);
  console.log(`깃허브 릴리스 v${version}에 올렸어요. 깔려 있는 게임은 다음에 켤 때 업데이트 알림이 떠요.`);
}

/** docs/바뀐점.md에서 "## <버전>" 부분 (릴리스 설명에 넣는다). 없으면 null */
function releaseNotes(v) {
  let md;
  try {
    md = readFileSync(path.join(root, 'docs', '바뀐점.md'), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    md = '';
  }
  const start = md.indexOf(`\n## ${v}\n`);
  if (start < 0) {
    console.warn(`docs/바뀐점.md에 "## ${v}"가 없어서 설명 없이 올려요.`);
    return null;
  }
  const rest = md.slice(start + `\n## ${v}\n`.length);
  const end = rest.search(/\n## /);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

/**
 * 깃허브 릴리스에 올리기.
 * 예전에는 electron-builder가 올렸는데, 파일마다 따로 릴리스를 찾다가 미리 만든 숨김 릴리스를 못 보고
 * 같은 태그로 공개 릴리스를 하나 더 만들어 파일이 두 릴리스에 나뉘었다 (0.2.0 때 .blockmap만 숨김 릴리스에).
 * 그래서 숨김 릴리스(draft) 하나에 세 파일을 차례로 직접 올리고, 다 올라간 다음 공개한다
 * (반쯤 올라간 릴리스가 친구들에게 안 보이게).
 * @param {{ owner: string; repo: string }} where @param {string} tag
 */
function githubRelease({ owner, repo }, tag) {
  const api = `${process.env.GH_API ?? 'https://api.github.com'}/repos/${owner}/${repo}`;
  const uploads = `${process.env.GH_UPLOADS ?? 'https://uploads.github.com'}/repos/${owner}/${repo}`;
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'automation-factory' };
  /** @param {string} p @param {RequestInit} [init] */
  const call = async (p, init) => {
    const r = await fetch(api + p, { ...init, headers: { ...headers, 'Content-Type': 'application/json' } });
    if (!r.ok) throw new Error(`깃허브 ${init?.method ?? 'GET'} ${p} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json();
  };
  /**
   * 이 태그의 릴리스. 같은 태그가 여럿이면 (예전에 나뉘어 올라간 것) 공개한 것을 먼저
   * @returns {Promise<{ id: number; draft: boolean; published_at: string | null; assets: { id: number; name: string }[] } | undefined>}
   */
  const find = async () => {
    const all = (await call('/releases?per_page=100')).filter((/** @type {{ tag_name: string }} */ r) => r.tag_name === tag);
    return all.find((/** @type {{ draft: boolean }} */ r) => !r.draft) ?? all[0];
  };
  return {
    /** 숨김 릴리스를 만든다 (지난번에 올리다 만 숨김 릴리스가 있으면 그것). 이미 공개한 버전이면 멈춘다 (같은 버전을 두 번 올리면 이미 받은 사람에게 업데이트가 안 뜬다) */
    async prepare() {
      const found = await find();
      if (found && !found.draft) {
        const fresh = Date.now() - Date.parse(found.published_at ?? '') < 2 * 3600 * 1000;
        if (!fresh) {
          console.error(`${tag}는 이미 올렸어요. 버전을 올린 다음 다시 해 주세요: npm version patch --no-git-tag-version`);
          process.exit(1);
        }
        // 방금(2시간 안) 공개했는데 덜 올라간 릴리스: 파일을 다시 올려 채운다
        return found;
      }
      if (found) return found;
      const repoInfo = await call('');
      return call('/releases', {
        method: 'POST',
        body: JSON.stringify({ tag_name: tag, name: version, draft: true, target_commitish: repoInfo.default_branch }),
      });
    },
    /** 파일을 하나씩 올린다. 같은 이름이 이미 있으면 (지난번에 올리다 만 것) 지우고 새 빌드로 바꾼다 @param {{ id: number }} release @param {string[]} files */
    async upload(release, files) {
      const { assets } = await call(`/releases/${release.id}`);
      for (const file of files) {
        const name = path.basename(file);
        const old = assets.find((/** @type {{ name: string }} */ a) => a.name === name);
        if (old) await call(`/releases/assets/${old.id}`, { method: 'DELETE' });
        const data = readFileSync(file);
        console.log(`올리는 중: ${name} (${(data.length / 1e6).toFixed(1)}MB)`);
        const r = await fetch(`${uploads}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/octet-stream' },
          body: data,
        });
        if (!r.ok) throw new Error(`깃허브 올리기 ${name} → ${r.status} ${(await r.text()).slice(0, 200)}`);
      }
    },
    /** 공개하고 최신 릴리스로. 바뀐 점이 있으면 설명에 넣는다 @param {{ id: number }} release @param {string | null} notes */
    async publish(release, notes) {
      await call(`/releases/${release.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ draft: false, make_latest: 'true', ...(notes ? { body: notes } : {}) }),
      });
    },
    /** 업데이트에 필요한 파일이 다 올라갔는지 @param {string[]} need */
    async check(need) {
      const r = await find();
      const names = new Set((r?.assets ?? []).map((a) => a.name));
      const missing = need.filter((n) => !names.has(n));
      if (r?.draft || missing.length) {
        console.error(`릴리스가 덜 올라갔어요 (${r?.draft ? '아직 숨김 상태' : ''} ${missing.join(', ')}). npm run release를 한 번 더 해 주세요`);
        process.exit(1);
      }
    },
  };
}
