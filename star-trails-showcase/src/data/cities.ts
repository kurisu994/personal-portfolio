/** 地形轮廓：丘陵、峻峰、平顶山、沙丘、平地 */
export type TerrainShape = 'hills' | 'peaks' | 'mesa' | 'dunes' | 'flat';

/** 近景地物：针叶林、长城、天文台圆顶、城市天际线；远景火山锥 */
export type TerrainFeature = 'none' | 'trees' | 'wall' | 'domes' | 'skyline' | 'cone';

export interface TerrainLayer {
  shape: TerrainShape;
  /** 轮廓高度（视图单位，画面半高为 1） */
  amp: number;
  freq: number;
  /** 分形粗糙度，越大越嶙峋 */
  rough: number;
}

/** 前景剪影参数，由着色器按种子程序化生成 */
export interface Terrain {
  far: TerrainLayer;
  near: TerrainLayer;
  feature: TerrainFeature;
  /** 前景是否临水：水面会倒映星轨 */
  water: boolean;
}

/** 观测地：坐标、时区、地貌与夜空质量 */
export interface City {
  name: string;
  nameEn: string;
  lat: number;
  lon: number;
  /** IANA 时区，用于换算当地钟面时间 */
  tz: string;
  description: string;
  terrain: Terrain;
  /** 地平线光污染强度 0..1 */
  skyglow: number;
  /** 该地能记录到的极限星等 */
  limitMag: number;
}

const layer = (shape: TerrainShape, amp: number, freq = 1.2, rough = 0.5): TerrainLayer => ({ shape, amp, freq, rough });

export const CITIES: City[] = [
  {
    name: '北京',
    nameEn: 'Beijing',
    lat: 39.9042,
    lon: 116.4074,
    tz: 'Asia/Shanghai',
    description: '燕山长城脚下，北极星离地约 40°',
    terrain: { far: layer('hills', 0.22, 0.9, 0.55), near: layer('hills', 0.12, 1.1, 0.46), feature: 'wall', water: false },
    skyglow: 0.55,
    limitMag: 4.2,
  },
  {
    name: '雷克雅未克',
    nameEn: 'Reykjavík',
    lat: 64.1466,
    lon: -21.9426,
    tz: 'Atlantic/Reykjavik',
    description: '海湾对岸是平顶的埃夏山，夏夜几乎不黑',
    terrain: { far: layer('mesa', 0.12, 0.7, 0.5), near: layer('flat', 0), feature: 'none', water: true },
    skyglow: 0.3,
    limitMag: 4.6,
  },
  {
    name: '漠河',
    nameEn: 'Mohe',
    lat: 52.9717,
    lon: 122.5378,
    tz: 'Asia/Shanghai',
    description: '中国最北，落叶松林上方的天极很高',
    terrain: { far: layer('hills', 0.1, 0.8, 0.45), near: layer('hills', 0.05, 1.1, 0.4), feature: 'trees', water: false },
    skyglow: 0.04,
    limitMag: 5,
  },
  {
    name: '敦煌',
    nameEn: 'Dunhuang',
    lat: 40.1421,
    lon: 94.6619,
    tz: 'Asia/Shanghai',
    description: '鸣沙山的沙脊，干燥少云',
    terrain: { far: layer('dunes', 0.18, 0.9, 0.4), near: layer('dunes', 0.11, 1.4, 0.4), feature: 'none', water: false },
    skyglow: 0.06,
    limitMag: 5,
  },
  {
    name: '拉萨',
    nameEn: 'Lhasa',
    lat: 29.6525,
    lon: 91.1721,
    tz: 'Asia/Shanghai',
    description: '海拔三千六百米，空气稀薄通透',
    terrain: { far: layer('peaks', 0.3, 0.8, 0.58), near: layer('hills', 0.08, 1.6, 0.5), feature: 'none', water: false },
    skyglow: 0.18,
    limitMag: 4.8,
  },
  {
    name: '曾母暗沙',
    nameEn: 'James Shoal',
    lat: 3.9667,
    lon: 112.2833,
    tz: 'Asia/Shanghai',
    description: '近赤道的海面，天极贴着海平线',
    terrain: { far: layer('flat', 0), near: layer('flat', 0), feature: 'none', water: true },
    skyglow: 0,
    limitMag: 5,
  },
  {
    name: '新加坡',
    nameEn: 'Singapore',
    lat: 1.3521,
    lon: 103.8198,
    tz: 'Asia/Singapore',
    description: '海湾天际线，城市灯光吞掉了暗星',
    terrain: { far: layer('flat', 0), near: layer('flat', 0.01), feature: 'skyline', water: true },
    skyglow: 0.95,
    limitMag: 3.1,
  },
  {
    name: '莫纳克亚',
    nameEn: 'Mauna Kea',
    lat: 19.8206,
    lon: -155.4681,
    tz: 'Pacific/Honolulu',
    description: '云海之上的山顶，排着一列望远镜圆顶',
    terrain: { far: layer('hills', 0.04, 0.5, 0.4), near: layer('hills', 0.07, 0.55, 0.35), feature: 'domes', water: false },
    skyglow: 0.03,
    limitMag: 5,
  },
  {
    name: '悉尼',
    nameEn: 'Sydney',
    lat: -33.8688,
    lon: 151.2093,
    tz: 'Australia/Sydney',
    description: '海岬与港湾，南天极在低空顺时针转',
    terrain: { far: layer('hills', 0.04, 0.8, 0.45), near: layer('mesa', 0.05, 0.9, 0.5), feature: 'none', water: true },
    skyglow: 0.7,
    limitMag: 3.8,
  },
  {
    name: '阿塔卡马',
    nameEn: 'Atacama',
    lat: -23.8634,
    lon: -69.1328,
    tz: 'America/Santiago',
    description: '最干燥的高原，远处是一座火山锥',
    terrain: { far: layer('hills', 0.04, 0.6, 0.45), near: layer('flat', 0.015), feature: 'cone', water: false },
    skyglow: 0,
    limitMag: 5,
  },
  {
    name: '乌斯怀亚',
    nameEn: 'Ushuaia',
    lat: -54.8019,
    lon: -68.303,
    tz: 'America/Argentina/Ushuaia',
    description: '比格尔海峡对岸的雪峰，世界尽头的南天',
    terrain: { far: layer('peaks', 0.24, 1.0, 0.6), near: layer('flat', 0), feature: 'none', water: true },
    skyglow: 0.25,
    limitMag: 4.6,
  },
  {
    name: '南极点',
    nameEn: 'South Pole',
    lat: -89.0,
    lon: 0.0,
    tz: 'Antarctica/McMurdo',
    description: '南天极几乎就在头顶，星轨绕成水平的圆',
    terrain: { far: layer('flat', 0), near: layer('flat', 0.012, 2.0, 0.5), feature: 'none', water: false },
    skyglow: 0,
    limitMag: 5,
  },
];

/** 等效焦距（全画幅竖向 24mm）与视场角的对应：f = 12 / tan(fov / 2) */
export const LENSES = [
  { fov: 110, focal: 8, name: '超广角' },
  { fov: 85, focal: 13, name: '广角' },
  { fov: 60, focal: 21, name: '标准' },
  { fov: 40, focal: 33, name: '中焦' },
] as const;

/** 按经纬度找最近的内置观测地（分享链接还原用） */
export function nearestCity(lat: number, lon: number): number {
  let best = 0;
  let bestDist = Infinity;
  CITIES.forEach((c, i) => {
    const d = Math.hypot(c.lat - lat, c.lon - lon);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
