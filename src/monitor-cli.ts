/**
 * GEO 监控 CLI 工具
 * 直接通过命令行运行单次监控任务（不依赖 HTTP 服务）
 *
 * 用法：
 *   pnpm run monitor -- --keyword "友望自集尘吸尘器" --engine deepseek
 *   pnpm run monitor -- --keyword "自集尘吸尘器推荐" --keyword "友望U12 Pro测评" --engine deepseek --engine kimi
 *   pnpm run monitor -- --keyword "吸尘器怎么选" --all-engines
 *   pnpm run monitor -- --keyword "友望测评" --engine metaso --debug
 */

import { BrowserManager } from './core/BrowserManager.js';
import { createScraper, SUPPORTED_ENGINES } from './scrapers/index.js';
import { config } from '../config.js';
import type { SearchResult } from './types/index.js';

async function main() {
  console.log('🔍 GEO Monitor CLI — AI 搜索引擎可见性采集工具');
  console.log('═'.repeat(55));

  // 解析命令行参数
  const args = process.argv.slice(2);
  const keywords = getMultiArgs(args, '--keyword');
  const engines = getMultiArgs(args, '--engine');
  const allEngines = args.includes('--all-engines');
  const isDebug = args.includes('--debug');

  if (keywords.length === 0) {
    console.log(`\n用法:`);
    console.log(`  pnpm run monitor -- --keyword "关键词" [--engine deepseek] [--all-engines] [--debug]\n`);
    console.log(`支持的引擎: ${SUPPORTED_ENGINES.join(', ')}`);
    console.log(`\n示例:`);
    console.log(`  pnpm run monitor -- --keyword "友望自集尘吸尘器" --engine deepseek`);
    console.log(`  pnpm run monitor -- --keyword "吸尘器推荐" --all-engines`);
    console.log(`  pnpm run monitor -- --keyword "友望U12" --engine kimi --engine metaso --debug\n`);
    process.exit(1);
  }

  // 确定引擎列表
  const targetEngines = allEngines
    ? [...SUPPORTED_ENGINES]
    : engines.length > 0
      ? engines.filter(e => SUPPORTED_ENGINES.includes(e as any))
      : [...SUPPORTED_ENGINES];

  console.log(`\n📋 任务概览:`);
  console.log(`   关键词: ${keywords.join(', ')}`);
  console.log(`   引擎:   ${targetEngines.join(', ')}`);
  console.log(`   模式:   ${isDebug ? '调试（有头）' : '生产（无头）'}`);
  console.log('─'.repeat(55));

  // 启动浏览器
  const browserManager = new BrowserManager();
  await browserManager.launch(isDebug ? { headless: false, slowMo: 80 } : undefined);

  const allResults: SearchResult[] = [];

  try {
    for (const engine of targetEngines) {
      console.log(`\n▶ 引擎: ${engine.toUpperCase()}`);

      let context;
      try {
        context = await browserManager.createContext(engine);
      } catch (err) {
        console.error(`  ✗ 创建上下文失败: ${(err as Error).message}`);
        console.error(`  → 请先运行: pnpm run login -- --platform ${engine}`);
        continue;
      }

      const scraper = createScraper(engine, context);

      for (let i = 0; i < keywords.length; i++) {
        const keyword = keywords[i];
        console.log(`\n  [${i + 1}/${keywords.length}] "${keyword}"`);

        const result = await scraper.search(keyword);
        allResults.push(result);

        // 打印结果摘要
        if (result.success) {
          const preview = result.responseText.substring(0, 150).replace(/\n/g, ' ');
          console.log(`  📝 回复预览: ${preview}...`);
          if (result.citationUrls.length > 0) {
            console.log(`  🔗 引用 (${result.citationUrls.length}):`);
            result.citationUrls.slice(0, 5).forEach(url => console.log(`     ${url}`));
          }
        }

        // 查询间隔
        if (i < keywords.length - 1) {
          const delay = config.monitor.queryDelay.min +
            Math.random() * (config.monitor.queryDelay.max - config.monitor.queryDelay.min);
          await new Promise(r => setTimeout(r, delay));
        }
      }

      // 保存状态
      try { await browserManager.saveState(engine); } catch { /* ignore */ }

      // 引擎间隔
      if (targetEngines.indexOf(engine) < targetEngines.length - 1) {
        const delay = config.monitor.engineDelay.min +
          Math.random() * (config.monitor.engineDelay.max - config.monitor.engineDelay.min);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  } finally {
    await browserManager.close();
  }

  // 输出总结
  console.log('\n' + '═'.repeat(55));
  console.log('📊 采集结果总结:');
  console.log('─'.repeat(55));

  const successResults = allResults.filter(r => r.success);
  const failedResults = allResults.filter(r => !r.success);

  console.log(`   总计: ${allResults.length} 次查询`);
  console.log(`   成功: ${successResults.length}`);
  console.log(`   失败: ${failedResults.length}`);

  if (failedResults.length > 0) {
    console.log(`\n   ⚠️ 失败详情:`);
    failedResults.forEach(r => {
      console.log(`      [${r.engine}] "${r.keyword}": ${r.error}`);
    });
  }

  // 输出 JSON 到 stdout（方便管道处理）
  console.log('\n─'.repeat(55));
  console.log('📄 完整 JSON 结果:');
  console.log(JSON.stringify({ results: allResults }, null, 2));
}

/** 获取命令行中同名参数的多个值 */
function getMultiArgs(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[i + 1]);
      i++; // skip next
    }
  }
  return values;
}

main().catch((err) => {
  console.error('💥 监控任务异常:', err);
  process.exit(1);
});
