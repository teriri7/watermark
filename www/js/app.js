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
        brand: 'canon',
        rawMake: 'Canon',
        model: 'R6 Mark II',
        rawModel: 'Canon EOS R6m2',
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
        return false;
    }
    
    console.log('[保存] Capacitor 已加载:', {
        isNativePlatform: window.Capacitor.isNativePlatform?.(),
        platform: window.Capacitor.getPlatform?.(),
        Plugins: !!window.Capacitor.Plugins
    });
    
    // 检查 Filesystem 插件
    const Filesystem = window.Capacitor?.Plugins?.Filesystem;
    if (!Filesystem) {
        console.error('[保存] Filesystem 插件未找到！请确保已执行 npx cap sync');
        alert('保存失败：Filesystem 插件未加载\n请联系开发者检查 Capacitor 配置');
        return false;
    }
    
    console.log('[保存] Filesystem 插件已加载');
    
    try {
        const base64 = await blobToBase64(blob);
        console.log('[保存] Base64 转换完成，长度:', base64.length);
        
        // 修复关键点：
        // 1) Directory.ExternalStorage 在 Android 10+ 需要 WRITE_EXTERNAL_STORAGE 权限
        //    且在 Android 11+ 的 scoped storage 下可能完全不可用
        // 2) Directory.Documents 是应用专属目录，无需权限，推荐使用
        // 3) 尝试多个目录，按优先级回退
        
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
                
                // 成功后给用户明确提示
                const uri = result?.uri || '';
                let msg = `✓ 图片已保存\n\n`;
                
                if (uri) {
                    msg += `路径: ${uri}\n\n`;
                } else {
                    msg += `目录: ${strategy.name}\n`;
                    msg += `文件: ${strategy.path}\n\n`;
                }
                
                if (strategy.name === 'Cache') {
                    msg += `注意：保存在缓存目录，可能会被系统清理。\n建议使用文件管理器移动到相册。`;
                } else {
                    msg += `请在文件管理器的 "${strategy.name}/CameraWatermark" 目录查看。`;
                }
                
                alert(msg);
                return true;
                
            } catch (e) {
                console.warn(`[保存] 策略 ${strategy.name} 失败:`, e);
                lastError = e;
                // 继续尝试下一个策略
            }
        }
        
        // 所有策略都失败
        console.error('[保存] 所有保存策略都失败了，最后错误:', lastError);
        alert(`保存失败\n\n错误: ${lastError?.message || lastError}\n\n建议：\n1. 检查存储空间是否充足\n2. 尝试重启应用\n3. 使用截图功能保存预览图`);
        return false;
        
    } catch (e) {
        console.error('[保存] 保存过程异常:', e);
        alert(`保存失败：${e?.message || e}`);
        return false;
    }
}

downloadBtn.addEventListener('click', async () => {
    if (!latestBlob) {
        alert('请先上传图片');
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
        const ok = await saveToAndroid(latestBlob, filename);
        if (ok) return;
    }

    // 浏览器：触发下载
    const a = document.createElement('a');
    const url = URL.createObjectURL(latestBlob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// 初始化：默认展示首页
showHome();
