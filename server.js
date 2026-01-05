import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// 加载环境变量
dotenv.config();

// 兼容 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// 验证环境变量格式
if (ACCESS_KEY_ID.length < 8 || ACCESS_KEY_SECRET.length < 16) {
  console.error('❌ 错误: ACCESS_KEY_ID 或 ACCESS_KEY_SECRET 格式不正确');
  console.error('ACCESS_KEY_ID 长度应至少8位，ACCESS_KEY_SECRET 长度应至少16位');
  process.exit(1);
}
// ===================================

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
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
}));

// 请求频率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 限制每个IP 15分钟内最多100个请求
  message: {
    code: -1,
    msg: '请求过于频繁，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// 请求日志中间件
app.use('/api/', (req, res, next) => {
  const start = Date.now();
  const originalSend = res.send;
  
  res.send = function(data) {
    const duration = Date.now() - start;
    console.log(`📊 API请求: ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
    originalSend.call(this, data);
  };
  
  next();
});

// 解析JSON请求体
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 生成签名（完全按文档说明：参数+accessKeySecret 一起按字母排序）
function generateSign(baseParams) {
  const allParams = {
    ...baseParams,
    accessKeySecret: ACCESS_KEY_SECRET
  };

  const sortedKeys = Object.keys(allParams).sort();
  const signString = sortedKeys
    .map((key) => `${key}=${allParams[key]}`)
    .join('&');

  const hmac = crypto.createHmac('sha256', ACCESS_KEY_SECRET);
  hmac.update(signString, 'utf8');
  return hmac.digest('hex');
}

// 后端代理接口：/api/playlet?fcPlayletId=xxx&supportH265=true
app.get('/api/playlet', async (req, res) => {
  try {
    const { fcPlayletId, supportH265 } = req.query;

    // 参数验证
    if (!fcPlayletId) {
      return res
        .status(400)
        .json({ code: -1, msg: '缺少 fcPlayletId（短剧ID）' });
    }

    // 验证短剧ID格式（基本验证）
    if (typeof fcPlayletId !== 'string' || fcPlayletId.length < 3) {
      return res
        .status(400)
        .json({ code: -1, msg: '短剧ID格式不正确' });
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

    const finalParams = {
      ...baseParams,
      sign
    };

    const queryString = Object.keys(finalParams)
      .map(
        (key) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(finalParams[key])}`
      )
      .join('&');

    const url = `${VIVO_API_URL}?${queryString}`;

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'vivo-playlet-tool/1.1.0'
        }
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // 记录成功的请求
      console.log(`✅ 成功查询短剧: ${fcPlayletId} - ${new Date().toISOString()}`);

      res.json(data);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        throw new Error('请求超时，请稍后重试');
      }
      throw fetchError;
    }

  } catch (err) {
    console.error('❌ 调用 vivo 接口出错：', {
      error: err.message,
      fcPlayletId: req.query.fcPlayletId,
      timestamp: new Date().toISOString(),
      ip: req.ip
    });
    
    // 根据错误类型返回不同的错误信息
    let errorMessage = '服务器内部错误';
    let statusCode = 500;

    if (err.message.includes('超时')) {
      errorMessage = '请求超时，请稍后重试';
      statusCode = 408;
    } else if (err.message.includes('网络')) {
      errorMessage = '网络连接失败，请检查网络连接';
      statusCode = 503;
    } else if (err.message.includes('HTTP 4')) {
      errorMessage = '请求参数错误或权限不足';
      statusCode = 400;
    }

    res
      .status(statusCode)
      .json({ 
        code: -1, 
        msg: errorMessage,
        timestamp: Date.now()
      });
  }
});

// 静态托管目录（index.html、app.js、styles.css）
app.use(express.static(__dirname, {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  etag: true,
  lastModified: true
}));

// 视频下载代理接口
app.post('/api/download', async (req, res) => {
  try {
    const { url, filename } = req.body;

    // 参数验证
    if (!url) {
      return res.status(400).json({ 
        code: -1, 
        msg: '缺少视频URL' 
      });
    }

    // URL格式验证
    let videoUrl;
    try {
      videoUrl = new URL(url);
    } catch (err) {
      return res.status(400).json({ 
        code: -1, 
        msg: '视频URL格式不正确' 
      });
    }

    console.log(`📥 开始代理下载视频: ${filename || 'unknown'} - ${url}`);

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': videoUrl.origin
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 获取内容类型和长度
      const contentType = response.headers.get('content-type') || 'video/mp4';
      const contentLength = response.headers.get('content-length');

      // 设置响应头
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'video.mp4')}"`);
      
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      // 流式传输视频数据
      response.body.pipe(res);

      console.log(`✅ 视频下载完成: ${filename || 'unknown'}`);

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        throw new Error('下载超时，请稍后重试');
      }
      throw fetchError;
    }

  } catch (err) {
    console.error('❌ 视频下载失败:', {
      error: err.message,
      url: req.body.url,
      filename: req.body.filename,
      timestamp: new Date().toISOString(),
      ip: req.ip
    });

    // 如果响应还没有开始，发送错误信息
    if (!res.headersSent) {
      let errorMessage = '视频下载失败';
      let statusCode = 500;

      if (err.message.includes('超时')) {
        errorMessage = '下载超时，请稍后重试';
        statusCode = 408;
      } else if (err.message.includes('网络')) {
        errorMessage = '网络连接失败，请检查网络连接';
        statusCode = 503;
      } else if (err.message.includes('HTTP 4')) {
        errorMessage = '视频资源不可访问';
        statusCode = 404;
      }

      res.status(statusCode).json({
        code: -1,
        msg: errorMessage,
        timestamp: Date.now()
      });
    }
  }
});

// 健康检查接口
app.get('/api/health', async (req, res) => {
  const healthCheck = {
    status: 'ok',
    timestamp: Date.now(),
    version: '1.1.0',
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  };

  res.json(healthCheck);
});

// 404 处理
app.use('*', (req, res) => {
  res.status(404).json({
    code: -1,
    msg: '接口不存在'
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  // 记录详细错误信息
  console.error('❌ 全局错误:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  
  // 不向客户端暴露敏感错误信息
  const isDevelopment = process.env.NODE_ENV === 'development';
  res.status(500).json({
    code: -1,
    msg: '服务器内部错误',
    ...(isDevelopment && { error: err.message, stack: err.stack })
  });
});

const PORT_NUM = parseInt(PORT, 10);
app.listen(PORT_NUM, () => {
  console.log(`🚀 服务器已启动：http://localhost:${PORT_NUM}`);
  console.log(`📊 健康检查：http://localhost:${PORT_NUM}/api/health`);
  console.log(`🔒 安全中间件已启用`);
  console.log(`⏱️  请求频率限制：100次/15分钟`);
});


