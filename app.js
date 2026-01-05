// 配置信息：前端只调用本地后端代理接口
const CONFIG = {
    apiUrl: '/api/playlet',
    healthUrl: '/api/health',
    // 请求超时时间（毫秒）
    requestTimeout: 30000,
    // 重试配置
    maxRetries: 3,
    retryDelay: 1000,
    // 批量下载配置
    maxConcurrentDownloads: 3,
    downloadChunkSize: 1024 * 1024 * 5, // 5MB chunks
};

// 登录状态管理
const AUTH_KEY = 'vivo_playlet_auth';
const AUTH_TOKEN = 'authenticated_' + Date.now();

// 获取访问密码配置
async function getAccessPassword() {
    try {
        // 从服务器获取配置（实际项目中应该通过安全的方式获取）
        // 这里为了演示，暂时使用默认密码
        return 'vivo2026'; // 更新密码
    } catch (err) {
        console.error('获取配置失败:', err);
        return 'vivo2026'; // 降级到默认密码
    }
}

// 检查登录状态
function checkAuth() {
    const authData = localStorage.getItem(AUTH_KEY);
    if (authData) {
        const { token, expireTime } = JSON.parse(authData);
        if (Date.now() < expireTime && token) {
            showMainContent();
            return true;
        }
    }
    showLoginModal();
    return false;
}

// 显示登录界面
function showLoginModal() {
    const loginModal = document.getElementById('loginModal');
    const mainContainer = document.getElementById('mainContainer');
    loginModal.classList.remove('hidden');
    mainContainer.classList.add('hidden');
}

// 显示主内容
function showMainContent() {
    const loginModal = document.getElementById('loginModal');
    const mainContainer = document.getElementById('mainContainer');
    loginModal.classList.add('hidden');
    mainContainer.classList.remove('hidden');
}

// 登录验证
async function handleLogin() {
    const passwordInput = document.getElementById('passwordInput');
    const loginError = document.getElementById('loginError');
    const password = passwordInput.value.trim();
    
    if (!password) {
        loginError.textContent = '请输入密码';
        loginError.classList.remove('hidden');
        passwordInput.focus();
        return;
    }
    
    try {
        const correctPassword = await getAccessPassword();
        
        if (password === correctPassword) {
            // 登录成功，保存认证信息（24小时有效）
            const expireTime = Date.now() + 24 * 60 * 60 * 1000;
            localStorage.setItem(AUTH_KEY, JSON.stringify({
                token: AUTH_TOKEN,
                expireTime: expireTime
            }));
            
            showMainContent();
            passwordInput.value = '';
            loginError.classList.add('hidden');
        } else {
            loginError.textContent = '密码错误，请重试';
            loginError.classList.remove('hidden');
            passwordInput.value = '';
            passwordInput.focus();
            
            // 添加错误动画
            passwordInput.style.animation = 'shake 0.4s';
            setTimeout(() => {
                passwordInput.style.animation = '';
            }, 400);
        }
    } catch (err) {
        console.error('登录验证失败:', err);
        loginError.textContent = '登录验证失败，请稍后重试';
        loginError.classList.remove('hidden');
    }
}

// 页面加载时检查登录状态和服务器健康状态
document.addEventListener('DOMContentLoaded', async () => {
    // 检查服务器健康状态
    try {
        const healthResponse = await fetch(CONFIG.healthUrl);
        if (healthResponse.ok) {
            console.log('✅ 服务器连接正常');
        }
    } catch (err) {
        console.warn('⚠️ 服务器健康检查失败:', err);
        showToast('服务器连接异常，部分功能可能不可用');
    }
    
    // 检查登录状态
    checkAuth();
    
    // 绑定登录事件
    const passwordInput = document.getElementById('passwordInput');
    const loginBtn = document.getElementById('loginBtn');
    
    if (passwordInput && loginBtn) {
        loginBtn.addEventListener('click', handleLogin);
        
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleLogin();
            }
        });
    }
    
    // 绑定复制简介按钮事件
    document.addEventListener('click', (e) => {
        if (e.target.closest('.btn-copy-intro')) {
            e.preventDefault();
            copyIntroduction(e);
        }
        
        // 绑定复制封面链接按钮
        if (e.target.closest('.copy-cover-btn')) {
            e.preventDefault();
            copyToClipboard('coverUrl');
        }
        
        // 绑定下载封面按钮
        if (e.target.closest('.download-cover-btn')) {
            e.preventDefault();
            downloadCover();
        }
        
        // 绑定批量下载按钮
        if (e.target.closest('.batch-download-btn')) {
            e.preventDefault();
            batchDownload();
        }
    });
});

