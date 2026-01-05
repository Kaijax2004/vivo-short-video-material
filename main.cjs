/**
 * Electron 主进程 - 集成 Express 服务器
 * 将后端服务器直接运行在 Electron 主进程中，避免子进程问题
 */
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Express 相关模块
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const https = require('https');
const http = require('http');

let mainWindow;
let server;
const PORT = 3000;

// 获取应用目录
function getAppPath() {
    if (app.isPackaged) {
        return path.join(path.dirname(app.getPath('exe')), 'resources', 'app');
    }
    return __dirname;
}

// 手动加载 .env 文件
function loadEnv() {
    const appPath = getAppPath();
    const envPath = path.join(appPath, '.env');
    
    console.log('加载配置文件:', envPath);
    
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                const eqIndex = line.indexOf('=');
                if (eqIndex > 0) {
                    const key = line.substring(0, eqIndex).trim();
                    const value = line.substring(eqIndex + 1).trim();
                    process.env[key] = value;
                }
            }
        });
        console.log('配置文件加载完成');
    } else {
        // 创建默认配置
        console.log('创建默认配置文件...');
        const defaultEnv = `ACCESS_KEY_ID=4N8shY43VzNR4QWC
ACCESS_KEY_SECRET=ipiQ07IAPC7JBmJv9LjKrhGTeN1qAoDo
VIVO_API_URL=https://qappcenter.vivo.com.cn/playlet-openapi/query
PORT=3000
ACCESS_PASSWORD=vivo2026`;
        fs.writeFileSync(envPath, defaultEnv);
        // 重新加载
        loadEnv();
    }
}


// 原生 HTTPS/HTTP 请求函数
function fetchUrl(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || { 'User-Agent': 'vivo-playlet-tool/1.1.0' },
            timeout: 30000
        };

        const req = protocol.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    statusText: res.statusMessage,
                    headers: res.headers,
                    json: () => Promise.resolve(JSON.parse(buffer.toString('utf8')))
                });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
        req.end();
    });
}

// 流式请求函数（用于下载大文件）
function fetchStream(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': urlObj.origin
            },
            timeout: 60000
        };

        const req = protocol.request(reqOptions, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchStream(res.headers.location, options).then(resolve).catch(reject);
                return;
            }
            
            resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                headers: res.headers,
                stream: res
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
        req.end();
    });
}


