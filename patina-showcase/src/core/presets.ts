/**
 * 形态族与漫游路径。
 *
 * ── 参数从哪来 ──────────────────────────────────────────────────────
 * 不是从文献照抄的。Pearson 论文与常见开源实现的参数表各自对应不同的
 * 拉普拉斯核（五点和九点的形态区不同），直接搬过来会落在双稳态边界上。
 * 这里的五个点都在**与运行时相同的 256² 网格**上实测校准过。
 *
 * 「相同分辨率」这一条是踩过坑的：早先在 64² 上校准的参数，搬到 256²
 * 运行时，mitosis(0.0367, 0.065) 会整片死掉（覆盖率 0.000）。所以
 * 校准分辨率与运行分辨率必须一致，verify:patina 会按 256² 复核一次。
 *
 * ── 漫游顺序为什么必须按覆盖率递增 ──────────────────────────────────
 * 这是本项目最重要的一个约束，来自一次真实的失败：
 *
 *   Gray-Scott 有一个「铺满」吸引子。一旦整个场被 V 占满，U 就几乎耗尽，
 *   而反应项是 u·v²——没有 U 就没有燃料。此时把参数切到任何一个稀疏形态
 *   （spots / maze / mitosis），V 都会直接衰减到零，画面变成一张白纸，
 *   而且再也长不回来（因为 U 也没了）。
 *
 * 实测：从 bloom 的 0.854 切到 maze，45000 步后覆盖率 0.000，64² 与 256²
 * 上结果一致。所以原先「茂密 → 稀疏 → 茂密」的呼吸式漫游在真实运行中
 * 必然把画面洗白。现在的顺序是 斑点 → 细胞分裂 → 迷宫 → 珊瑚 → 茂密，
 * 覆盖率单调上升，每次切换都是「在已有图案上继续长」，永远不会从全满
 * 切回稀疏；茂密铺满后由冲刷回到起点。
 */

/**
 * 归一化扩散系数，两版共用。
 *
 * 取 Du = 1 是 Karl Sims 的经典取值，好处是演化速度是 0.21 那套的五倍。
 * 代价是 U 的中心系数正好为 0（处于显式欧拉的稳定边界），因此 GPU 侧
 * 必须用 32 位浮点纹理，不能用 RG16F。
 */
export const DIFFUSION = { du: 1.0, dv: 0.5 } as const;

/** 一个形态族在 (F, k) 平面上的落点。 */
export interface Morph {
  readonly id: string;
  readonly name: string;
  readonly en: string;
  readonly feed: number;
  readonly kill: number;
  /** 256² 网格、25000 步下的实测覆盖率，也是漫游的排序依据。 */
  readonly coverage: number;
  readonly note: string;
}

/** 按覆盖率递增排列，顺序即漫游顺序。 */
export const MORPHS: readonly Morph[] = [
  {
    id: 'spots',
    name: '斑点',
    en: 'SPOTS',
    feed: 0.03,
    kill: 0.062,
    coverage: 0.233,
    note: '彼此不相连的孤立圆斑',
  },
  {
    id: 'mitosis',
    name: '细胞分裂',
    en: 'MITOSIS',
    feed: 0.0367,
    kill: 0.063,
    coverage: 0.311,
    note: '密集圆斑，边缘仍在鼓动',
  },
  {
    id: 'maze',
    name: '迷宫',
    en: 'MAZE',
    feed: 0.029,
    kill: 0.057,
    coverage: 0.424,
    note: '连绵蜿蜒的纹路，像旧墙上的水渍',
  },
  {
    id: 'coral',
    name: '珊瑚',
    en: 'CORAL',
    feed: 0.0545,
    kill: 0.062,
    coverage: 0.529,
    note: '细密分叉，像从纸里长出的海水',
  },
  {
    id: 'bloom',
    name: '茂密',
    en: 'BLOOM',
    feed: 0.05,
    kill: 0.06,
    coverage: 0.966,
    note: '苔藓铺满纸面，几乎不留白',
  },
];

export const MORPH_BY_ID: ReadonlyMap<string, Morph> = new Map(MORPHS.map((morph) => [morph.id, morph]));

/** 形态族在列表中的序号，界面按钮与键盘快捷键共用同一份顺序。 */
export function morphIndexOf(id: string): number {
  return MORPHS.findIndex((morph) => morph.id === id);
}

/** 漫游路径上的一个路点。 */
export interface Waypoint {
  /** 指向形态族时用 id 取参数，参数只在 MORPHS 里定义一次。 */
  readonly morphId?: string;
  /** 过渡路点直接给参数，dwell 为 0，只被经过、不停留。 */
  readonly feed?: number;
  readonly kill?: number;
  /** 停留时长（秒）。 */
  readonly dwell: number;
}

/** 形态族停留时长、段间过渡时长（秒）。 */
export const ROAM_DWELL = 38;
export const ROAM_BLEND = 8;