// DOM元素
const playletIdInput = document.getElementById('playletId');
const supportH265Checkbox = document.getElementById('supportH265');
const searchBtn = document.getElementById('searchBtn');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const result = document.getElementById('result');
const batchActions = document.getElementById('batchActions');
const selectAllCheckbox = document.getElementById('selectAll');
const selectedCountSpan = document.getElementById('selectedCount');

// 存储当前剧集数据，用于批量下载
let currentEpisodes = [];

// 带重试的 fetch 请求
async function fetchWithRetry(url, options = {}, retries = CONFIG.maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.requestTimeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (retries > 0 && !error.name === 'AbortError') {
            console.log(`请求失败，${CONFIG.retryDelay}ms 后重试... (剩余重试次数: ${retries})`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
            return fetchWithRetry(url, options, retries - 1);
        }
        
        throw error;
    }
}

// 构建请求URL
async function buildRequestUrl(playletId, supportH265) {
    const params = new URLSearchParams();
    params.append('fcPlayletId', playletId);
    if (supportH265) {
        params.append('supportH265', 'true');
    }
    return `${CONFIG.apiUrl}?${params.toString()}`;
}

// 查询短剧信息
async function queryPlaylet() {
    const playletId = playletIdInput.value.trim();
    
    if (!playletId) {
        showError('请输入短剧ID');
        // 添加输入框抖动动画
        playletIdInput.style.animation = 'shake 0.4s';
        setTimeout(() => {
            playletIdInput.style.animation = '';
            playletIdInput.focus();
        }, 400);
        return;
    }
    
    // 基本格式验证
    if (playletId.length < 3) {
        showError('短剧ID格式不正确，请检查后重试');
        playletIdInput.focus();
        return;
    }
    
    // 显示加载状态
    loading.classList.remove('hidden');
    error.classList.add('hidden');
    result.classList.add('hidden');
    searchBtn.disabled = true;
    searchBtn.textContent = '查询中...';
    
    // 添加加载动画
    loading.style.opacity = '0';
    setTimeout(() => {
        loading.style.opacity = '1';
    }, 10);
    
    try {
        const supportH265 = supportH265Checkbox.checked;
        const url = await buildRequestUrl(playletId, supportH265);
        
        const response = await fetchWithRetry(url);
        const data = await response.json();
        
        if (data.code === 2000 && data.data) {
            // 延迟显示结果，让加载动画更自然
            setTimeout(() => {
                displayResult(data.data);
            }, 300);
        } else {
            // 根据错误码显示不同的错误信息
            let errorMessage = '查询失败';
            switch (data.code) {
                case -1:
                    errorMessage = data.msg || '请求参数错误';
                    break;
                case 404:
                    errorMessage = '未找到该短剧信息';
                    break;
                case 403:
                    errorMessage = '访问权限不足';
                    break;
                default:
                    errorMessage = data.msg || `查询失败 (错误码: ${data.code})`;
            }
            showError(errorMessage);
        }
    } catch (err) {
        console.error('查询错误:', err);
        
        let errorMessage = '查询失败';
        if (err.name === 'AbortError') {
            errorMessage = '请求超时，请检查网络连接后重试';
        } else if (err.message.includes('网络')) {
            errorMessage = '网络连接失败，请检查网络后重试';
        } else if (err.message.includes('HTTP 5')) {
            errorMessage = '服务器暂时不可用，请稍后重试';
        } else if (err.message.includes('HTTP 4')) {
            errorMessage = '请求参数错误或权限不足';
        } else {
            errorMessage = `查询失败：${err.message}`;
        }
        
        showError(errorMessage);
    } finally {
        setTimeout(() => {
            loading.classList.add('hidden');
            searchBtn.disabled = false;
            searchBtn.textContent = '查询短剧';
        }, 300);
    }
}

// 显示错误信息
function showError(message) {
    error.textContent = message;
    error.classList.remove('hidden');
    error.style.opacity = '0';
    setTimeout(() => {
        error.style.transition = 'opacity 0.3s';
        error.style.opacity = '1';
    }, 10);
}

