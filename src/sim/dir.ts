/** 0 = 위, 1 = 오른쪽, 2 = 아래, 3 = 왼쪽 */
export type Dir = 0 | 1 | 2 | 3;

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;
export const rotateCW = (d: Dir): Dir => ((d + 1) % 4) as Dir;

/** 인접한 두 칸 사이의 방향. 인접하지 않으면 null */
export function dirOf(dx: number, dy: number): Dir | null {
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === 0) return 1;
  if (dx === 0 && dy === 1) return 2;
  if (dx === -1 && dy === 0) return 3;
  return null;
}
