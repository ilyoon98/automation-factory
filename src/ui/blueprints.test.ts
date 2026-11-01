import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Blueprint } from '../sim/blueprint';
import { blueprintCode, parseBlueprintCode } from './blueprints';

afterEach(()=>vi.unstubAllGlobals());

it('입출력 방향 설정이 공유 코드에도 유지된다', async () => {
  const bp: Blueprint = { w: 1, h: 1, entries: [{ type: 'sorter', dx: 0, dy: 0, dir: 0, recipe: null, filter: 'coal', junction: { inputs: 8, outputs: 3 } }] };
  expect((await parseBlueprintCode(await blueprintCode('연속 분류', bp)))?.bp).toEqual(bp);
});

async function rawCode(value:unknown):Promise<string>{
  const stream=new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  return 'AF1.'+btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

it('공유 코드의 손상된 행을 제외해도 정상 건물은 가져온다',async()=>{
  const code=await rawCode({n:'혼합',w:2,h:1,e:[null,['constructor',0,0,1],['belt',null,0,1],['belt',0,0,1]]});
  const result=await parseBlueprintCode(code);
  expect(result?.bp.entries).toEqual([{type:'belt',dx:0,dy:0,dir:1,recipe:null,filter:null}]);
});

it.each([0,-1,null,'2'])('잘못된 청사진 너비 %s는 미리보기·붙여넣기로 넘기지 않는다',async w=>{
  expect(await parseBlueprintCode(await rawCode({n:'손상',w,h:1,e:[['belt',0,0,1]]}))).toBeNull();
});

it('손상된 청사진 한 개 때문에 뒤에 저장한 정상 청사진을 잃지 않는다', async()=>{
  vi.resetModules();
  const bp={w:1,h:1,entries:[{type:'belt',dx:0,dy:0,dir:1,recipe:null,filter:null}]};
  const raw=[{name:'손상',bp:{...bp,entries:[null]}},{name:'정상',bp,at:123}];
  const setItem=vi.fn();vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify(raw),setItem});
  const saved=(await import('./blueprints')).blueprints();
  expect(saved.map(s=>s.name)).toEqual(['정상']);expect(saved[0].bp).toEqual(bp);expect(setItem).not.toHaveBeenCalled();
});

it('혼합 저장의 잘못된 건물·좌표는 건너뛰고 유효한 건물은 남긴다', async()=>{
  vi.resetModules();
  const good={type:'belt',dx:0,dy:0,dir:1,recipe:null,filter:null};
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify([{name:'혼합',bp:{w:2,h:1,entries:[{...good,type:'constructor'},{...good,dx:null},good]}}])});
  expect((await import('./blueprints')).blueprints()[0].bp.entries).toEqual([good]);
});

describe('청사진 공유 코드', () => {
  const bp: Blueprint = {
    w: 6,
    h: 4,
    entries: [
      { type: 'assembler', dx: 0, dy: 0, dir: 1, recipe: 'gear', filter: null },
      { type: 'sorter', dx: 3, dy: 0, dir: 2, recipe: null, filter: 'coal' },
      { type: 'station', dx: 0, dy: 3, dir: 0, recipe: null, filter: null, mode: 'unload' },
      { type: 'belt', dx: 1, dy: 3, dir: 1, recipe: null, filter: null },
    ],
  };

  it('코드로 바꿨다 되돌리면 이름·건물·방향·레시피·아이템·정류장 종류가 그대로', async () => {
    const code = await blueprintCode('기어 공장', bp);
    expect(code.startsWith('AF1.')).toBe(true);
    expect(code).not.toMatch(/[\s+/=]/);
    const got = await parseBlueprintCode(`  ${code}\n`);
    expect(got).toEqual({ name: '기어 공장', bp });
  });

  it('코드가 아니거나 잘렸으면 null, 모르는 건물은 뺀다', async () => {
    expect(await parseBlueprintCode('안녕')).toBeNull();
    const code = await blueprintCode('x', bp);
    expect(await parseBlueprintCode(code.slice(0, 20))).toBeNull();
    const odd = await blueprintCode('x', { w: 2, h: 2, entries: [{ ...bp.entries[0], type: 'rocket' as never }, bp.entries[3]] });
    expect((await parseBlueprintCode(odd))!.bp.entries.map((e) => e.type)).toEqual(['belt']);
  });
});
