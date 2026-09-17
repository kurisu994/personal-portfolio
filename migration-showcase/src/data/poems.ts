export interface Poem {
  lines: readonly [string, string];
  translation: string;
}

export const POEMS: readonly Poem[] = [
  { lines: ['把远方折成翅膀，', '把此刻交还给风。'], translation: 'Fold the distance into wings. Let the wind hold this moment.' },
  { lines: ['河流不曾问归期，', '只是替天空，记住了你。'], translation: 'The river asks no return date. It remembers you for the sky.' },
  { lines: ['我们掠过的田野，', '正长出下一场春天。'], translation: 'Below our wings, another spring is taking root.' },
  { lines: ['有些路没有脚印，', '只有云，轻轻让开。'], translation: 'Some paths leave no footprints. Only clouds moving aside.' },
  { lines: ['远方不是一个地方，', '是风经过时的方向。'], translation: 'Far away is not a place. It is the way the wind passes.' },
  { lines: ['暮色落在屋顶，', '我们替大地，多看一眼。'], translation: 'Dusk settles on the rooftops. We look a little longer for the earth.' },
  { lines: ['雪把山河写得很轻，', '一双翅膀，恰好读懂。'], translation: 'Snow writes the world softly. A pair of wings understands.' },
  { lines: ['灯火渐渐小了，', '星河便近了一些。'], translation: 'As the lights grow smaller, the stars come a little closer.' },
  { lines: ['不必与风争辩，', '它也在寻找春天。'], translation: 'No need to argue with the wind. It is looking for spring, too.' },
  { lines: ['每一次离开，', '都让天空，多一条归路。'], translation: 'Every departure leaves the sky another way home.' },
  { lines: ['雾散之前，', '我们先成为彼此的方向。'], translation: 'Before the mist clears, we become each other’s compass.' },
  { lines: ['让沉默长出羽毛，', '让未说完的话，飞行。'], translation: 'Let silence grow feathers. Let the unfinished words take flight.' },
  { lines: ['倘若世界没有尽头，', '就再陪风，飞一会儿。'], translation: 'If the world has no end, stay with the wind a little longer.' },
];

