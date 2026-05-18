/**
 * 应用主逻辑
 * 处理 UI 交互和图片水印生成
 */

import { processWatermark, canvasToBlob } from './watermark.js';
import { readExif } from './exif-reader.js';

// =====================================================
// 页面元素
// =====================================================
const homePage = document.getElementById('homePage');
const editorPage = document.getElementById('editorPage');
const backBtn = document.getElementById('backBtn');
const styleCards = document.querySelectorAll('.style-card');

const imageInput = document.getElementById('imageInput');
const nicknameInput = document.getElementById('nickname');
const preview = document.getElementById('preview');
const downloadBtn = document.getElementById('downloadBtn');
const fileLabel = document.querySelector('.file-label');
const placeholder = document.getElementById('placeholder');

// =====================================================
// 状态
// =====================================================
let latestBlob = null;
let originalFileName = 'image';
let currentStyle = 'style1';
let currentFile = null;
let currentExif = null;

// =====================================================
// 页面切换
// =====================================================
function showHome() {
    homePage.classList.remove('hidden');
    editorPage.classList.add('hidden');
    backBtn.classList.add('hidden');
}

function showEditor(style) {
    currentStyle = style || 'style1';
    homePage.classList.add('hidden');
    editorPage.classList.remove('hidden');
    backBtn.classList.remove('hidden');

    const controlsDiv = document.querySelector('.controls');
    const inputGroups = controlsDiv ? controlsDiv.querySelectorAll('.input-group') : [];

    if (currentStyle === 'style3') {
        if (inputGroups[1]) inputGroups[1].style.display = 'none';
    } else {
        if (inputGroups[1]) inputGroups[1].style.display = '';
        const selectedMode = document.querySelector('input[name="displayMode"]:checked');
        if (selectedMode && selectedMode.value === 'nickname') {
            if (nicknameInput) nicknameInput.style.display = '';
        } else {
            if (nicknameInput) nicknameInput.style.display = 'none';
        }
    }
}

function resetEditor() {
    imageInput.value = '';
    latestBlob = null;
    currentFile = null;
    currentExif = null;
    originalFileName = 'image';
    fileLabel.textContent = '选择图片';
    preview.src = '';
    preview.style.display = 'none';
    preview.classList.remove('loaded');
    preview.style.opacity = '';
    placeholder.style.display = '';
    downloadBtn.classList.add('hidden');
}

// 首页样式卡 -> 进入编辑页
styleCards.forEach((card) => {
    card.addEventListener('click', () => {
        const style = card.getAttribute('data-style') || 'style1';
        resetEditor();
        showEditor(style);
    });
});

// 返回按钮 -> 回到首页
backBtn.addEventListener('click', () => {
    resetEditor();
    showHome();
});

// =====================================================
// 限制 nickname 长度（中文 2，英文 1，最多 20）
// =====================================================
function truncateNickname(nickname) {
    let len = 0;
    let result = '';
    for (const c of nickname) {
        if (
            (c >= '\u4e00' && c <= '\u9fff') ||
            (c >= '\uff00' && c <= '\uffef') ||
            (c >= '\u3000' && c <= '\u303f')
        ) {
            len += 2;
        } else {
            len += 1;
        }
        if (len > 20) break;
        result += c;
    }
    return result;
}

// =====================================================
// 兜底 EXIF（保证 processWatermark 不会拿到 null）
// =====================================================
function getDefaultExif() {
    const now = new Date();
    const datetime = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return {
        brand: null,
        rawMake: '',
        model: 'Unknown',
        focal: '35',
        fnumber: '1.4',
        exposure: '1/100',
        iso: '100',
        datetime,
        lens: 'Lens',
        orientation: 1
    };
}

// =====================================================
// 处理图片
// =====================================================
async function processImage() {
    const file = imageInput.files[0];
    if (!file) return;

    fileLabel.textContent = '已选择: ' + file.name;
    originalFileName = file.name;

    // 缓存文件和 EXIF（避免重复读取）
    if (currentFile !== file) {
        currentFile = file;
        console.log('[App] 开始处理新文件:', file.name, file.type, file.size);
        try {
            currentExif = await readExif(file);
            console.log('[App] EXIF 读取完成:', currentExif);
        } catch (e) {
            console.error('[App] EXIF 读取异常', e);
            currentExif = getDefaultExif();
        }
        if (!currentExif) currentExif = getDefaultExif();
    }

    const selectedMode = document.querySelector('input[name="displayMode"]:checked');
    const displayMode = selectedMode ? selectedMode.value : 'lens';
    const nickname = truncateNickname(nicknameInput.value || '所有二刺螈都得死');

    preview.style.opacity = '0.5';

    try {
        const canvas = await processWatermark(
            file,
            currentExif,
            displayMode,
            nickname,
            currentStyle
        );

        // 选择输出格式：保持原扩展名（jpg/png/webp）
        let mime = 'image/jpeg';
        const lower = (file.name || '').toLowerCase();
        if (lower.endsWith('.png')) mime = 'image/png';
        else if (lower.endsWith('.webp')) mime = 'image/webp';

        const blob = await canvasToBlob(canvas, mime, 0.95);
        latestBlob = blob;

        const url = URL.createObjectURL(blob);
        preview.onload = () => {
            preview.classList.add('loaded');
            preview.style.opacity = '1';
            placeholder.style.display = 'none';
            preview.style.display = 'block';
            downloadBtn.classList.remove('hidden');
        };
        preview.src = url;
    } catch (error) {
        console.error('处理图片失败:', error);
        alert('处理图片失败：' + (error?.message || error));
        preview.style.opacity = '1';
    }
}

