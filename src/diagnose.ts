/**
 * 诊断脚本 —— 用于检测 CSDN/知乎 编辑器页面的真实 DOM 结构
 * 使用方式: pnpm run diagnose -- --platform csdn
 */

import { chromium } from 'playwright';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config.js';

async function diagnose(platform: string) {
  console.log(`\n🔍 诊断 ${platform.toUpperCase()} 编辑器页面 DOM 结构...\n`);

  const platformConfig = config.platforms[platform as keyof typeof config.platforms];
  if (!platformConfig) {
    console.error(`❌ 不支持的平台: ${platform}`);
    return;
  }

  const statePath = resolve(platformConfig.statePath);
  if (!existsSync(statePath)) {
    console.error(`❌ 未找到登录状态: ${statePath}`);
    console.error(`   请先运行: pnpm run login -- --platform ${platform}`);
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: statePath,
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  await page.goto(platformConfig.editorUrl, { waitUntil: 'networkidle', timeout: 30000 });

  // 等待页面加载稳定
  await page.waitForTimeout(3000);

  console.log(`📍 当前 URL: ${page.url()}`);
  console.log(`📍 页面标题: ${await page.title()}\n`);

  // 检查是否被重定向到登录页
  const url = page.url();
  if (url.includes('login') || url.includes('signin') || url.includes('passport')) {
    console.error('⚠️  登录状态可能已失效，页面跳转到了登录页');
    console.error(`   当前 URL: ${url}`);
    await browser.close();
    return;
  }

  // 提取所有可交互元素（使用字符串避免 tsx __name 注入问题）
  const elements = await page.evaluate(`
    (() => {
      const results = [];

      function getClass(el) {
        const cn = el.className;
        if (typeof cn === 'string') return cn.substring(0, 120);
        if (cn && cn.baseVal) return cn.baseVal.substring(0, 120);
        return '';
      }

      // 1. 所有 input 和 textarea
      document.querySelectorAll('input, textarea').forEach(function(el) {
        results.push({
          tag: el.tagName,
          type: el.type || '',
          cls: getClass(el),
          id: el.id,
          name: el.name || '',
          placeholder: el.placeholder || '',
          visible: el.offsetParent !== null,
        });
      });

      // 2. 所有 contenteditable 元素
      document.querySelectorAll('[contenteditable="true"]').forEach(function(el) {
        results.push({
          tag: el.tagName,
          type: 'contenteditable',
          cls: getClass(el),
          id: el.id,
          role: el.getAttribute('role') || '',
          textLength: el.innerText ? el.innerText.length : 0,
          visible: el.offsetParent !== null,
        });
      });

      // 3. 包含关键词的元素
      var keywords = ['title', 'editor', 'markdown', 'content', 'article', 'publish', 'tag', 'cover', 'CodeMirror', 'summary'];
      keywords.forEach(function(keyword) {
        document.querySelectorAll('[class*="' + keyword + '"], [id*="' + keyword + '"]').forEach(function(el) {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
          results.push({
            tag: el.tagName,
            type: 'keyword: ' + keyword,
            cls: getClass(el),
            id: el.id,
            role: el.getAttribute('role') || '',
            children: el.children.length,
            visible: el.offsetParent !== null,
          });
        });
      });

      // 4. 所有按钮
      document.querySelectorAll('button, [role="button"], a.btn, [class*="btn"]').forEach(function(el) {
        var text = el.innerText ? el.innerText.trim().substring(0, 50) : '';
        if (!text) return;
        results.push({
          tag: el.tagName,
          type: 'button',
          cls: getClass(el),
          id: el.id,
          text: text,
          visible: el.offsetParent !== null,
        });
      });

      return results;
    })()
  `);

  console.log('═══════════════════════════════════════════════════');
  console.log(' 可交互元素 & 关键 DOM 节点');
  console.log('═══════════════════════════════════════════════════\n');

  const allElements = elements as any[];

  // 按类型分组输出
  const inputs = allElements.filter((e: any) => e.tag === 'INPUT' || e.tag === 'TEXTAREA');
  const editables = allElements.filter((e: any) => e.type === 'contenteditable');
  const buttons = allElements.filter((e: any) => e.type === 'button');
  const keywordMatches = allElements.filter((e: any) => e.type?.startsWith('keyword'));

  console.log(`📝 Input/Textarea (${inputs.length}):`);
  inputs.forEach((e: any) => {
    console.log(`   ${e.visible ? '✅' : '❌'} <${e.tag.toLowerCase()} type="${e.type}" class="${e.cls}" id="${e.id}" placeholder="${e.placeholder}" name="${e.name}">`);
  });

  console.log(`\n📝 ContentEditable (${editables.length}):`);
  editables.forEach((e: any) => {
    console.log(`   ${e.visible ? '✅' : '❌'} <${e.tag.toLowerCase()} class="${e.cls}" id="${e.id}" role="${e.role}" textLength=${e.textLength}>`);
  });

  console.log(`\n🔘 Buttons (${buttons.length}):`);
  buttons.forEach((e: any) => {
    if (e.visible) {
      console.log(`   ✅ <${e.tag.toLowerCase()} class="${e.cls}" id="${e.id}"> "${e.text}"`);
    }
  });

  console.log(`\n🔑 关键词匹配 (可见的):`);
  const seen = new Set<string>();
  keywordMatches.forEach((e: any) => {
    const key = `${e.tag}|${e.cls}|${e.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (e.visible) {
      console.log(`   ✅ <${e.tag.toLowerCase()} class="${e.cls}" id="${e.id}"> [${e.type}] children=${e.children}`);
    }
  });

  // 截图保存
  const screenshotPath = resolve('storage/logs', `diagnose-${platform}-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`\n📸 截图已保存: ${screenshotPath}`);

  console.log('\n💡 浏览器保持打开 5 分钟，你可以手动审查元素');
  console.log('   按 Ctrl+C 退出\n');

  // 保持浏览器打开让用户查看
  await page.waitForTimeout(300000);
  await browser.close();
}

// 主入口
const args = process.argv.slice(2);
const platformIdx = args.indexOf('--platform');
const platform = platformIdx !== -1 ? args[platformIdx + 1] : 'csdn';

diagnose(platform).catch((err) => {
  console.error('💥 诊断失败:', err.message);
  process.exit(1);
});
