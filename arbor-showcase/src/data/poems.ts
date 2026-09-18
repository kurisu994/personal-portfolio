/** 四个完整分句随生命阶段呈现，窄屏换行时不拆散句意。 */
export interface Poem {
  clauses: readonly [string, string, string, string];
  whisper: string;
}

/** 《一木》五章定稿；顺序与 STAGES 保持一致。 */
export const POEMS: readonly Poem[] = [
  {
    clauses: ['一粒入深土，', '万籁归于静。', '未见枝头春，', '根已知归处。'],
    whisper: 'Within the quiet, a beginning.',
  },
  {
    clauses: ['微光穿薄雾，', '新绿破苔痕。', '不问春深浅，', '先将一叶伸。'],
    whisper: 'A leaf opens to the light.',
  },
  {
    clauses: ['枝向远天去，', '根于深土安。', '风来身自直，', '雨过心犹宽。'],
    whisper: 'Rooted here, reaching beyond.',
  },
  {
    clauses: ['万叶各有声，', '听来只一风。', '影随云往复，', '坐久见山空。'],
    whisper: 'Many leaves. A single wind.',
  },
  {
    clauses: ['果熟枝低处，', '鸟归暮色中。', '因缘归一木，', '天地此心宽。'],
    whisper: 'All returns to one.',
  },
];
