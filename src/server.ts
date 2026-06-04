/**
 * HTTP API 服务入口
 * 让 Web 端项目可以通过 POST 请求调用发布和监控能力
 *
 * 启动方式: pnpm run serve
 * 
 * API:
 *   POST /publish — 发布文章到 CSDN/知乎
 *   POST /monitor — GEO 监控：模拟搜索 AI 引擎并抓取回答
 *   GET  /health  — 健康检查
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { MarkdownParser } from './core/MarkdownParser.js';
import { BrowserManager } from './core/BrowserManager.js';
import { CsdnPublisher } from './platforms/CsdnPublisher.js';
import { ZhihuPublisher } from './platforms/ZhihuPublisher.js';
import { createScraper, SUPPORTED_ENGINES } from './scrapers/index.js';
import type { PublishResult, SearchResult, MonitorRequest, MonitorResponse } from './types/index.js';
import { config } from '../config.js';

const PORT = Number(process.env.PORT) || 3210;

// 确保临时目录存在
const tmpDir = resolve('storage/tmp');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

// ==================== 并发控制 ====================

/** 全局锁：同时只允许一个 Playwright 会话运行 */
let isRunning = false;
const taskQueue: Array<{ resolve: (v: any) => void; reject: (e: any) => void; task: () => Promise<any> }> = [];

async function acquireLock<T>(task: () => Promise<T>): Promise<T> {
  if (!isRunning) {
    isRunning = true;
    try {
      return await task();
    } finally {
      isRunning = false;
      processQueue();
    }
  }

  // 排队等待
  return new Promise((resolve, reject) => {
    taskQueue.push({ resolve, reject, task });
  });
}

function processQueue() {
  if (taskQueue.length === 0) return;
  const next = taskQueue.shift()!;
  isRunning = true;
  next.task()
    .then(next.resolve)
    .catch(next.reject)
    .finally(() => {
      isRunning = false;
      processQueue();
    });
}

// ==================== 工具函数 ====================

/** 读取请求 body */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** 发送 JSON 响应 */
function sendJson(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data, null, 2));
}

// ==================== 发布逻辑（原有） ====================

async function handlePublish(body: { content: string; platform?: string }): Promise<{ success: boolean; results: PublishResult[] }> {
  const { content, platform = 'all' } = body;

  if (!content || !content.trim()) {
    throw new Error('content 不能为空');
  }

  const hash = createHash('md5').update(content).digest('hex').substring(0, 8);
  const tmpFile = resolve(tmpDir, `publish-${hash}-${Date.now()}.md`);
  writeFileSync(tmpFile, content, 'utf-8');

  const article = MarkdownParser.parseArticle(tmpFile);
  console.log(`📄 收到发布请求: "${article.title}" → ${platform}`);

  const browserManager = new BrowserManager();
  await browserManager.launch();

  const platforms = platform === 'all' ? ['csdn', 'zhihu'] : [platform];
  const results: PublishResult[] = [];

  try {
    for (const p of platforms) {
      console.log(`📤 发布到 ${p.toUpperCase()}...`);
      const context = await browserManager.createContext(p);
      await browserManager.startTracing(p);

      let publisher;
      switch (p) {
        case 'csdn':
          publisher = new CsdnPublisher(context);
          break;
        case 'zhihu':
          publisher = new ZhihuPublisher(context);
          break;
        default:
          continue;
      }

      const result = await publisher.publish(article);
      results.push(result);

      await browserManager.stopTracing(p, result.success);
      if (result.success) {
        await browserManager.saveState(p);
      }
    }
  } finally {
    await browserManager.close();
  }

  return {
    success: results.every(r => r.success),
    results,
  };
}

// ==================== 监控逻辑（新增） ====================

/**
 * 处理 GEO 监控请求
 * 使用 Playwright 模拟真实用户在各 AI 引擎搜索，抓取回答
 */
