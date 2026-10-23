/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import { attachRelay } from './server/relay.mjs';

/** 같이 하기 중계 서버(server/relay.mjs)를 개발 서버와 preview 서버에 붙인다 */
function lanServer(): Plugin {
  const attach = (http: Server | null) => {
    if (http) attachRelay(http);
  };
  return {
    name: 'lan-server',
    configureServer: (server) => attach(server.httpServer as Server | null),
    configurePreviewServer: (server) => attach(server.httpServer as Server | null),
  };
}

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [lanServer()],
  // 같은 공유기의 다른 PC가 들어올 수 있게 늘 네트워크에 연다 (npm run dev로 켜도 방을 만들 수 있게)
  // (.claude를 지켜보지 않게 하면 .claude/worktrees 안에서 띄운 세션 서버가 자기 파일 변화도 못 봐서 두지 않는다)
  server: { host: true },
  preview: { host: true },
  // 게임 버전 (src/version.ts). 같이 하기는 방장·손님 버전과 빌드가 같아야 들어갈 수 있다
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  // 다른 세션의 작업 폴더(.claude/worktrees) 테스트까지 같이 돌지 않게
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