// 显示查询结果
function displayResult(data) {
    // 显示短剧基本信息
    document.getElementById('playletName').textContent = data.name || '未知名称';
    
    // 显示状态
    const statusBadge = document.getElementById('statusBadge');
    if (data.status === 1) {
        statusBadge.textContent = '已上架';
        statusBadge.className = 'status-badge online';
    } else {
        statusBadge.textContent = '已下架';
        statusBadge.className = 'status-badge offline';
    }
    
    // 显示分类
    const categoriesDiv = document.getElementById('categories');
    if (data.fcCategoryList && data.fcCategoryList.length > 0) {
        categoriesDiv.innerHTML = data.fcCategoryList
            .map(cat => `<span class="category-tag">${cat}</span>`)
            .join('');
    } else {
        categoriesDiv.innerHTML = '';
    }
    
    // 显示简介
    document.getElementById('introduction').textContent = data.introduction || '暂无简介';
    
    // 显示封面
    const coverImg = document.getElementById('coverImg');
    const coverUrl = document.getElementById('coverUrl');
    if (data.coverWap) {
        // 添加加载动画
        coverImg.style.opacity = '0';
        coverImg.onload = function() {
            this.style.transition = 'opacity 0.3s';
            this.style.opacity = '1';
        };
        coverImg.src = data.coverWap;
        coverImg.onerror = function() {
            this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="400"%3E%3Crect fill="%23f5f5f7" width="300" height="400"/%3E%3Ctext fill="%2386868b" font-family="sans-serif" font-size="18" dy="10.5" font-weight="bold" x="50%25" y="50%25" text-anchor="middle"%3E暂无封面%3C/text%3E%3C/svg%3E';
            this.style.opacity = '1';
        };
        coverUrl.href = data.coverWap;
        coverImg.setAttribute('data-url', data.coverWap);
    } else {
        coverImg.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="400"%3E%3Crect fill="%23f5f5f7" width="300" height="400"/%3E%3Ctext fill="%2386868b" font-family="sans-serif" font-size="18" dy="10.5" font-weight="bold" x="50%25" y="50%25" text-anchor="middle"%3E暂无封面%3C/text%3E%3C/svg%3E';
        coverUrl.href = '#';
    }
    
    // 显示剧集列表
    const episodesGrid = document.getElementById('episodesGrid');
    if (data.episodeDetails && data.episodeDetails.length > 0) {
        // 按order排序
        const sortedEpisodes = [...data.episodeDetails].sort((a, b) => (a.order || 0) - (b.order || 0));
        
        // 保存剧集数据供批量下载使用
        currentEpisodes = sortedEpisodes;
        
        document.getElementById('episodeCount').textContent = `(${sortedEpisodes.length}集)`;
        
        // 显示批量操作工具栏
        batchActions.classList.remove('hidden');
        updateSelectedCount();
        
        // 转义HTML，防止XSS
        const escapeHtml = (text) => {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        };
        
        episodesGrid.innerHTML = sortedEpisodes.map((episode, index) => {
            const statusText = episode.status === 1 ? '已上架' : '已下架';
            const statusClass = episode.status === 1 ? 'online' : 'offline';
            const episodeTitle = escapeHtml(episode.title || '未知标题');
            const episodeUrl = escapeHtml(episode.url || '');
            const episodeId = escapeHtml(episode.episodeId || '');
            const downloadTitle = escapeHtml(episode.title || `第${episode.order || '?'}集`);
            const hasUrl = episode.url && episode.status === 1;
            
            return `
                <div class="episode-card" style="animation-delay: ${index * 0.05}s" data-episode-index="${index}">
                    <div class="episode-checkbox-wrapper">
                        <label class="episode-checkbox-label">
                            <input type="checkbox" class="episode-checkbox" data-episode-index="${index}" ${hasUrl ? '' : 'disabled'}>
                            <span class="checkbox-custom"></span>
                        </label>
                    </div>
                    <div class="episode-content">
                        <div class="episode-header">
                            <span class="episode-order">第${episode.order || '?'}集</span>
                            <span class="status-badge ${statusClass}" style="font-size: 11px; padding: 4px 8px;">${statusText}</span>
                        </div>
                        <div class="episode-title">${episodeTitle}</div>
                        ${hasUrl ? `
                            <div class="episode-actions">
                                <button class="btn-small copy-link-btn" data-url="${episodeUrl}">复制视频链接</button>
                                <button class="btn-small download-btn" data-url="${episodeUrl}" data-title="${downloadTitle}">下载视频</button>
                                <a href="${episodeUrl}" target="_blank" class="btn-small" style="text-decoration: none;">打开视频</a>
                            </div>
                        ` : '<div class="episode-actions"><span style="color: var(--text-tertiary); font-size: 12px;">该剧集已下架</span></div>'}
                    </div>
                </div>
            `;
        }).join('');
        
        // 绑定事件委托
        bindEpisodeEvents();
        
        // 绑定复选框事件
        bindCheckboxEvents();
    } else {
        document.getElementById('episodeCount').textContent = '(0集)';
        episodesGrid.innerHTML = '<p style="color: var(--text-tertiary); text-align: center; padding: 20px;">暂无剧集信息</p>';
        batchActions.classList.add('hidden');
        currentEpisodes = [];
    }
    
    // 显示结果区域，添加滚动动画
    result.classList.remove('hidden');
    result.style.opacity = '0';
    setTimeout(() => {
        result.style.transition = 'opacity 0.5s';
        result.style.opacity = '1';
        // 平滑滚动到结果区域
        result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
}

// 复制简介内容
function copyIntroduction(event) {
    const introductionEl = document.getElementById('introduction');
    if (!introductionEl) {
        showToast('简介元素未找到');
        return;
    }
    
    const introText = introductionEl.textContent.trim();
    
    if (!introText || introText === '暂无简介') {
        showToast('没有可复制的简介内容');
        return;
    }
    
    // 获取按钮元素用于视觉反馈
    let btn = null;
    if (event && event.target) {
        btn = event.target.closest('.btn-copy-intro');
    }
    if (!btn) {
        btn = document.querySelector('.btn-copy-intro');
    }
    
    const originalHtml = btn ? btn.innerHTML : null;
    
    // 使用现代剪贴板API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(introText).then(() => {
            showToast('简介已复制到剪贴板');
            
            // 添加复制成功的视觉反馈
            if (btn) {
                btn.innerHTML = '<span>✓</span><span>已复制</span>';
                btn.style.background = 'var(--accent-black)';
                btn.style.color = 'var(--bg-primary)';
                btn.style.borderColor = 'var(--accent-black)';
                
                setTimeout(() => {
                    if (btn && originalHtml) {
                        btn.innerHTML = originalHtml;
                        btn.style.background = '';
                        btn.style.color = '';
                        btn.style.borderColor = '';
                    }
                }, 2000);
            }
        }).catch(err => {
            console.error('复制失败:', err);
            fallbackCopy(introText, btn, originalHtml);
        });
    } else {
        // 降级方案
        fallbackCopy(introText, btn, originalHtml);
    }
}

