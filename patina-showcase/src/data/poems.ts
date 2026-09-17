/**
 * 苔痕的短诗。
 *
 * 主题是缓慢、不被看见的生长、覆盖与重生。中英对照，中文用衬线字体竖排
 * 也不是不行，但横排更适合作为画面上的轻量题词。
 */

export interface Poem {
  readonly zh: string;
  readonly en: string;
}

export const POEMS: readonly Poem[] = [
  { zh: '纸是安静的，苔也是。\n它们都不急着让谁看见。', en: 'Paper is quiet. So is moss.\nNeither is in a hurry to be seen.' },
  { zh: '长满一面墙要很多年，\n我只用了一个下午。', en: 'A wall takes years to be covered.\nI only took an afternoon.' },
  { zh: '最先来的那一点，\n没有人记得它落在哪里。', en: 'Nobody remembers where\nthe very first speck landed.' },
  { zh: '痕迹不是被抹掉的，\n是被新的痕迹盖住的。', en: 'Marks are not erased.\nThey are covered by newer ones.' },
  { zh: '边缘一直在长，\n所以中心看起来从没动过。', en: 'The edge keeps growing,\nso the center looks untouched.' },
  { zh: '慢的东西不需要被等待。\n它只需要不被打断。', en: 'Slow things need no waiting.\nThey only need not to be interrupted.' },
  { zh: '我数不清有几处苔，\n但每一处都算数。', en: 'I cannot count the patches of moss,\nbut every one of them counts.' },
  { zh: '覆盖不是占有，\n只是待得久了。', en: 'Covering is not possession.\nIt is simply staying long enough.' },
  { zh: '洗掉以后，\n纸还是那张纸。', en: 'After it is washed away,\nthe paper is still that paper.' },
  { zh: '又一次，\n从一点点开始。', en: 'Once again,\nit begins with just a little.' },
];
