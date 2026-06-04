/**
 * 交互式登录脚本
 * 使用方式：
 *   pnpm run login -- --platform csdn
 *   pnpm run login -- --platform zhihu
 *   pnpm run login -- --platform deepseek
 *   pnpm run login -- --platform kimi
 *   pnpm run login -- --platform yuanbao
 *   pnpm run login -- --platform all
 *
 * 脚本会以有头模式打开浏览器，等待你手动完成登录后，按 Enter 保存 Cookie 状态。
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createInterface } from 'readline';
import { config } from '../config.js';

// 平台登录入口 URL（发布平台 + AI 搜索引擎）
const LOGIN_URLS: Record<string, string> = {
  // 发布平台
  csdn: 'https://passport.csdn.net/login',
  zhihu: 'https://www.zhihu.com/signin',
  // AI 搜索引擎
  deepseek: 'https://chat.deepseek.com',
  kimi: 'https://kimi.moonshot.cn',
  yuanbao: 'https://yuanbao.tencent.com',
  metaso: 'https://metaso.cn',
};

// 合并所有平台配置（发布 + 采集器）
function getPlatformConfig(platform: string): { statePath: string } | undefined {
  const publishConfig = config.platforms[platform as keyof typeof config.platforms];
  if (publishConfig) return publishConfig;
  const scraperConfig = config.scrapers[platform as keyof typeof config.scrapers];
  if (scraperConfig) return scraperConfig;
  return undefined;
}

// 获取所有支持的平台列表
function getAllPlatforms(): string[] {
  return [...Object.keys(config.platforms), ...Object.keys(config.scrapers)];
}

async function waitForEnter(prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function login(platform: string) {
  console.log(`\n🔐 正在为 [${platform.toUpperCase()}] 启动登录流程...\n`);

  const platformConfig = getPlatformConfig(platform);
  if (!platformConfig) {
    console.error(`❌ 不支持的平台: ${platform}`);
    console.error(`   支持: ${getAllPlatforms().join(', ')}`);
    return;
  }

  const loginUrl = LOGIN_URLS[platform];
  if (!loginUrl) {
    console.error(`❌ 未配置 ${platform} 的登录 URL`);
    return;
  }

  // 确保 auth 目录存在
  const statePath = resolve(platformConfig.statePath);
  const stateDir = dirname(statePath);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  // 以有头模式启动浏览器（方便手动操作）
  const browser = await chromium.launch({
    headless: false,
    slowMo: 0,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--window-size=1280,900',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  // 注入反检测脚本
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
    (window as any).chrome = { runtime: {} };
  });

  const page = await context.newPage();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

  console.log(`📋 浏览器已打开 ${platform.toUpperCase()} 页面`);
  console.log(`   URL: ${loginUrl}`);
  console.log(`\n👉 请在浏览器中完成登录操作（扫码/账号密码）`);
  console.log(`   登录成功后，确认页面已跳转到首页或个人中心\n`);

  await waitForEnter('✅ 登录完成后按 Enter 保存状态...');

  // 保存登录状态
  await context.storageState({ path: statePath });
  console.log(`\n💾 登录状态已保存至: ${statePath}`);
  console.log(`   下次运行时将自动使用此状态免登录\n`);

  await browser.close();
  console.log(`🎉 [${platform.toUpperCase()}] 登录配置完成！\n`);
}

// 主入口
async function main() {
  console.log('🔑 Playwright Publisher - 平台登录工具');
  console.log('─'.repeat(50));

  const args = process.argv.slice(2);
  const platformIdx = args.indexOf('--platform');
  const platformArg = platformIdx !== -1 ? args[platformIdx + 1] : undefined;

  if (!platformArg) {
    console.log(`\n用法: pnpm run login -- --platform <platform>\n`);
    console.log(`支持的平台:`);
    console.log(`  发布: csdn, zhihu`);
    console.log(`  监控: deepseek, kimi, yuanbao, metaso`);
    console.log(`  全部: all\n`);
    process.exit(1);
  }

  const platforms = platformArg === 'all' ? getAllPlatforms() : [platformArg];

  for (const platform of platforms) {
    await login(platform);
  }

  console.log('✨ 所有平台登录配置完毕！');
}

main().catch((err) => {
  console.error('💥 登录流程异常:', err);
  process.exit(1);
});
