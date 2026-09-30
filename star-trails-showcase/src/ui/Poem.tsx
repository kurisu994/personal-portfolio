import React from 'react';
import { POEMS } from '../data/poems';

/**
 * 竖排短诗：十段诗按一夜的进程排列，黄昏第一段、黎明最后一段；
 * 按逗号分列，换段时像底片显影一样由虚到实。
 */
export const Poem: React.FC<{ progress: number }> = ({ progress }) => {
  const index = Math.min(POEMS.length - 1, Math.floor(progress * POEMS.length));
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