// 降级复制方案
function fallbackCopy(text, btn, originalHtml) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast('简介已复制到剪贴板');
            if (btn && originalHtml) {
                btn.innerHTML = '<span>✓</span><span>已复制</span>';
                btn.style.background = 'var(--accent-black)';
                btn.style.color = 'var(--bg-primary)';
                setTimeout(() => {
                    btn.innerHTML = originalHtml;
                    btn.style.background = '';
                    btn.style.color = '';
                }, 2000);
            }
        } else {
            showToast('复制失败，请手动选择文本复制');
        }
    } catch (e) {
        console.error('降级复制也失败:', e);
        showToast('复制失败，请手动选择文本复制');
    }
    
    document.body.removeChild(textArea);
}

// 复制到剪贴板
function copyToClipboard(elementIdOrText) {
    let text = elementIdOrText;
    
    // 如果是元素ID，获取元素的data-url属性或href属性
    if (elementIdOrText === 'coverUrl') {
        const coverImg = document.getElementById('coverImg');
        if (coverImg) {
            text = coverImg.getAttribute('data-url') || coverImg.src;
        } else {
            showToast('封面图片未找到');
            return;
        }
    }
    
    if (!text || text.startsWith('data:')) {
        showToast('没有可复制的内容');
        return;
    }
    
    // 使用现代剪贴板API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('已复制到剪贴板');
        }).catch(err => {
            console.error('复制失败:', err);
            fallbackCopyText(text);
        });
    } else {
        // 降级方案
        fallbackCopyText(text);
    }
}

// 降级复制文本方案
function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast('已复制到剪贴板');
        } else {
            showToast('复制失败，请手动复制');
        }
    } catch (e) {
        console.error('降级复制失败:', e);
        showToast('复制失败，请手动复制');
    }
    
    document.body.removeChild(textArea);
}

