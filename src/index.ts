import { resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { MarkdownParser } from './core/MarkdownParser.js';
import { BrowserManager } from './core/BrowserManager.js';
import { CsdnPublisher } from './platforms/CsdnPublisher.js';
import { ZhihuPublisher } from './platforms/ZhihuPublisher.js';
import { config } from '../config.js';
import type { PublishResult, PublishHistoryEntry } from './types/index.js';

/**
 * 主程序入口
 * 支持命令行参数：
 *   --file <path>       指定要发布的 Markdown 文件
 *   --platform <name>   目标平台 (csdn | zhihu | all)
 *   --dry-run           仅解析，不实际发布
 */
async function main() {
  console.log('🚀 Playwright Publisher - 多平台自动化发布系统');
  console.log('─'.repeat(50));

  // 解析命令行参数
  const args = process.argv.slice(2);
  const fileArg = getArg(args, '--file');
  if (!fileArg) {
    console.error('❌ 请指定要发布的文件: --file <path>');
    process.exit(1);
  }
  const platformArg = getArg(args, '--platform') || 'all';
  const isDryRun = args.includes('--dry-run');
  const isDebug = args.includes('--debug');

  // 1. 解析 Markdown 文件
  const filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${filePath}`);
    process.exit(1);
  }

  console.log(`📄 解析文件: ${filePath}`);
  const article = MarkdownParser.parseArticle(filePath);
  console.log(`   标题: ${article.title}`);
  console.log(`   标签: ${article.tags.join(', ')}`);
  console.log(`   摘要: ${article.summary.substring(0, 50)}...`);
  console.log(`   正文: ${article.content.length} 字符`);
  console.log(`   封面: ${article.cover || '无'}`);

  if (isDryRun) {
    console.log('\n🏁 Dry-run 模式，仅解析不发布');
    return;
  }

  // 2. 检查是否重复发布
  const contentHash = createHash('md5').update(article.content).digest('hex');
  const history = loadPublishHistory();
  const platforms = platformArg === 'all' ? ['csdn', 'zhihu'] : [platformArg];

  // 3. 初始化浏览器
  const browserManager = new BrowserManager();
  await browserManager.launch(
    isDebug
      ? { headless: false, slowMo: 80 }
      : undefined
  );

  if (isDebug) {
    console.log('🐛 调试模式：有头 + slowMo=80ms，可以看到浏览器操作');
  }

  const results: PublishResult[] = [];

  try {
    for (const platform of platforms) {
      // 检查去重
      const isDuplicate = history.some(
        (entry) => entry.hash === contentHash && entry.platform === platform
      );
      if (isDuplicate) {
        console.log(`⏭️  [${platform}] 文章已发布过，跳过`);
        continue;
      }

      console.log(`\n📤 开始发布到 ${platform.toUpperCase()}...`);

      // 创建平台上下文
      const context = await browserManager.createContext(platform);
      await browserManager.startTracing(platform);

      // 选择对应的发布器
      let publisher;
      switch (platform) {
        case 'csdn':
          publisher = new CsdnPublisher(context);
          break;
        case 'zhihu':
          publisher = new ZhihuPublisher(context);
          break;
        default:
          console.error(`❌ 不支持的平台: ${platform}`);
          continue;
      }

      // 执行发布
      const result = await publisher.publish(article);
      results.push(result);

      // 保存 Trace（仅失败时）
      await browserManager.stopTracing(platform, result.success);

      // 发布成功则保存登录状态和历史记录
      if (result.success) {
        await browserManager.saveState(platform);
        savePublishHistory({
          hash: contentHash,
          title: article.title,
          platform,
          publishedAt: new Date().toISOString(),
          url: result.url,
        });
      }
    }
  } finally {
    await browserManager.close();
  }

  // 4. 输出总结
  console.log('\n' + '─'.repeat(50));
  console.log('📊 发布结果总结:');
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    console.log(`   ${icon} [${r.platform}] ${r.articleTitle} ${r.url || r.error || ''}`);
  }
}

// ─── 辅助函数 ─────────────────────────────────────────

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function loadPublishHistory(): PublishHistoryEntry[] {
  const historyPath = resolve(config.storage.historyFile);
  if (existsSync(historyPath)) {
    return JSON.parse(readFileSync(historyPath, 'utf-8'));
  }
  return [];
}

function savePublishHistory(entry: PublishHistoryEntry): void {
  const historyPath = resolve(config.storage.historyFile);
  const dir = resolve(config.storage.logsDir, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const history = loadPublishHistory();
  history.push(entry);
  writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf-8');
}

// 启动主程序
main().catch((err) => {
  console.error('💥 程序异常退出:', err);
  process.exit(1);
});
