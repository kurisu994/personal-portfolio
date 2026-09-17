import { MORPHS } from '../core/presets';
import type { Phase } from '../core/Director';
import type { Poem } from '../data/poems';

interface OverlayProps {
  readonly phase: Phase;
  readonly morphName: string;
  readonly morphEn: string;
  readonly morphNote: string;
  readonly morphIndex: number;
  readonly progress: number;
  readonly coverage: number;
  readonly speed: number;
  readonly poem: Poem;
  readonly soundOn: boolean;
  readonly paused: boolean;
  readonly lowPrecision: boolean;
  readonly hintVisible: boolean;
  readonly onToggleSound: () => void;
  readonly onTogglePause: () => void;
  readonly onJump: (index: number) => void;
}

const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  seeding: '播种',
  growing: '蔓延',
  flushing: '重生',
};

export default function Overlay({
  phase,
  morphName,
  morphEn,
  morphNote,
  morphIndex,
  progress,
  coverage,
  speed,
  poem,
  soundOn,
  paused,
  lowPrecision,
  hintVisible,
  onToggleSound,
  onTogglePause,
  onJump,
}: OverlayProps) {
  return (
    <div className="overlay">
      <header className="overlay__header">
        <h1 className="title">
          苔痕
          <span className="title__en">PATINA</span>
        </h1>
        <p className="subtitle">屏幕上的生长，缓慢，也不需要被看见。</p>
      </header>

      <div className="controls">
        <button type="button" className="control" onClick={onToggleSound} aria-pressed={soundOn}>
          声音 {soundOn ? '开' : '关'}
        </button>
        <button type="button" className="control" onClick={onTogglePause} aria-pressed={paused}>
          {paused ? '继续' : '暂停'}
        </button>
      </div>

      <section className="status" aria-live="polite">
        <p className="status__phase">
          {PHASE_LABEL[phase]}
          <span className="status__coverage">覆盖 {(coverage * 100).toFixed(0)}%</span>
        </p>
        <p className="status__morph">
          {morphName}
          <span className="status__morph-en">{morphEn}</span>
        </p>
        <p className="status__note">{morphNote}</p>
        <div className="status__track" role="presentation">
          <div className="status__bar" style={{ transform: `scaleX(${progress.toFixed(3)})` }} />
        </div>
        {speed !== 1 && <p className="status__speed">速度 ×{speed.toFixed(2)}</p>}
        {lowPrecision && <p className="status__warn">此设备不支持浮点渲染，画面精度已降低。</p>}
      </section>

      <nav className="morphs" aria-label="形态族">
        {MORPHS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={index === morphIndex ? 'morph morph--active' : 'morph'}
            onClick={() => onJump(index)}
          >
            <span className="morph__index">{index + 1}</span>
            {item.name}
          </button>
        ))}
      </nav>

      <figure className="poem" key={`${poem.zh}`}>
        <blockquote className="poem__zh">{poem.zh}</blockquote>
        <figcaption className="poem__en">{poem.en}</figcaption>
      </figure>

      <p className={hintVisible ? 'hint' : 'hint hint--hidden'}>
        点一下播种，拖动涂抹，按住不动或按住 Shift 擦除 · 数字键切换形态 · 空格暂停 · 滚轮调节速度
      </p>
    </div>
  );
}