imageInput.addEventListener('change', processImage);

// 防抖处理输入
let timeoutId;
nicknameInput.addEventListener('input', () => {
    if (imageInput.files[0]) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(processImage, 500);
    }
});

// 切换显示模式
const modeRadios = document.querySelectorAll('input[name="displayMode"]');
modeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
        if (radio.checked && radio.value === 'nickname') {
            nicknameInput.style.display = '';
        } else if (radio.checked && radio.value === 'lens') {
            nicknameInput.style.display = 'none';
        }
        if (imageInput.files[0]) processImage();
    });
});

// =====================================================
// 下载（兼容 Android WebView，借助 Capacitor Filesystem）
// =====================================================
async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result;
            // result: "data:xxx;base64,xxxxx"
            const base64 = String(result).split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function saveToAndroid(blob, filename) {
    console.log('[保存] 开始 Android 保存流程，文件名:', filename, '大小:', blob.size);
    
    // 检查 Capacitor 环境
    if (!window.Capacitor) {
        console.warn('[保存] window.Capacitor 不存在');
        return { success: false, message: 'Capacitor 环境未加载' };
    }
    
    console.log('[保存] Capacitor 已加载:', {
        isNativePlatform: window.Capacitor.isNativePlatform?.(),
        platform: window.Capacitor.getPlatform?.(),
        Plugins: !!window.Capacitor.Plugins
    });
    
    // 检查 Filesystem 插件
    const Filesystem = window.Capacitor?.Plugins?.Filesystem;
    if (!Filesystem) {
        console.error('[保存] Filesystem 插件未找到！');
        return { success: false, message: 'Filesystem 插件未加载' };
    }
    
    console.log('[保存] Filesystem 插件已加载');
    
    try {
        const base64 = await blobToBase64(blob);
        console.log('[保存] Base64 转换完成，长度:', base64.length);
        
        const strategies = [
            {
                name: 'Documents',
                dir: 'DOCUMENTS',
                path: `CameraWatermark/${filename}`
            },
            {
                name: 'Data',
                dir: 'DATA',
                path: `CameraWatermark/${filename}`
            },
            {
                name: 'Cache',
                dir: 'CACHE',
                path: filename
            }
        ];
        
        let lastError = null;
        
        for (const strategy of strategies) {
            try {
                console.log(`[保存] 尝试策略: ${strategy.name}, 目录: ${strategy.dir}, 路径: ${strategy.path}`);
                
                const result = await Filesystem.writeFile({
                    path: strategy.path,
                    data: base64,
                    directory: strategy.dir,
                    recursive: true
                });
                
                console.log('[保存] 保存成功！', result);
                return { success: true, message: '已保存到本地' };
                
            } catch (e) {
                console.warn(`[保存] 策略 ${strategy.name} 失败:`, e);
                lastError = e;
            }
        }
        
        // 所有策略都失败
        console.error('[保存] 所有保存策略都失败了，最后错误:', lastError);
        return { success: false, message: '保存失败，请检查存储空间' };
        
    } catch (e) {
        console.error('[保存] 保存过程异常:', e);
        return { success: false, message: `保存失败：${e?.message || '未知错误'}` };
    }
}

// =====================================================
// Toast 提示（替代 alert，无需用户交互）
// =====================================================
function showToast(message, type = 'success', duration = 2500) {
    // 移除已有的 toast，避免堆叠
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 触发入场动画
    requestAnimationFrame(() => {
        toast.classList.add('toast-show');
    });

    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

downloadBtn.addEventListener('click', async () => {
    if (!latestBlob) {
        showToast('请先上传图片', 'error');
        return;
    }

    downloadBtn.style.transform = 'scale(0.95)';
    setTimeout(() => { downloadBtn.style.transform = ''; }, 150);

    let ext = 'jpg';
    if (latestBlob.type === 'image/png') ext = 'png';
    else if (latestBlob.type === 'image/webp') ext = 'webp';

    const parts = originalFileName.split('.');
    if (parts.length > 1) parts.pop();
    const base = parts.join('.') || 'image';
    const filename = `${base}_watermark.${ext}`;

    // Android 上优先用 Capacitor 写入相册目录
    const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isCapacitor) {
        const result = await saveToAndroid(latestBlob, filename);
        if (result.success) {
            showToast(result.message, 'success');
            return;
        }
        // 保存失败时给出提示，但不再触发浏览器下载（WebView 中无效）
        showToast(result.message, 'error', 3000);
        return;
    }

    // 浏览器：触发下载
    try {
        const a = document.createElement('a');
        const url = URL.createObjectURL(latestBlob);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('已保存到本地', 'success');
    } catch (e) {
        console.error('[下载] 浏览器下载失败:', e);
        showToast('下载失败', 'error');
    }
});

// 初始化：默认展示首页
showHome();
