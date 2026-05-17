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
        try {
            currentExif = await readExif(file);
        } catch (e) {
            console.error('EXIF 读取失败', e);
            currentExif = null;
        }
    }

    const selectedMode = document.querySelector('input[name="displayMode"]:checked');
    const displayMode = selectedMode ? selectedMode.value : 'nickname';
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
    // 通过 Capacitor 提供的 Filesystem 把图片写到外部下载目录
    if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.Filesystem) {
        return false;
    }
    try {
        const { Filesystem, Directory } = window.Capacitor.Plugins;
        const base64 = await blobToBase64(blob);
        const result = await Filesystem.writeFile({
            path: `Pictures/CameraWatermark/${filename}`,
            data: base64,
            directory: Directory.ExternalStorage,
            recursive: true
        });
        alert('已保存到：' + (result?.uri || `Pictures/CameraWatermark/${filename}`));
        return true;
    } catch (e) {
        console.warn('Capacitor 保存失败', e);
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
