// exe에서만: 게임 화면이 같은 와이파이의 방 목록과 업데이트 소식을 받을 수 있게 (브라우저로 열면 window.desktop이 없다)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  /** 같은 와이파이에서 찾은 방 목록. 1초마다 온다 */
  onLanRooms(cb) {
    ipcRenderer.on('lan-rooms', (_e, rooms) => cb(rooms));
  },
  /** 업데이트 상태 (새 버전 있음 · 받는 중 · 설치 중 · 오류) */
  onUpdate(cb) {
    ipcRenderer.on('update', (_e, s) => cb(s));
  },
  /** 새 버전 받기. 다 받으면 저절로 다시 시작한다 */
  downloadUpdate() {
    ipcRenderer.send('update-download');
  },
});
