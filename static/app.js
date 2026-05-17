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
// 当前选择的水印样式: style1 / style2
let currentStyle = 'style1';

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
    
    // 样式三不需要昵称和镜头型号选项，隐藏整个控件组
    const controlsDiv = document.querySelector('.controls');
    const inputGroups = controlsDiv ? controlsDiv.querySelectorAll('.input-group') : [];
    
    if (currentStyle === 'style3') {
        // 隐藏第二个 input-group（包含模式切换和昵称输入）
        if (inputGroups[1]) {
            inputGroups[1].style.display = 'none';
        }
    } else {
        // 恢复显示第二个 input-group
        if (inputGroups[1]) {
            inputGroups[1].style.display = '';
        }
        // 根据当前选择的模式决定是否显示昵称输入框
        const selectedMode = document.querySelector('input[name="displayMode"]:checked');
        if (selectedMode && selectedMode.value === 'nickname') {
            if (nicknameInput) nicknameInput.style.display = '';
        }
    }
}

function resetEditor() {
    // 清空已选图片与预览，回到初始态
    imageInput.value = '';
    latestBlob = null;
    originalFileName = 'image';
    fileLabel.textContent = '选择图片';
    preview.src = '';
    preview.style.display = 'none';
    preview.classList.remove('loaded');
    preview.style.opacity = '';
    placeholder.style.display = '';
    downloadBtn.classList.add('hidden');
}

// 首页样式卡点击 -> 进入编辑页
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
// 处理图片
// =====================================================
async function processImage() {
    const file = imageInput.files[0];

    if (!file) {
        return;
    }

    // 更新文件选择按钮的文字
    fileLabel.textContent = '已选择: ' + file.name;

    originalFileName = file.name;

    const selectedMode = document.querySelector('input[name="displayMode"]:checked');
    const displayMode = selectedMode ? selectedMode.value : 'nickname';

    const formData = new FormData();
    formData.append('image', file);
    formData.append('display_mode', displayMode);
    formData.append('nickname', nicknameInput.value || '所有二刺螈都得死');
    formData.append('watermark_style', currentStyle);

    // 添加加载状态
    preview.style.opacity = '0.5';
    
    try {
        const response = await fetch('/process', {
            method: 'POST',
            body: formData
        });

        const blob = await response.blob();
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
        alert('处理图片失败，请重试');
        preview.style.opacity = '1';
    }
}

imageInput.addEventListener('change', processImage);

// 防抖处理输入
let timeoutId;
nicknameInput.addEventListener('input', () => {
    if (imageInput.files[0]) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            processImage();
        }, 500);
    }
});

// 切换显示模式 (昵称 / 镜头型号)
const modeRadios = document.querySelectorAll('input[name="displayMode"]');
modeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
        // 仅在选择"昵称"时显示输入框
        if (radio.checked && radio.value === 'nickname') {
            nicknameInput.style.display = '';
        } else if (radio.checked && radio.value === 'lens') {
            nicknameInput.style.display = 'none';
        }

        // 切换后立刻重新生成图片
        if (imageInput.files[0]) {
            processImage();
        }
    });
});

downloadBtn.addEventListener('click', () => {
    if (!latestBlob) {
        alert('请先上传图片');
        return;
    }

    // 添加点击动效
    downloadBtn.style.transform = 'scale(0.95)';
    setTimeout(() => {
        downloadBtn.style.transform = '';
    }, 150);

    const a = document.createElement('a');
    const url = URL.createObjectURL(latestBlob);
    
    // 从响应的 blob 类型获取正确的扩展名
    let ext = 'jpg';
    if (latestBlob.type === 'image/png') {
        ext = 'png';
    } else if (latestBlob.type === 'image/webp') {
        ext = 'webp';
    }

    const parts = originalFileName.split('.');
    parts.pop(); // 移除原扩展名
    const base = parts.join('.');

    a.href = url;
    a.download = `${base}_watermark.${ext}`;

    document.body.appendChild(a);
    a.click();
    a.remove();
});

// 初始化：默认展示首页
showHome();