// 下载封面
async function downloadCover() {
    const coverImg = document.getElementById('coverImg');
    if (!coverImg) {
        showToast('封面图片未找到');
        return;
    }
    
    const coverUrl = coverImg.getAttribute('data-url') || coverImg.src;
    
    if (!coverUrl || coverUrl.startsWith('data:')) {
        showToast('没有可下载的封面');
        return;
    }
    
    try {
        showToast('正在下载封面...');
        
        // 使用服务器代理下载封面
        const playletName = document.getElementById('playletName')?.textContent || '短剧封面';
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: coverUrl,
                filename: `${playletName}_封面.jpg`
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.msg || `下载失败: HTTP ${response.status}`);
        }
        
        // 创建下载链接
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${playletName}_封面.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showToast('封面下载成功');
        
    } catch (err) {
        console.error('下载封面失败:', err);
        showToast(`封面下载失败: ${err.message}`);
        
        // 降级方案：尝试直接下载
        try {
            const response = await fetch(coverUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const playletName = document.getElementById('playletName')?.textContent || '短剧封面';
            a.download = `${playletName}_封面.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showToast('封面下载成功');
        } catch (directErr) {
            console.error('直接下载封面也失败:', directErr);
            showToast('下载失败，请尝试右键保存图片');
        }
    }
}

// 绑定剧集相关事件
function bindEpisodeEvents() {
    const episodesGrid = document.getElementById('episodesGrid');
    
    // 移除之前的事件监听器
    episodesGrid.removeEventListener('click', handleEpisodeClick);
    
    // 添加事件委托
    episodesGrid.addEventListener('click', handleEpisodeClick);
}

// 处理剧集相关的点击事件
function handleEpisodeClick(event) {
    const target = event.target;
    
    // 处理下载按钮
    if (target.classList.contains('download-btn')) {
        event.preventDefault();
        const url = target.getAttribute('data-url');
        const title = target.getAttribute('data-title');
        
        console.log('下载按钮被点击:', title, url);
        
        if (!url) {
            showToast('没有可下载的视频');
            return;
        }
        
        downloadVideo(url, title);
        return;
    }
    
    // 处理复制链接按钮
    if (target.classList.contains('copy-link-btn')) {
        event.preventDefault();
        const url = target.getAttribute('data-url');
        
        if (!url) {
            showToast('没有可复制的内容');
            return;
        }
        
        copyToClipboard(url);
        return;
    }
}

// 处理下载按钮点击（保留作为备用）
function handleDownloadClick(button) {
    const url = button.getAttribute('data-url');
    const title = button.getAttribute('data-title');
    
    if (!url) {
        showToast('没有可下载的视频');
        return;
    }
    
    console.log('开始下载:', title, url);
    downloadVideo(url, title);
}

// 下载视频（带进度显示和重试机制）
async function downloadVideo(videoUrl, episodeTitle) {
    console.log('downloadVideo 被调用:', videoUrl, episodeTitle);
    
    if (!videoUrl) {
        showToast('没有可下载的视频');
        return;
    }
    
    // 检查是否在Electron环境中
    console.log('检查Electron环境:', window.electronAPI);
    if (window.electronAPI && typeof window.electronAPI.isElectron === 'function' && window.electronAPI.isElectron()) {
        console.log('使用Electron下载');
        return downloadVideoElectron(videoUrl, episodeTitle);
    }
    
    console.log('使用服务器代理下载');
    
    try {
        showToast('正在准备下载视频...');
        
        // 使用服务器代理下载，避免CORS问题
        const episodeNumber = episodeTitle.match(/第(\d+)集/) ? episodeTitle.match(/第(\d+)集/)[1] : 
                             episodeTitle.match(/(\d+)/) ? episodeTitle.match(/(\d+)/)[1] : '?';
        
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: videoUrl,
                filename: `第${episodeNumber}集.mp4`
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.msg || `下载失败: HTTP ${response.status}`);
        }
        
        // 获取文件名
        const contentDisposition = response.headers.get('content-disposition');
        let filename = `${episodeTitle}.mp4`;
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch) {
                filename = decodeURIComponent(filenameMatch[1].replace(/['"]/g, ''));
            }
        }
        
        // 创建下载链接
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showToast('视频下载成功');
        
    } catch (err) {
        console.error('下载视频失败:', err);
        showToast(`下载失败: ${err.message}`);
        
        // 如果代理下载失败，尝试直接打开视频链接
        console.log('尝试直接打开视频链接');
        try {
            // 创建一个隐藏的iframe来尝试下载
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = videoUrl;
            document.body.appendChild(iframe);
            
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 5000);
            
            showToast('已尝试直接下载，如果失败请右键保存视频');
        } catch (iframeErr) {
            console.error('iframe下载也失败:', iframeErr);
            // 最后的备选方案：打开新窗口
            window.open(videoUrl, '_blank');
            showToast('已在新窗口打开视频，请右键保存');
        }
    }
}

// Electron环境下的下载函数
async function downloadVideoElectron(videoUrl, episodeTitle) {
    try {
        showToast('正在准备下载视频...');
        
        // 从URL中提取文件扩展名
        const urlPath = new URL(videoUrl).pathname;
        const ext = urlPath.match(/\.([^.]+)$/)?.[1] || 'mp4';
        const filename = `${episodeTitle}.${ext}`;
        
        // 显示下载进度
        const progressToast = document.createElement('div');
        progressToast.className = 'toast';
        progressToast.id = 'downloadProgress';
        progressToast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="spinner" style="width: 20px; height: 20px; border-width: 2px; margin: 0;"></div>
                <div>
                    <div style="font-weight: 600;">下载中: 0%</div>
                    <div style="font-size: 13px; opacity: 0.8; margin-top: 4px;">${episodeTitle}</div>
                </div>
            </div>
        `;
        document.body.appendChild(progressToast);
        
        // 监听下载进度
        window.electronAPI.onDownloadProgress((data) => {
            if (data.filename === filename) {
                const progressEl = progressToast.querySelector('div > div:first-child');
                if (progressEl) {
                    progressEl.textContent = `下载中: ${data.progress}%`;
                }
            }
        });
        
        // 开始下载
        const result = await window.electronAPI.downloadFile(videoUrl, filename);
        
        // 移除进度监听
        window.electronAPI.removeAllListeners('download-progress');
        
        // 移除进度提示
        const progressEl = document.getElementById('downloadProgress');
        if (progressEl) {
            if (result.success) {
                progressEl.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="color: #4CAF50; font-size: 20px;">✓</div>
                        <div>
                            <div style="font-weight: 600;">下载完成！</div>
                            <div style="font-size: 13px; opacity: 0.8; margin-top: 4px;">${episodeTitle}</div>
                        </div>
                    </div>
                `;
                showToast('视频下载成功，已保存到下载文件夹');
            } else {
                progressEl.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="color: #f44336; font-size: 20px;">✗</div>
                        <div>
                            <div style="font-weight: 600;">下载失败</div>
                            <div style="font-size: 13px; opacity: 0.8; margin-top: 4px;">请重试</div>
                        </div>
                    </div>
                `;
                showToast('下载失败，请重试');
            }
            
            setTimeout(() => {
                if (progressEl.parentNode) {
                    progressEl.parentNode.removeChild(progressEl);
                }
            }, 2000);
        }
        
    } catch (err) {
        console.error('Electron下载失败:', err);
        showToast(`下载失败: ${err.message}`);
        
        // 移除进度提示
        const progressEl = document.getElementById('downloadProgress');
        if (progressEl && progressEl.parentNode) {
            progressEl.parentNode.removeChild(progressEl);
        }
    }
}

// 显示提示消息
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s reverse';
        setTimeout(() => {
            if (toast.parentNode) {
                document.body.removeChild(toast);
            }
        }, 300);
    }, 2000);
}