// 启动 Express 服务器（在主进程中）
function startServer() {
    return new Promise((resolve, reject) => {
        try {
            loadEnv();
            
            const ACCESS_KEY_ID = process.env.ACCESS_KEY_ID || '4N8shY43VzNR4QWC';
            const ACCESS_KEY_SECRET = process.env.ACCESS_KEY_SECRET || 'ipiQ07IAPC7JBmJv9LjKrhGTeN1qAoDo';
            const VIVO_API_URL = process.env.VIVO_API_URL || 'https://qappcenter.vivo.com.cn/playlet-openapi/query';
            
            const appPath = getAppPath();
            const expressApp = express();

            // 生成签名
            function generateSign(baseParams) {
                const allParams = { ...baseParams, accessKeySecret: ACCESS_KEY_SECRET };
                const sortedKeys = Object.keys(allParams).sort();
                const signString = sortedKeys.map(key => `${key}=${allParams[key]}`).join('&');
                const hmac = crypto.createHmac('sha256', ACCESS_KEY_SECRET);
                hmac.update(signString, 'utf8');
                return hmac.digest('hex');
            }

            // 安全中间件
            expressApp.use(helmet({
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

            expressApp.use(cors({ origin: true, credentials: true }));

            // 请求频率限制
            const limiter = rateLimit({
                windowMs: 15 * 60 * 1000,
                max: 100,
                message: { code: -1, msg: '请求过于频繁，请稍后再试' },
                standardHeaders: true,
                legacyHeaders: false,
            });
            expressApp.use('/api/', limiter);

            expressApp.use(express.json({ limit: '10mb' }));
            expressApp.use(express.urlencoded({ extended: true, limit: '10mb' }));

            // API: 查询短剧信息
            expressApp.get('/api/playlet', async (req, res) => {
                try {
                    const { fcPlayletId, supportH265 } = req.query;

                    if (!fcPlayletId || typeof fcPlayletId !== 'string' || fcPlayletId.length < 3) {
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
                        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(finalParams[key])}`)
                        .join('&');

                    const url = `${VIVO_API_URL}?${queryString}`;
                    console.log('请求vivo API:', fcPlayletId);

                    const response = await fetchUrl(url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const data = await response.json();
                    console.log('查询成功:', fcPlayletId);
                    res.json(data);

                } catch (err) {
                    console.error('查询失败:', err.message);
                    res.status(500).json({ code: -1, msg: err.message || '服务器内部错误' });
                }
            });


            // API: 视频下载代理
            expressApp.post('/api/download', async (req, res) => {
                try {
                    const { url, filename } = req.body;

                    if (!url) {
                        return res.status(400).json({ code: -1, msg: '缺少视频URL' });
                    }

                    let videoUrl;
                    try {
                        videoUrl = new URL(url);
                    } catch (e) {
                        return res.status(400).json({ code: -1, msg: '视频URL格式不正确' });
                    }

                    console.log('开始代理下载:', filename || 'unknown');

                    const response = await fetchStream(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Referer': videoUrl.origin
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const contentType = response.headers['content-type'] || 'video/mp4';
                    const contentLength = response.headers['content-length'];

                    res.setHeader('Content-Type', contentType);
                    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'video.mp4')}"`);
                    
                    if (contentLength) {
                        res.setHeader('Content-Length', contentLength);
                    }

                    response.stream.pipe(res);

                    response.stream.on('end', () => {
                        console.log('下载完成:', filename || 'unknown');
                    });

                } catch (err) {
                    console.error('下载失败:', err.message);
                    if (!res.headersSent) {
                        res.status(500).json({ code: -1, msg: err.message || '下载失败' });
                    }
                }
            });

            // API: 健康检查
            expressApp.get('/api/health', (req, res) => {
                res.json({
                    status: 'ok',
                    timestamp: Date.now(),
                    version: '1.1.0',
                    uptime: process.uptime()
                });
            });

            // 静态文件托管
            expressApp.use(express.static(appPath, {
                maxAge: '1d',
                etag: true,
                lastModified: true
            }));

            // 404 处理
            expressApp.use('*', (req, res) => {
                res.status(404).json({ code: -1, msg: '接口不存在' });
            });

            // 启动服务器
            server = expressApp.listen(PORT, () => {
                console.log(`服务器已启动：http://localhost:${PORT}`);
                resolve();
            });

            server.on('error', (err) => {
                console.error('服务器启动失败:', err.message);
                reject(err);
            });

        } catch (err) {
            console.error('启动服务器异常:', err.message);
            reject(err);
        }
    });
}


// 创建主窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'vivo短剧素材库工具',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });
    
    console.log(`加载页面: http://localhost:${PORT}`);
    mainWindow.loadURL(`http://localhost:${PORT}`);
    
    let loadRetries = 0;
    const maxRetries = 3;
    
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`页面加载失败: ${errorCode} - ${errorDescription}`);
        loadRetries++;
        
        if (loadRetries < maxRetries) {
            console.log(`重试加载页面 (${loadRetries}/${maxRetries})...`);
            setTimeout(() => {
                mainWindow.loadURL(`http://localhost:${PORT}`);
            }, 1000);
        } else {
            dialog.showErrorBox('加载失败', '无法连接到本地服务器，请重启应用');
        }
    });
    
    mainWindow.once('ready-to-show', () => {
        console.log('窗口准备就绪');
        mainWindow.show();
    });
    
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.setMenuBarVisibility(false);
}

// 应用准备就绪
app.whenReady().then(async () => {
    try {
        console.log('========== 应用启动 ==========');
        console.log('是否打包:', app.isPackaged);
        console.log('应用目录:', getAppPath());
        
        await startServer();
        
        // 短暂等待确保服务器完全就绪
        await new Promise(resolve => setTimeout(resolve, 500));
        
        createWindow();
        
    } catch (error) {
        console.error('启动失败:', error);
        dialog.showErrorBox('启动失败', `无法启动应用: ${error.message}`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    console.log('所有窗口已关闭');
    if (server) {
        server.close();
    }
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    if (server) {
        server.close();
    }
});

process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
});
