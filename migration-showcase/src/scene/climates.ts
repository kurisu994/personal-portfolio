import { mixTuple, mod, smoothstep } from './math';

export type ColorTuple = readonly [number, number, number];

export interface ClimatePalette {
  name: string;
  en: string;
  sky: ColorTuple;
  horizon: ColorTuple;
  ground: ColorTuple;
  fields: readonly ColorTuple[];
  river: ColorTuple;
  bank: ColorTuple;
  wall: ColorTuple;
  roof: ColorTuple;
  tree: ColorTuple;
  ink: ColorTuple;
  bird: ColorTuple;
  accent: ColorTuple;
  night: number;
  snow: number;
  dusk: number;
  mist: number;
}

export interface ClimateSample extends Omit<ClimatePalette, 'name' | 'en' | 'fields'> {
  fields: ColorTuple[];
  index: number;
  from: number;
  to: number;
  blend: number;
  front: number;
}

const rgb = (r: number, g: number, b: number): ColorTuple => [r / 255, g / 255, b / 255];

export const SEGMENT_LENGTH = 8600;

export const CLIMATES: readonly ClimatePalette[] = [
  {
    name: '暖纸', en: 'WARM', sky: rgb(244, 240, 230), horizon: rgb(250, 238, 214), ground: rgb(214, 214, 190),
    fields: [rgb(203, 207, 166), rgb(222, 214, 181), rgb(232, 223, 197), rgb(188, 199, 158), rgb(211, 212, 178), rgb(228, 222, 201)],
    river: rgb(137, 174, 174), bank: rgb(224, 219, 198), wall: rgb(229, 218, 194), roof: rgb(161, 113, 91), tree: rgb(124, 146, 98),
    ink: rgb(53, 51, 44), bird: rgb(249, 247, 237), accent: rgb(157, 126, 72), night: 0, snow: 0, dusk: 0, mist: 0.08,
  },
  {
    name: '雾境', en: 'MIST', sky: rgb(218, 229, 225), horizon: rgb(232, 235, 225), ground: rgb(184, 202, 191),
    fields: [rgb(174, 197, 184), rgb(199, 214, 198), rgb(215, 221, 209), rgb(163, 190, 176), rgb(184, 203, 185), rgb(207, 219, 210)],
    river: rgb(137, 176, 178), bank: rgb(206, 217, 207), wall: rgb(216, 223, 211), roof: rgb(129, 151, 144), tree: rgb(107, 147, 134),
    ink: rgb(53, 72, 69), bird: rgb(236, 243, 239), accent: rgb(93, 132, 125), night: 0, snow: 0, dusk: 0, mist: 0.72,
  },
  {
    name: '暮粉', en: 'DUSK', sky: rgb(239, 217, 207), horizon: rgb(255, 206, 174), ground: rgb(207, 186, 165),
    fields: [rgb(205, 177, 160), rgb(222, 195, 174), rgb(228, 207, 191), rgb(181, 183, 151), rgb(210, 189, 170), rgb(221, 202, 187)],
    river: rgb(157, 173, 176), bank: rgb(226, 203, 184), wall: rgb(235, 207, 180), roof: rgb(157, 102, 102), tree: rgb(145, 153, 113),
    ink: rgb(80, 54, 57), bird: rgb(249, 232, 220), accent: rgb(163, 91, 92), night: 0, snow: 0, dusk: 1, mist: 0.18,
  },
  {
    name: '雪境', en: 'SNOW', sky: rgb(222, 230, 231), horizon: rgb(239, 235, 226), ground: rgb(218, 226, 223),
    fields: [rgb(207, 218, 215), rgb(232, 236, 232), rgb(220, 229, 227), rgb(200, 215, 212), rgb(213, 225, 222), rgb(229, 234, 231)],
    river: rgb(137, 174, 183), bank: rgb(241, 243, 238), wall: rgb(222, 226, 219), roof: rgb(119, 143, 151), tree: rgb(111, 146, 139),
    ink: rgb(56, 73, 81), bird: rgb(242, 247, 248), accent: rgb(101, 136, 147), night: 0, snow: 1, dusk: 0, mist: 0.32,
  },
  {
    name: '夜航', en: 'NIGHT', sky: rgb(21, 34, 48), horizon: rgb(49, 65, 77), ground: rgb(34, 54, 61),
    fields: [rgb(36, 59, 65), rgb(44, 63, 72), rgb(51, 70, 75), rgb(29, 54, 57), rgb(40, 63, 65), rgb(46, 68, 75)],
    river: rgb(29, 60, 79), bank: rgb(60, 76, 81), wall: rgb(91, 109, 116), roof: rgb(42, 64, 76), tree: rgb(27, 65, 63),
    ink: rgb(220, 229, 225), bird: rgb(175, 204, 221), accent: rgb(199, 216, 177), night: 1, snow: 0, dusk: 0, mist: 0.2,
  },
];

/** 气候锋面由绝对世界坐标决定，横向扰动使过渡边缘自然参差。 */
export function sampleClimate(x: number, z: number): ClimateSample {
  const warped = z + Math.sin(x * 0.0029 + Math.sin(z * 0.00029)) * 390 + Math.sin(x * 0.0061 + z * 0.00037) * 155;
  const section = Math.floor((warped + 1650) / SEGMENT_LENGTH);
  const blend = smoothstep(-1650, 1650, warped - section * SEGMENT_LENGTH);
  const from = mod(section - 1, CLIMATES.length);
  const to = mod(section, CLIMATES.length);
  const a = CLIMATES[from];
  const b = CLIMATES[to];
  const mix = (key: 'sky' | 'horizon' | 'ground' | 'river' | 'bank' | 'wall' | 'roof' | 'tree' | 'ink' | 'bird' | 'accent') => mixTuple(a[key], b[key], blend);
  return {
    sky: mix('sky'), horizon: mix('horizon'), ground: mix('ground'), river: mix('river'), bank: mix('bank'),
    wall: mix('wall'), roof: mix('roof'), tree: mix('tree'), ink: mix('ink'), bird: mix('bird'), accent: mix('accent'),
    fields: a.fields.map((color, index) => mixTuple(color, b.fields[index], blend)),
    night: a.night + (b.night - a.night) * blend,
    snow: a.snow + (b.snow - a.snow) * blend,
    dusk: a.dusk + (b.dusk - a.dusk) * blend,
    mist: a.mist + (b.mist - a.mist) * blend,
    index: blend < 0.5 ? from : to,
    from,
    to,
    blend,
    front: Math.sin(blend * Math.PI),
  };
}

