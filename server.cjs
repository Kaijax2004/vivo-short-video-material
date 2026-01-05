const express = require('express');
const crypto = require('crypto');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// 动态导入 node-fetch 和 dotenv
let fetch;
let dotenv;

async function init() {
  // 动态导入 ES Module
  const nodeFetch = await import('node-fetch');
  fetch = nodeFetch.default;
  
  const dotenvModule = await import('dotenv');
  dotenv = dotenvModule.default;
  
  // 加载环境变量
  dotenv.config();
  
  startServer();
}

function startServer() {
  // ===== 配置信息（从环境变量读取）=====
  const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
  const ACCESS_KEY_SECRET = process.env.ACCESS_KEY_SECRET;
  const VIVO_API_URL = process.env.VIVO_API_URL || 'https://qappcenter.vivo.com.cn/playlet-openapi/query';
  const PORT = process.env.PORT || 3000;

  // 验证必要的环境变量
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) {
    console.error('❌ 错误: 缺少必要的环境变量 ACCESS_KEY_ID 或 ACCESS_KEY_SECRET');
    console.error('请检查 .env 文件配置');
    process.exit(1);
  }

  const app = express();

  // 安全中间件
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
      },
    },
  }));

  // CORS 配置
  app.use(cors({
    origin: true,
    credentials: true
  }));

  // 请求频率限制
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { code: -1, msg: '请求过于频繁，请稍后再试' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/', limiter);

  // 解析JSON请求体
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 生成签名
  function generateSign(baseParams) {
    const allParams = { ...baseParams, accessKeySecret: ACCESS_KEY_SECRET };
    const sortedKeys = Object.keys(allParams).sort();
    const signString = sortedKeys.map((key) => `${key}=${allParams[key]}`).join('&');
    const hmac = crypto.createHmac('sha256', ACCESS_KEY_SECRET);
    hmac.update(signString, 'utf8');
    return hmac.digest('hex');
  }

  // 后端代理接口
  app.get('/api/playlet', async (req, res) => {
    try {
      const { fcPlayletId, supportH265 } = req.query;

      if (!fcPlayletId) {
        return res.status(400).json({ code: -1, msg: '缺少 fcPlayletId（短剧ID）' });
      }

      if (typeof fcPlayletId !== 'string' || fcPlayletId.length < 3) {
        return res.status(400).json({ code: -1, msg: '短剧ID格式不正确' });
      }

      const timestamp = Date.now().toString();
      const baseParams = {
        accessKeyId: ACCESS_KEY_ID,
        fcPlayletId: fcPlayletId.trim(),
        timestamp
      };

      if (supportH265 === 'true') {
        baseParams.supportH265 = 'true';
      }

      const sign = generateSign(baseParams);
      const finalParams = { ...baseParams, sign };

      const queryString = Object.keys(finalParams)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(finalParams[key])}`)
        .join('&');

      const url = `${VIVO_API_URL}?${queryString}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'vivo-playlet-tool/1.1.0' }
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`✅ 成功查询短剧: ${fcPlayletId}`);
      res.json(data);

    } catch (err) {
      console.error('❌ 调用 vivo 接口出错：', err.message);
      res.status(500).json({ code: -1, msg: err.message || '服务器内部错误' });
    }
  });

  // 静态托管目录
  app.use(express.static(__dirname, {
    maxAge: '1d',
    etag: true,
    lastModified: true
  }));

  // 视频下载代理接口
  app.post('/api/download', async (req, res) => {
    try {
      const { url, filename } = req.body;

      if (!url) {
        return res.status(400).json({ code: -1, msg: '缺少视频URL' });
      }

      let videoUrl;
      try {
        videoUrl = new URL(url);
      } catch (err) {
        return res.status(400).json({ code: -1, msg: '视频URL格式不正确' });
      }

      console.log(`📥 开始代理下载: ${filename || 'unknown'}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': videoUrl.origin
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || 'video/mp4';
      const contentLength = response.headers.get('content-length');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'video.mp4')}"`);
      
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      response.body.pipe(res);
      console.log(`✅ 下载完成: ${filename || 'unknown'}`);

    } catch (err) {
      console.error('❌ 下载失败:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ code: -1, msg: err.message || '下载失败' });
      }
    }
  });

  // 健康检查接口
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      version: '1.1.0',
      uptime: process.uptime()
    });
  });

  // 404 处理
  app.use('*', (req, res) => {
    res.status(404).json({ code: -1, msg: '接口不存在' });
  });

  // 全局错误处理
  app.use((err, req, res, next) => {
    console.error('❌ 全局错误:', err.message);
    res.status(500).json({ code: -1, msg: '服务器内部错误' });
  });

  const PORT_NUM = parseInt(PORT, 10);
  app.listen(PORT_NUM, () => {
    console.log(`🚀 服务器已启动：http://localhost:${PORT_NUM}`);
    console.log(`📊 健康检查：http://localhost:${PORT_NUM}/api/health`);
    console.log(`🔒 安全中间件已启用`);
    console.log(`⏱️  请求频率限制：100次/15分钟`);
  });
}

// 启动
init().catch(err => {
  console.error('初始化失败:', err);
  process.exit(1);
});