async function handleMonitor(body: MonitorRequest): Promise<MonitorResponse> {
  const { keywords, engines: requestedEngines } = body;

  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    throw new Error('keywords 必须是非空数组');
  }

  // 确定要查询的引擎
  const engines = requestedEngines && requestedEngines.length > 0
    ? requestedEngines.filter(e => SUPPORTED_ENGINES.includes(e as any))
    : [...SUPPORTED_ENGINES];

  if (engines.length === 0) {
    throw new Error(`无有效引擎。支持: ${SUPPORTED_ENGINES.join(', ')}`);
  }

  console.log(`\n🔍 收到监控请求:`);
  console.log(`   关键词: ${keywords.length} 个`);
  console.log(`   引擎: ${engines.join(', ')}`);
  console.log('─'.repeat(50));

  const results: SearchResult[] = [];
  const errors: string[] = [];

  // 初始化浏览器
  const browserManager = new BrowserManager();
  await browserManager.launch();

  try {
    for (const engine of engines) {
      console.log(`\n▶ 引擎: ${engine.toUpperCase()}`);

      // 为该引擎创建上下文（自动加载 Cookie 和反检测）
      let context;
      try {
        context = await browserManager.createContext(engine);
      } catch (err) {
        const error = `${engine} 上下文创建失败: ${(err as Error).message}`;
        console.error(`  ✗ ${error}`);
        errors.push(error);
        continue;
      }

      // 创建采集器
      const scraper = createScraper(engine, context);

      // 逐一查询关键词
      for (let i = 0; i < keywords.length; i++) {
        const keyword = keywords[i];
        console.log(`\n  [${i + 1}/${keywords.length}] "${keyword}"`);

        const result = await scraper.search(keyword);
        results.push(result);

        if (!result.success) {
          errors.push(`${engine}/${keyword}: ${result.error}`);
        }

        // 查询间隔（避免触发频控）
        if (i < keywords.length - 1) {
          const delay = config.monitor.queryDelay.min +
            Math.random() * (config.monitor.queryDelay.max - config.monitor.queryDelay.min);
          await new Promise(r => setTimeout(r, delay));
        }
      }

      // 保存引擎的 Cookie 状态（可能有新的 session）
      try {
        await browserManager.saveState(engine);
      } catch { /* 忽略保存失败 */ }

      // 引擎间隔
      if (engines.indexOf(engine) < engines.length - 1) {
        const delay = config.monitor.engineDelay.min +
          Math.random() * (config.monitor.engineDelay.max - config.monitor.engineDelay.min);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  } finally {
    await browserManager.close();
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 监控完成: ${successCount}/${results.length} 成功, ${errors.length} 错误\n`);

  return {
    success: errors.length === 0,
    results,
    errors,
  };
}

// ==================== HTTP 服务 ====================

const server = createServer(async (req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, {});
    return;
  }

  // 健康检查
  if (req.url === '/health' && req.method === 'GET') {
    sendJson(res, 200, {
      status: 'ok',
      version: '1.1.0',
      capabilities: ['publish', 'monitor'],
      isRunning,
      queueLength: taskQueue.length,
    });
    return;
  }

  // 发布接口
  if (req.url === '/publish' && req.method === 'POST') {
    try {
      const rawBody = await readBody(req);
      const body = JSON.parse(rawBody);
      const result = await acquireLock(() => handlePublish(body));
      sendJson(res, 200, result);
    } catch (err) {
      const error = err as Error;
      console.error('❌ 发布失败:', error.message);
      sendJson(res, 500, { success: false, error: error.message });
    }
    return;
  }

  // 监控接口（新增）
  if (req.url === '/monitor' && req.method === 'POST') {
    try {
      const rawBody = await readBody(req);
      const body: MonitorRequest = JSON.parse(rawBody);
      const result = await acquireLock(() => handleMonitor(body));
      sendJson(res, 200, result);
    } catch (err) {
      const error = err as Error;
      console.error('❌ 监控失败:', error.message);
      sendJson(res, 500, { success: false, results: [], errors: [error.message] });
    }
    return;
  }

  // 404
  sendJson(res, 404, {
    error: 'Not found',
    endpoints: {
      'POST /publish': '发布文章到 CSDN/知乎',
      'POST /monitor': 'GEO 监控：模拟搜索 AI 引擎并抓取回答',
      'GET /health': '健康检查',
    },
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Playwright Publisher + GEO Monitor API 服务已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   健康检查: GET  http://localhost:${PORT}/health`);
  console.log(`   发布接口: POST http://localhost:${PORT}/publish`);
  console.log(`   监控接口: POST http://localhost:${PORT}/monitor`);
  console.log(`\n📝 监控调用示例:`);
  console.log(`   curl -X POST http://localhost:${PORT}/monitor \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"keywords": ["自集尘吸尘器推荐"], "engines": ["deepseek", "metaso"]}'`);
  console.log('');
});
