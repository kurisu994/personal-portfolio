export interface City {
  name: string;
  nameEn: string;
  lat: number;
  lon: number;
  description: string;
}

export const CITIES: City[] = [
  {
    name: "北京",
    nameEn: "Beijing",
    lat: 39.9042,
    lon: 116.4074,
    description: "北天极回旋 · 严整同心圆",
  },
  {
    name: "雷克雅未克",
    nameEn: "Reykjavík",
    lat: 64.1466,
    lon: -21.9426,
    description: "高纬极境 · 极短夏夜与苍穹之旋",
  },
  {
    name: "漠河",
    nameEn: "Mohe",
    lat: 52.9717,
    lon: 122.5378,
    description: "中国极北 · 北极星高悬",
  },
  {
    name: "敦煌",
    nameEn: "Dunhuang",
    lat: 40.1421,
    lon: 94.6619,
    description: "大漠月牙 · 沙丘之上的千年星移",
  },
  {
    name: "拉萨",
    nameEn: "Lhasa",
    lat: 29.6525,
    lon: 91.1721,
    description: "雪域天穹 · 极净通透夜空",
  },
  {
    name: "曾母暗沙",
    nameEn: "James Shoal",
    lat: 3.9667,
    lon: 112.2833,
    description: "南疆赤道之界 · 星轨近乎平直直落",
  },
  {
    name: "新加坡",
    nameEn: "Singapore",
    lat: 1.3521,
    lon: 103.8198,
    description: "近赤道 · 天穹双向回旋分割线",
  },
  {
    name: "莫纳克亚",
    nameEn: "Mauna Kea",
    lat: 19.8206,
    lon: -155.4681,
    description: "云海之上 · 全球天文观测圣地",
  },
  {
    name: "悉尼",
    nameEn: "Sydney",
    lat: -33.8688,
    lon: 151.2093,
    description: "南半球视角 · 顺时针南天极回旋",
  },
  {
    name: "阿塔卡马",
    nameEn: "Atacama",
    lat: -23.8634,
    lon: -69.1328,
    description: "无水旱极 · 世界最深邃银河星野",
  },
  {
    name: "乌斯怀亚",
    nameEn: "Ushuaia",
    lat: -54.8019,
    lon: -68.303,
    description: "世界尽头 · 极光与南天回转",
  },
  {
    name: "南极极点",
    nameEn: "South Pole",
    lat: -89.0,
    lon: 0.0,
    description: "南天顶轴心 · 天穹平旋为圆",
  },
];
