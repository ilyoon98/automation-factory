// vite.config.ts의 define이 채운다
declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

/** 게임 버전 (package.json의 version). 새 버전을 올릴 때 바꾼다 (README "새 버전 올리기") */
export const VERSION = __APP_VERSION__;
/**
 * 이 빌드의 번호 (빌드할 때마다 바뀐다). 같은 버전이라도 다시 빌드한 게임끼리는 시뮬레이션 코드가 다를 수 있어서,
 * 같이 하기는 버전과 빌드가 모두 같아야 들어간다
 */
export const BUILD_ID = __BUILD_ID__;
