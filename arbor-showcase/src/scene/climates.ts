import { Color } from 'three';
import { bezier4, clamp, mix } from './math';

export interface Climate {
  index: number;
  skyTop: Color;
  skyBottom: Color;
  ground: Color;
  trunk: Color;
  leaf: Color;
  accent: Color;
  particle: Color;
  light: Color;
  ambient: Color;
  lightIntensity: number;
  ambientIntensity: number;
  fogDensity: number;
  darkness: number;
  mist: number;
}
const palettes = [
  ['#e2c99a', '#9c835e', '#352b22', '#514130', '#a3aa65', '#d9b779', '#ead3a5', '#ffe2ad', '#b9a58b', 1.1, 1.0, .020, 1, .12],
  ['#dce6d4', '#a3bdad', '#697c60', '#70654c', '#739867', '#788a69', '#c5dfb6', '#fff0cb', '#bfcbbb', 1.3, 1.2, .026, 0, .68],
  ['#e1b4a8', '#a890a7', '#645463', '#5a474b', '#667457', '#ad755d', '#edc0d9', '#ffc69a', '#c3a3b7', 1.7, .8, .012, .35, .18],
  ['#c1d3bf', '#819e94', '#4c6656', '#4b5140', '#476d4d', '#718361', '#afc8a0', '#e6e6ab', '#9cb9a7', 1.15, 1.15, .013, .22, .22],
  ['#f3e7c9', '#d0dbc5', '#a5ad83', '#655b42', '#70805a', '#aa7953', '#efdfb3', '#fff0c5', '#c2d1ba', 1.45, 1.15, .009, 0, .10],
] as const;
export const STAGES = [
  { name: '藏春', en: 'WARM', note: '一粒种子，安住土中。' },
  { name: '初见', en: 'MIST', note: '微光落处，新绿初生。' },
  { name: '向远', en: 'DUSK', note: '枝向天去，根在土中。' },
  { name: '听风', en: 'FOREST', note: '万叶有声，归于一风。' },
  { name: '归一', en: 'RECOMPENSE', note: '果熟鸟归，一木成境。' },
] as const;
const keys = ['skyTop', 'skyBottom', 'ground', 'trunk', 'leaf', 'accent', 'particle', 'light', 'ambient'] as const;
const colors = palettes.map(p => keys.map((_, i) => new Color(p[i] as string)));

/** 生命气候以跨阶段的长过渡衔接，主体颜色各有停留，不出现硬切。 */
export function sampleClimate(progress: number): Climate {
  const p = clamp(progress);
  const index = Math.min(4, Math.floor(p * 5));
  const segment = p * 5;
  const boundary = Math.floor(segment + 0.24);
  const a = Math.max(0, boundary - 1);
  const b = Math.min(4, boundary);
  const t = bezier4(clamp((segment - boundary + .24) / .48));
  const result = { index } as Climate;
  keys.forEach((key, n) => { result[key] = colors[a][n].clone().lerp(colors[b][n], t); });
  result.lightIntensity = mix(palettes[a][9], palettes[b][9], t);
  result.ambientIntensity = mix(palettes[a][10], palettes[b][10], t);
  result.fogDensity = mix(palettes[a][11], palettes[b][11], t);
  result.darkness = mix(palettes[a][12], palettes[b][12], t);
  result.mist = mix(palettes[a][13], palettes[b][13], t);
  return result;
}