/**
 * 漫游折线（闭环）。
 *
 * 五个形态族之间不需要额外的绕行路点：按覆盖率递增排列之后，每条直线段
 * 都整段落在有图案的窄带内（早先的顺序会穿过 maze 与 spots 之间的双稳态
 * 缝隙，才需要绕行）。闭环的最后一段 bloom → spots 不会真的以演化方式
 * 发生——它在冲刷相位里被「清空」替代。
 */
export const ROAM_PATH: readonly Waypoint[] = [
  { morphId: 'spots', dwell: ROAM_DWELL },
  { morphId: 'mitosis', dwell: ROAM_DWELL },
  { morphId: 'maze', dwell: ROAM_DWELL },
  { morphId: 'coral', dwell: ROAM_DWELL },
  { morphId: 'bloom', dwell: ROAM_DWELL },
];

export interface ResolvedWaypoint {
  readonly feed: number;
  readonly kill: number;
  readonly dwell: number;
  readonly morph: Morph;
}

/** 把路点解析成带参数的完整形态，过渡路点归属最近的上一个形态族。 */
function resolvePath(): readonly ResolvedWaypoint[] {
  return ROAM_PATH.map((waypoint, index) => {
    if (waypoint.morphId) {
      const morph = MORPH_BY_ID.get(waypoint.morphId);
      if (!morph) throw new Error(`ROAM_PATH 引用了未定义的形态族：${waypoint.morphId}`);
      return { feed: morph.feed, kill: morph.kill, dwell: waypoint.dwell, morph };
    }
    if (waypoint.feed === undefined || waypoint.kill === undefined) {
      throw new Error('过渡路点必须给出 feed 与 kill');
    }
    // 向前找最近的有名形态，界面在过渡期间显示它。
    for (let back = 1; back <= ROAM_PATH.length; back += 1) {
      const candidate = ROAM_PATH[(index - back + ROAM_PATH.length) % ROAM_PATH.length];
      if (!candidate.morphId) continue;
      const morph = MORPH_BY_ID.get(candidate.morphId);
      if (!morph) break;
      return { feed: waypoint.feed, kill: waypoint.kill, dwell: waypoint.dwell, morph };
    }
    throw new Error('ROAM_PATH 里找不到任何形态族');
  });
}

const PATH = resolvePath();

/** 解析后的路点（已带上参数），供验收脚本遍历每一段。 */
export const RESOLVED_PATH: readonly ResolvedWaypoint[] = PATH;

interface TimelineEntry {
  readonly from: ResolvedWaypoint;
  readonly to: ResolvedWaypoint;
  readonly hold: number;
  readonly travel: number;
  readonly start: number;
  readonly end: number;
}

/** 预计算每一段的起始时刻，避免每帧遍历路径。 */
const TIMELINE: readonly TimelineEntry[] = (() => {
  const entries: TimelineEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < PATH.length; index += 1) {
    const from = PATH[index];
    const to = PATH[(index + 1) % PATH.length];
    const hold = from.dwell;
    const travel = ROAM_BLEND;
    entries.push({ from, to, hold, travel, start: cursor, end: cursor + hold + travel });
    cursor += hold + travel;
  }
  return entries;
})();

/** 走完一圈的总时长（秒），含停留与全部过渡。 */
export const ROAM_CYCLE = TIMELINE[TIMELINE.length - 1].end;

/** 某个形态族在漫游折线上的起始时刻（秒），供键盘跳转使用。 */
export function morphStartTime(id: string): number {
  const entry = TIMELINE.find((item) => item.from.morph.id === id);
  return entry ? entry.start : 0;
}

export interface PathPosition {
  /** 当前段的起点形态。 */
  readonly from: Morph;
  /** 当前段的终点形态。 */
  readonly to: Morph;
  /** 过渡进度 0–1；停留期间恒为 0。 */
  readonly blend: number;
  readonly feed: number;
  readonly kill: number;
  /** 一圈内的进度 0–1。 */
  readonly progress: number;
  /** 当前段序号。 */
  readonly index: number;
  /** 是否停在形态族上（而非处在过渡途中）。 */
  readonly resting: boolean;
}

/** 取漫游折线上某一时刻的位置。时间单位为秒。 */
export function pathAt(elapsed: number): PathPosition {
  const wrapped = ((elapsed % ROAM_CYCLE) + ROAM_CYCLE) % ROAM_CYCLE;
  let entry = TIMELINE[TIMELINE.length - 1];
  for (const candidate of TIMELINE) {
    if (wrapped < candidate.end) {
      entry = candidate;
      break;
    }
  }

  const within = wrapped - entry.start;
  const resting = within <= entry.hold;
  const blend = resting ? 0 : (within - entry.hold) / entry.travel;

  return {
    from: entry.from.morph,
    to: entry.to.morph,
    blend,
    feed: entry.from.feed + (entry.to.feed - entry.from.feed) * blend,
    kill: entry.from.kill + (entry.to.kill - entry.from.kill) * blend,
    progress: wrapped / ROAM_CYCLE,
    index: TIMELINE.indexOf(entry),
    resting,
  };
}
