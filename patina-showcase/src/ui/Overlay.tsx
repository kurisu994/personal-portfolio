import { Eye, EyeOff, Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react';
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
  /** 诗句是否显示（候鸟 Eye/EyeOff 同款功能）。 */
  readonly poemVisible: boolean;
  readonly soundOn: boolean;
  readonly fullscreen: boolean;
  readonly lowPrecision: boolean;
  readonly hintVisible: boolean;
  readonly onTogglePoem: () => void;
  readonly onToggleSound: () => void;
  readonly onToggleFullscreen: () => void;
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
  poemVisible,
  soundOn,
  fullscreen,
  lowPrecision,
  hintVisible,
  onTogglePoem,
  onToggleSound,
  onToggleFullscreen,
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

      {/* 右上角控制簇：与候鸟 control-cluster 同款——三个方形图标按钮
       * （诗句、声音、全屏），1px 墨边、毛玻璃底，hover 墨底纸字。 */}
      <div className="control-cluster">
        <button
          type="button"
          className="icon-button"
          onClick={onTogglePoem}
          aria-label={poemVisible ? '隐藏诗句' : '显示诗句'}
          title={poemVisible ? '隐藏诗句' : '显示诗句'}
        >
          {poemVisible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleSound}
          aria-label={soundOn ? '关闭声音' : '开启声音'}
          title={soundOn ? '关闭声音' : '开启声音'}
        >
          {soundOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleFullscreen}
          aria-label={fullscreen ? '退出全屏' : '进入全屏'}
          title={fullscreen ? '退出全屏' : '进入全屏'}
        >
          {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
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

      <figure className={poemVisible ? 'poem' : 'poem poem--hidden'} key={`${poem.zh}`}>
        <blockquote className="poem__zh">{poem.zh}</blockquote>
        <figcaption className="poem__en">{poem.en}</figcaption>
      </figure>

      <p className={hintVisible ? 'hint' : 'hint hint--hidden'}>
        点一下播种，拖动涂抹，按住不动或按住 Shift 擦除 · 数字键切换形态 · 空格暂停 · 滚轮调节速度
      </p>
    </div>
  );
}
