import React from 'react';
import { POEMS } from '../data/poems';

/**
 * 竖排短诗：每四分之一个半日潮（约 3.1 小时）换一段，
 * 按逗号分列，换段时像潮水退去一样由虚到实。
 */
export const Poem: React.FC<{ jd: number }> = ({ jd }) => {
  const index = ((Math.floor((jd * 24) / 3.105) % POEMS.length) + POEMS.length) % POEMS.length;
  const poem = POEMS[index];
  return (
    <figure className="verse" key={index}>
      <blockquote className="verse__zh" lang="zh-CN">
        {poem.zh.split(/(?<=[，；])/).map((clause) => (
          <span key={clause}>{clause}</span>
        ))}
      </blockquote>
      <figcaption className="verse__en" lang="en">
        {poem.en}
      </figcaption>
    </figure>
  );
};
