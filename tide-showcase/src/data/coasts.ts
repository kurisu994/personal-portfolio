import type { TideModel } from '../tide/model';

export type TerrainKind = 'beach' | 'mudflat' | 'rocky';

/**
 * 海岸预设：分潮振幅决定潮型，地形、涌浪与水色决定画面气质。
 * 振幅是典型值而非某个港口的实测调和常数；坐标与时区只用于日照和当地钟面时间。
 */
export interface Coast {
  id: 'beach' | 'estuary' | 'inlet';
  name: string;
  nameEn: string;
  /** 参照地，用于日月位置 */
  lat: number;
  lon: number;
  tz: string;
  /** 面海方向的方位角（度） */
  facing: number;
  description: string;
  model: TideModel;
  terrain: TerrainKind;
  seed: number;
  /** 离岸涌浪：波高（米）、周期（秒）、上冲高度（米） */
  swell: { height: number; period: number; runup: number };
  /** 水色（线性 RGB）与浑浊度（每米衰减） */
  water: { deep: [number, number, number]; shallow: [number, number, number]; turbidity: number };
}

export const COASTS: Coast[] = [
  {
    id: 'beach',
    name: '细沙滩',
    nameEn: 'Sand Beach',
    lat: 36.05,
    lon: 120.6,
    tz: 'Asia/Shanghai',
    facing: 100,
    description: '开阔海岸，半日潮为主，沙坝外有一道碎浪',
    model: {
      z0: 0,
      constituents: [
        { name: 'M2', amp: 1.2, lag: 110 },
        { name: 'S2', amp: 0.35, lag: 110 },
        { name: 'K1', amp: 0.15, lag: 200 },
        { name: 'O1', amp: 0.12, lag: 185 },
      ],
    },
    terrain: 'beach',
    seed: 17,
    swell: { height: 0.55, period: 8.5, runup: 0.42 },
    water: { deep: [0.012, 0.07, 0.11], shallow: [0.08, 0.36, 0.34], turbidity: 0.6 },
  },
  {
    id: 'estuary',
    name: '河口泥滩',
    nameEn: 'Estuary Flat',
    lat: 31.3,
    lon: 121.9,
    tz: 'Asia/Shanghai',
    facing: 80,
    description: '潮差大、滩面宽，涨潮快落潮慢，潮沟蜿蜒',
    model: {
      z0: 0,
      constituents: [
        { name: 'M2', amp: 1.85, lag: 60 },
        { name: 'S2', amp: 0.6, lag: 60 },
        { name: 'N2', amp: 0.34, lag: 42 },
        { name: 'K1', amp: 0.26, lag: 170 },
        { name: 'O1', amp: 0.19, lag: 152 },
        { name: 'M4', amp: 0.2, lag: 30 },
      ],
    },
    terrain: 'mudflat',
    seed: 43,
    swell: { height: 0.16, period: 5.5, runup: 0.14 },
    water: { deep: [0.06, 0.055, 0.03], shallow: [0.24, 0.19, 0.1], turbidity: 2.2 },
  },
  {
    id: 'inlet',
    name: '内海',
    nameEn: 'Inland Sea',
    lat: 34.3,
    lon: 133.0,
    tz: 'Asia/Tokyo',
    facing: 170,
    description: '潮差小，日潮不等明显，礁石间藏着潮池',
    model: {
      z0: 0,
      constituents: [
        { name: 'M2', amp: 0.38, lag: 250 },
        { name: 'S2', amp: 0.15, lag: 250 },
        { name: 'K1', amp: 0.3, lag: 190 },
        { name: 'O1', amp: 0.24, lag: 172 },
      ],
    },
    terrain: 'rocky',
    seed: 71,
    swell: { height: 0.12, period: 4.5, runup: 0.1 },
    water: { deep: [0.015, 0.07, 0.09], shallow: [0.08, 0.3, 0.27], turbidity: 0.35 },
  },
];
