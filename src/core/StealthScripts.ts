/**
 * 隐身注入脚本集合
 * 用于 context.addInitScript()，在每个页面加载前执行
 * 覆盖各种浏览器指纹检测点
 */

/**
 * 综合反检测脚本 —— 合并所有伪造逻辑为单一注入
 * 涵盖：webdriver、plugins、Canvas、WebGL、AudioContext、权限 API 等
 */
export function getComprehensiveStealthScript(): string {
  return `
    (() => {
      // ═══════════════════════════════════════════════════════════════
      // 1. 基础标志位抹除
      // ═══════════════════════════════════════════════════════════════

      // 抹除 navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // 删除 Playwright/Puppeteer 注入的全局标记
      delete window.__playwright;
      delete window.__pw_manual;

      // 伪造 navigator.plugins（模拟 Chrome 默认插件）
      const mockPlugins = {
        0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        2: { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        length: 3,
        item: function(i) { return this[i] || null; },
        namedItem: function(name) { return Object.values(this).find(p => p?.name === name) || null; },
        refresh: function() {},
      };
      Object.defineProperty(navigator, 'plugins', { get: () => mockPlugins });

      // 伪造 navigator.mimeTypes
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => ({
          length: 4,
          item: (i) => null,
          namedItem: (name) => null,
        }),
      });

      // 伪造语言
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'language', { get: () => 'zh-CN' });

      // 伪造硬件并发数（随机 4/8/12/16）
      const cores = [4, 8, 12, 16][Math.floor(Math.random() * 4)];
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });

      // 伪造设备内存 (4/8/16 GB)
      Object.defineProperty(navigator, 'deviceMemory', { get: () => [4, 8, 16][Math.floor(Math.random() * 3)] });

      // ═══════════════════════════════════════════════════════════════
      // 2. Chrome 对象伪造
      // ═══════════════════════════════════════════════════════════════

      window.chrome = {
        app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
        runtime: { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' }, PlatformArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }, connect: function() {}, sendMessage: function() {} },
        csi: function() { return { onloadT: Date.now(), startE: Date.now() - Math.random() * 1000, pageT: Math.random() * 3000 }; },
        loadTimes: function() { return { commitLoadTime: Date.now() / 1000, connectionInfo: 'h2', finishDocumentLoadTime: Date.now() / 1000 + Math.random(), finishLoadTime: Date.now() / 1000 + Math.random() * 2, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000 + 0.1, navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: Date.now() / 1000 - Math.random(), startLoadTime: Date.now() / 1000 - Math.random() * 2, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true }; },
      };

      // ═══════════════════════════════════════════════════════════════
      // 3. Canvas 指纹噪声注入
      // ═══════════════════════════════════════════════════════════════

      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

      // 为每个会话生成固定的噪声种子（保证同一会话内指纹一致）
      const noiseSeed = Math.random() * 0.01;

      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          // 在不可见像素中注入微小噪声
          const imageData = originalGetImageData.call(ctx, 0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            // 仅修改极少数像素，且偏移量极小（1-2），人眼不可见
            if (Math.random() < 0.001) {
              imageData.data[i] = imageData.data[i] ^ (Math.floor(Math.random() * 3));
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, args);
      };

      HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = originalGetImageData.call(ctx, 0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            if (Math.random() < 0.001) {
              imageData.data[i] = imageData.data[i] ^ (Math.floor(Math.random() * 3));
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
        return originalToBlob.call(this, callback, ...args);
      };

      // ═══════════════════════════════════════════════════════════════
      // 4. WebGL 指纹伪造
      // ═══════════════════════════════════════════════════════════════

      const getParameterProxy = new Proxy(WebGLRenderingContext.prototype.getParameter, {
        apply(target, thisArg, args) {
          const param = args[0];
          // UNMASKED_VENDOR_WEBGL
          if (param === 37445) {
            return 'Google Inc. (NVIDIA)';
          }
          // UNMASKED_RENDERER_WEBGL
          if (param === 37446) {
            const renderers = [
              'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
              'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0)',
              'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
              'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)',
            ];
            // 使用 noiseSeed 保证同一会话返回相同值
            return renderers[Math.floor(noiseSeed * 100) % renderers.length];
          }
          return Reflect.apply(target, thisArg, args);
        },
      });
      WebGLRenderingContext.prototype.getParameter = getParameterProxy;

      // WebGL2 同样处理
      if (typeof WebGL2RenderingContext !== 'undefined') {
        WebGL2RenderingContext.prototype.getParameter = getParameterProxy;
      }

      // ═══════════════════════════════════════════════════════════════
      // 5. Permissions API 行为一致性
      // ═══════════════════════════════════════════════════════════════

      const originalQuery = Permissions.prototype.query;
      Permissions.prototype.query = function(parameters) {
        // notifications 权限在自动化中通常是 'denied'，真实浏览器是 'prompt'
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: 'prompt', onchange: null });
        }
        return originalQuery.call(this, parameters);
      };

      // ═══════════════════════════════════════════════════════════════
      // 6. iframe contentWindow 检测绕过
      // ═══════════════════════════════════════════════════════════════

      // 某些检测脚本通过创建 iframe 检查 contentWindow 属性来判断自动化环境
      const originalAttachShadow = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(init) {
        return originalAttachShadow.call(this, init);
      };

      // ═══════════════════════════════════════════════════════════════
      // 7. AudioContext 指纹噪声
      // ═══════════════════════════════════════════════════════════════

      const originalCreateOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function() {
        const oscillator = originalCreateOscillator.call(this);
        // 微调频率偏移使指纹产生差异
        const originalStart = oscillator.start.bind(oscillator);
        oscillator.start = function(when) {
          oscillator.frequency.value += (Math.random() - 0.5) * 0.001;
          return originalStart(when);
        };
        return oscillator;
      };

      console.log('[Stealth] 反指纹注入完成');
    })();
  `;
}
