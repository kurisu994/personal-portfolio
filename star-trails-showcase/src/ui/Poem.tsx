import React, { useState, useEffect } from 'react';
import { POEMS, Poem as PoemType } from '../data/poems';

export const Poem: React.FC = () => {
  const [index, setIndex] = useState(0);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => {
      setOpacity(0);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % POEMS.length);
        setOpacity(1);
      }, 500);
    }, 20000);

    return () => clearInterval(timer);
  }, []);

  const current: PoemType = POEMS[index];

  return (
    <div className="poem" style={{ opacity }}>
      <div className="poem__zh">{current.zh}</div>
      <div className="poem__en">{current.en}</div>
    </div>
  );
};
