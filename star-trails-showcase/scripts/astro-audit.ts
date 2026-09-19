import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 纯 Node 端天文算法验证与报告生成脚本
 * 联动 Rust 测试套件与参考向量，生成标准化审计报告
 */
async function main() {
  console.log('🌌 [Astro Audit] 开始天文算法精度离线对账审计...');

  const startTime = Date.now();
  const repoRoot = path.resolve(__dirname, '../..');
  const rustDir = path.resolve(repoRoot, 'star-trails');
  const artifactsDir = path.resolve(__dirname, '../artifacts/astro');

  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // 1. 调用 Rust 核心精度测试
  console.log('🦀 正在运行 Rust 天文内核精度断言 (cargo test --release)...');
  let cargoOutput = '';
  try {
    cargoOutput = execSync('cargo test --release --test astro_accuracy', {
      cwd: rustDir,
      encoding: 'utf-8',
    });
    console.log('✅ cargo test 精度断言全部通过！');
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string };
    console.error('❌ cargo test 失败:\n', error.stdout || error.stderr);
    process.exit(1);
  }

  // 2. 读取测试向量与参考数据
  const vectorsPath = path.resolve(
    rustDir,
    'tests/vectors/astro-reference.json'
  );
  const rawVectors = fs.readFileSync(vectorsPath, 'utf-8');
  const vectors = JSON.parse(rawVectors);

  const report = {
    timestamp: new Date().toISOString(),
    status: 'PASSED',
    durationMs: Date.now() - startTime,
    cargoTestSummary: cargoOutput.trim().split('\n').slice(-3).join(' | '),
    checks: [
      {
        name: '格林尼治恒星时 (GMST)',
        standard: 'Meeus 例 12.a',
        threshold: '0.1s',
        status: 'PASSED',
        details: vectors.sidereal_time,
      },
      {
        name: '岁差修正 J2000 -> 观测日期',
        standard: 'Meeus 例 21.b',
        threshold: '36.0 arcsec (0.01°)',
        status: 'PASSED',
        details: vectors.precession,
      },
      {
        name: '太阳视赤纬 (Sun Declination)',
        standard: 'Meeus 例 25.a',
        threshold: '0.05°',
        status: 'PASSED',
        details: vectors.sun_declination,
      },
      {
        name: '大气折射抬升修正',
        standard: 'Saemundsson / Bennett 公式',
        threshold: '0.05°',
        status: 'PASSED',
        details: vectors.refraction,
      },
    ],
  };

  const reportPath = path.resolve(artifactsDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`📄 审计报告已写入: ${reportPath}`);
  console.log('✨ [Astro Audit] 验证完成，所有指标全部达标！');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
