// 全局配置文件
export const config = {
  // 浏览器设置
  browser: {
    headless: true,          // 生产环境无头运行
    slowMo: 0,               // 调试时可设为 50-100
    timeout: 30000,          // 全局超时（毫秒）
    viewport: { width: 1920, height: 1080 },
  },
  // 人类行为模拟参数
  humanBehavior: {
    typing: { minDelay: 50, maxDelay: 150 },    // 打字间隔（毫秒）
    scroll: { minDistance: 200, maxDistance: 600 },
    actionDelay: { min: 1000, max: 3000 },      // 操作间隔
  },
  // 发布平台配置
  platforms: {
    csdn: {
      editorUrl: 'https://editor.csdn.net/md/?not_checkout=1&spm=1015.2103.3001.8066',
      statePath: 'storage/auth/csdn_state.json',
    },
    zhihu: {
      editorUrl: 'https://zhuanlan.zhihu.com/write',
      statePath: 'storage/auth/zhihu_state.json',
    },
  },
  // GEO 监控 — AI 搜索引擎采集器配置
  scrapers: {
    deepseek: {
      url: 'https://chat.deepseek.com',
      statePath: 'storage/auth/deepseek_state.json',
    },
    kimi: {
      url: 'https://kimi.moonshot.cn',
      statePath: 'storage/auth/kimi_state.json',
    },
    yuanbao: {
      url: 'https://yuanbao.tencent.com',
      statePath: 'storage/auth/yuanbao_state.json',
    },
    metaso: {
      url: 'https://metaso.cn',
      statePath: 'storage/auth/metaso_state.json',
    },
  },
  // 存储路径
  storage: {
    authDir: 'storage/auth',
    logsDir: 'storage/logs',
    historyFile: 'storage/publish_history.json',
  },
  // 重试策略
  retry: {
    maxAttempts: 3,
    backoffMs: 5000,
  },
  // 监控任务配置
  monitor: {
    responseTimeout: 120000,    // AI 回复最大等待时间（2分钟）
    stabilizeWait: 3000,        // 回复文本稳定等待时间（3秒无变化视为完成）
    queryDelay: { min: 3000, max: 5000 }, // 同引擎查询间隔
    engineDelay: { min: 2000, max: 4000 }, // 切换引擎间隔
  },
};