// 绑定事件
searchBtn.addEventListener('click', queryPlaylet);

playletIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        queryPlaylet();
    }
});

// 绑定复选框事件
function bindCheckboxEvents() {
    // 单个复选框事件
    const checkboxes = document.querySelectorAll('.episode-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            updateSelectedCount();
            updateSelectAllState();
        });
    });
    
    // 全选复选框事件
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            checkboxes.forEach(cb => {
                if (!cb.disabled) {
                    cb.checked = isChecked;
                }
            });
            updateSelectedCount();
        });
    }
}

// 更新选中数量
function updateSelectedCount() {
    const checkedBoxes = document.querySelectorAll('.episode-checkbox:checked:not(:disabled)');
    const count = checkedBoxes.length;
    selectedCountSpan.textContent = `(${count})`;
    
    // 更新批量下载按钮状态
    const batchDownloadBtn = document.getElementById('batchDownloadBtn');
    if (batchDownloadBtn) {
        if (count > 0) {
            batchDownloadBtn.disabled = false;
            batchDownloadBtn.style.opacity = '1';
        } else {
            batchDownloadBtn.disabled = true;
            batchDownloadBtn.style.opacity = '0.5';
        }
    }
}

// 更新全选状态
function updateSelectAllState() {
    const checkboxes = document.querySelectorAll('.episode-checkbox:not(:disabled)');
    const checkedBoxes = document.querySelectorAll('.episode-checkbox:checked:not(:disabled)');
    
    if (checkboxes.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }
    
    if (checkedBoxes.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedBoxes.length === checkboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// 并发控制的下载队列
class DownloadQueue {
    constructor(maxConcurrent = CONFIG.maxConcurrentDownloads) {
        this.maxConcurrent = maxConcurrent;
        this.running = 0;
        this.queue = [];
    }
    
    async add(downloadTask) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task: downloadTask, resolve, reject });
            this.process();
        });
    }
    
    async process() {
        if (this.running >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }
        
        this.running++;
        const { task, resolve, reject } = this.queue.shift();
        
        try {
            const result = await task();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.running--;
            this.process();
        }
    }
}

// 批量下载（优化版）
async function batchDownload() {
    const checkedBoxes = document.querySelectorAll('.episode-checkbox:checked:not(:disabled)');
    
    if (checkedBoxes.length === 0) {
        showToast('请先选择要下载的剧集');
        return;
    }
    
    // 获取选中的剧集数据
    const selectedEpisodes = Array.from(checkedBoxes).map(cb => {
        const index = parseInt(cb.dataset.episodeIndex);
        return currentEpisodes[index];
    }).filter(ep => ep && ep.url && ep.status === 1);
    
    if (selectedEpisodes.length === 0) {
        showToast('没有可下载的剧集');
        return;
    }
    
    // 检查是否在Electron环境中
    if (window.electronAPI && window.electronAPI.isElectron()) {
        return batchDownloadElectron(selectedEpisodes);
    }
    
    // 原有的浏览器批量下载逻辑
    // 检查JSZip是否加载
    if (typeof JSZip === 'undefined') {
        console.error('JSZip库未加载');
        showToast('正在加载必要组件，请稍后重试...');
        
        // 尝试重新加载JSZip
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => {
            showToast('组件加载完成，请重新尝试批量下载');
        };
        script.onerror = () => {
            showToast('组件加载失败，请刷新页面重试');
        };
        document.head.appendChild(script);
        return;
    }
    
    try {
        // 显示下载进度
        const progressToast = document.createElement('div');
        progressToast.className = 'toast';
        progressToast.id = 'batchDownloadProgress';
        progressToast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="spinner" style="width: 20px; height: 20px; border-width: 2px; margin: 0;"></div>
                <div>
                    <div style="font-weight: 600;">正在批量下载...</div>
                    <div style="font-size: 13px; opacity: 0.8; margin-top: 4px;">0/${selectedEpisodes.length} (准备中)</div>
                </div>
            </div>
        `;
        document.body.appendChild(progressToast);
        
        const zip = new JSZip();
        let completed = 0;
        let failed = 0;
        const downloadQueue = new DownloadQueue();
        
        // 更新进度显示
        const updateProgress = (status = '') => {
            const progressEl = document.getElementById('batchDownloadProgress');
            if (progressEl) {
                const statusText = status || `${completed}/${selectedEpisodes.length}`;
                progressEl.querySelector('div > div:last-child').textContent = statusText;
            }
        };
        
        // 创建下载任务
        const downloadPromises = selectedEpisodes.map((episode, index) => {
            return downloadQueue.add(async () => {
                try {
                    updateProgress(`下载中: ${episode.title || `第${episode.order}集`}`);
                    
                    // 使用服务器代理下载
                    const response = await fetch('/api/download', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            url: episode.url,
                            filename: `第${String(episode.order || index + 1).padStart(2, '0')}集.mp4`
                        })
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.msg || `HTTP ${response.status}: ${response.statusText}`);
                    }
                    
                    const blob = await response.blob();
                    
                    // 从URL获取文件扩展名
                    const urlPath = new URL(episode.url).pathname;
                    const ext = urlPath.match(/\.([^.]+)$/)?.[1] || 'mp4';
                    const fileName = `第${String(episode.order || index + 1).padStart(2, '0')}集.${ext}`;
                    
                    zip.file(fileName, blob);
                    
                    completed++;
                    updateProgress();
                    
                    return { success: true, fileName };
                } catch (err) {
                    console.error(`下载 ${episode.title} 失败:`, err);
                    failed++;
                    updateProgress();
                    return { success: false, fileName: episode.title || `第${episode.order}集`, error: err.message };
                }
            });
        });
        
        // 等待所有下载完成
        const results = await Promise.allSettled(downloadPromises);
        
        if (completed === 0) {
            throw new Error('所有剧集下载失败');
        }
        
        // 生成zip文件
        updateProgress('正在打包文件...');
        const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
            const percent = Math.round((metadata.percent || 0));
            updateProgress(`打包中: ${percent}%`);
        });
        
        // 下载zip文件
        const playletName = document.getElementById('playletName').textContent || '短剧';
        const url = window.URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${playletName}_${completed}集.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        // 移除进度提示
        const progressEl = document.getElementById('batchDownloadProgress');
        if (progressEl) {
            const successMsg = failed > 0 
                ? `✅ 打包完成！成功: ${completed}个，失败: ${failed}个`
                : `✅ 打包下载完成！共 ${completed} 个剧集`;
            progressEl.innerHTML = successMsg;
            setTimeout(() => {
                if (progressEl.parentNode) {
                    progressEl.parentNode.removeChild(progressEl);
                }
            }, 3000);
        }
        
        const successMsg = failed > 0 
            ? `批量下载完成：成功 ${completed} 个，失败 ${failed} 个`
            : `成功下载 ${completed} 个剧集`;
        showToast(successMsg);
        
        // 清空选择
        checkedBoxes.forEach(cb => cb.checked = false);
        selectAllCheckbox.checked = false;
        updateSelectedCount();
        
    } catch (err) {
        console.error('批量下载失败:', err);
        showToast('批量下载失败：' + err.message);
        
        const progressEl = document.getElementById('batchDownloadProgress');
        if (progressEl) {
            progressEl.innerHTML = '❌ 批量下载失败';
            setTimeout(() => {
                if (progressEl.parentNode) {
                    progressEl.parentNode.removeChild(progressEl);
                }
            }, 3000);
        }
    }
}

// Electron环境下的批量下载函数
async function batchDownloadElectron(selectedEpisodes) {
    try {
        // 显示下载进度
        const progressToast = document.createElement('div');
        progressToast.className = 'toast';
        progressToast.id = 'batchDownloadProgress';
        progressToast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div class="spinner" style="width: 20px; height: 20px; border-width: 2px; margin: 0;"></div>
                <div>
                    <div style="font-weight: 600;">正在批量下载...</div>
                    <div style="font-size: 13px; opacity: 0.8; margin-top: 4px;">0/${selectedEpisodes.length} (准备中)</div>
                </div>
            </div>
        `;
        document.body.appendChild(progressToast);
        
        // 准备下载列表
        const downloads = selectedEpisodes.map((episode, index) => {
            const urlPath = new URL(episode.url).pathname;
            const ext = urlPath.match(/\.([^.]+)$/)?.[1] || 'mp4';
            const filename = `${String(episode.order || index + 1).padStart(2, '0')}_${episode.title || `第${episode.order || index + 1}集`}.${ext}`;
            
            return {
                url: episode.url,
                filename: filename
            };
        });
        
        // 监听批量下载进度
        window.electronAPI.onBatchDownloadProgress((data) => {
            const progressEl = document.getElementById('batchDownloadProgress');
            if (progressEl) {
                progressEl.querySelector('div > div:last-child').textContent = 
                    `${data.completed}/${data.total} - ${data.current}`;
            }
        });
        
        // 开始批量下载
        const results = await window.electronAPI.batchDownload(downloads);
        
        // 移除进度监听
        window.electronAPI.removeAllListeners('batch-download-progress');
        
        // 统计结果
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        // 移除进度提示
        const progressEl = document.getElementById('batchDownloadProgress');
        if (progressEl) {
            const successMsg = failed > 0 
                ? `✅ 批量下载完成！成功: ${successful}个，失败: ${failed}个`
                : `✅ 批量下载完成！共 ${successful} 个剧集`;
            progressEl.innerHTML = successMsg;
            setTimeout(() => {
                if (progressEl.parentNode) {
                    progressEl.parentNode.removeChild(progressEl);
                }
            }, 3000);
        }
        
        const successMsg = failed > 0 
            ? `批量下载完成：成功 ${successful} 个，失败 ${failed} 个`
            : `成功下载 ${successful} 个剧集，已保存到下载文件夹`;
        showToast(successMsg);
        
        // 清空选择
        const checkedBoxes = document.querySelectorAll('.episode-checkbox:checked:not(:disabled)');
        checkedBoxes.forEach(cb => cb.checked = false);
        selectAllCheckbox.checked = false;
        updateSelectedCount();
        
        // 提示打开下载文件夹
        setTimeout(() => {
            if (confirm('下载完成！是否打开下载文件夹查看文件？')) {
                window.electronAPI.openDownloadsFolder();
            }
        }, 1000);
        
    } catch (err) {
        console.error('Electron批量下载失败:', err);
        showToast(`批量下载失败: ${err.message}`);
        
        // 移除进度提示
        const progressEl = document.getElementById('batchDownloadProgress');
        if (progressEl && progressEl.parentNode) {
            progressEl.parentNode.removeChild(progressEl);
        }
    }
}

// 页面加载完成后聚焦输入框
window.addEventListener('load', () => {
    playletIdInput.focus();
    
    // 检查JSZip是否加载
    console.log('JSZip加载状态:', typeof JSZip !== 'undefined' ? '✅ 已加载' : '❌ 未加载');
    if (typeof JSZip === 'undefined') {
        console.warn('JSZip未加载，批量下载功能可能不可用');
    }
});

