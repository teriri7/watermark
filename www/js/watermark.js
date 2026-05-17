/**
 * 相机水印处理核心模块
 * 将 Python PIL 图像处理逻辑转换为 Canvas API
 */

// =========================================================
// 配置参数（从 server.py 移植）
// =========================================================

const portraitConfig = {
    watermarkHeightScale: 0.11,
    sidePaddingScale: 0.04,
    lineTopScale: 0.20,
    lineBottomScale: 0.80,
    lineWidth: 10,
    logoScale: 0.5,
    brandLogoScales: { canon: 0.5, sony: 0.5, nikon: 0.65 },
    logoYOffset: 0,
    modelFontScale: 0.21,
    exifFontScale: 0.18,
    smallFontScale: 0.16,
    textToLineDistanceScale: 0.025,
    topRowYScale: 0.28,
    bottomRowYScale: 0.53,
    exifSpacing: " "
};

const landscapeConfig = {
    watermarkHeightScale: 0.13,
    sidePaddingScale: 0.03,
    lineTopScale: 0.20,
    lineBottomScale: 0.8,
    lineWidth: 10,
    logoScale: 0.56,
    brandLogoScales: { canon: 0.56, sony: 0.56, nikon: 0.56 },
    logoYOffset: 0,
    modelFontScale: 0.25,
    exifFontScale: 0.23,
    smallFontScale: 0.16,
    textToLineDistanceScale: 0.020,
    topRowYScale: 0.25,
    bottomRowYScale: 0.55,
    exifSpacing: "  "
};

const style3Config = {
    borderScale: 0.055,
    bottomExtraScale: 0.055,
    cornerRadiusScale: 0.05,
    blurRadiusScale: 0.05,
    bgZoom: 1.25,
    shadowOffsetScale: 0.015,
    shadowBlurScale: 0.03,
    shadowAlpha: 150,
    modelFontScale: 0.2,
    exifFontScale: 0.16,
    logoHeightToFont: 1.2,
    logoTextGapToFont: 0.55,
    rowGapScale: 0.15,
};

// =========================================================
// 品牌识别 / 机型简化
// =========================================================
const ROMAN_MAP = {
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
    '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X',
};

function detectBrand(make) {
    if (!make) return 'canon';
    const m = String(make).trim().toUpperCase();
    if (m.includes('CANON')) return 'canon';
    if (m.includes('SONY')) return 'sony';
    if (m.includes('NIKON')) return 'nikon';
    return 'canon';
}

function simplifyCanon(model) {
    model = model.replace(/Canon EOS /gi, '').replace(/Canon /gi, '').replace(/EOS /gi, '');
    for (let i = 10; i >= 1; i--) {
        const re = new RegExp(`m${i}$`, 'i');
        if (re.test(model)) return model.replace(re, `Mark ${ROMAN_MAP[i]}`);
    }
    return model.trim();
}

function simplifySony(model) {
    return model.replace(/^sony\s+/i, '').trim();
}

function simplifyNikon(model) {
    model = model.replace(/^nikon\s+corporation\s+/i, '').replace(/^nikon\s+/i, '');
    const match = model.match(/_(\d+)$/);
    if (match) {
        const num = match[1];
        const roman = ROMAN_MAP[num] || num;
        model = model.replace(/_\d+$/, ` Mark ${roman}`);
    }
    model = model.replace(/^([A-Za-z])\s+(\d)/, '$1$2');
    return model.trim();
}

export function simplifyCameraModel(model, brand = 'canon') {
    model = String(model).trim();
    if (brand === 'sony') return simplifySony(model);
    if (brand === 'nikon') return simplifyNikon(model);
    return simplifyCanon(model);
}

export { detectBrand };

// =========================================================
// 工具函数
// =========================================================
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

const LOGO_MAP = {
    canon: { normal: 'logo/canon.png', style3: 'logo/canon2.png' },
    sony:  { normal: 'logo/sony.png',  style3: 'logo/sony2.png'  },
    nikon: { normal: 'logo/nikon.png', style3: 'logo/nikon2.png' }
};

async function loadLogo(brand, style) {
    const paths = LOGO_MAP[brand] || LOGO_MAP.canon;
    const path = style === 'style3' ? (paths.style3 || paths.normal) : paths.normal;
    try {
        return await loadImage(path);
    } catch (e) {
        return await loadImage(LOGO_MAP.canon.normal);
    }
}

// 把 File 加载为 HTMLImageElement，并按 EXIF 方向旋正
async function loadOrientedImage(file, orientation) {
    const url = URL.createObjectURL(file);
    try {
        const img = await loadImage(url);
        if (!orientation || orientation === 1) return img;

        // 根据 orientation 物理旋转
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const swap = orientation >= 5 && orientation <= 8;
        const cw = swap ? h : w;
        const ch = swap ? w : h;

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');

        switch (orientation) {
            case 2: ctx.translate(cw, 0); ctx.scale(-1, 1); break;
            case 3: ctx.translate(cw, ch); ctx.rotate(Math.PI); break;
            case 4: ctx.translate(0, ch); ctx.scale(1, -1); break;
            case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); break;
            case 6: ctx.rotate(0.5 * Math.PI); ctx.translate(0, -ch); break;
            case 7: ctx.rotate(0.5 * Math.PI); ctx.translate(cw, -ch); ctx.scale(-1, 1); break;
            case 8: ctx.rotate(-0.5 * Math.PI); ctx.translate(-cw, 0); break;
        }
        ctx.drawImage(img, 0, 0);

        // 用旋转后的 canvas 替代 img
        const dataUrl = canvas.toDataURL('image/jpeg', 1.0);
        return await loadImage(dataUrl);
    } finally {
        URL.revokeObjectURL(url);
    }
}

function setFont(ctx, font) {
    ctx.font = font;
    ctx.textBaseline = 'top';
}

function measureWidth(ctx, text, font) {
    setFont(ctx, font);
    return ctx.measureText(text).width;
}

// roundRect 兼容：老的 Canvas 可能没有
function roundRectPath(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// =========================================================
// 样式一 / 样式二
// =========================================================
async function renderStyle1And2(img, exifInfo, displayMode, nickname, watermarkStyle) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const isPortrait = height > width;
    const config = isPortrait ? portraitConfig : landscapeConfig;

    const watermarkHeight = Math.floor(height * config.watermarkHeightScale);
    const sideBorder = watermarkStyle === 'style2' ? Math.floor(watermarkHeight * 0.5) : 0;

    const newWidth = width + sideBorder * 2;
    const newHeight = height + watermarkHeight + sideBorder;

    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, newWidth, newHeight);
    ctx.drawImage(img, sideBorder, sideBorder, width, height);

    const boldFont = `bold ${Math.floor(watermarkHeight * config.modelFontScale)}px "Helvetica Neue", Arial, sans-serif`;
    const infoFont = `${Math.floor(watermarkHeight * config.exifFontScale)}px "Helvetica Neue", Arial, sans-serif`;
    const smallFont = `${Math.floor(watermarkHeight * config.smallFontScale)}px "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif`;

    const sidePadding = Math.floor(width * config.sidePaddingScale);
    const spacing = config.exifSpacing;
    const exifText = `${exifInfo.focal}mm${spacing}f/${exifInfo.fnumber}${spacing}${exifInfo.exposure}s${spacing}ISO${exifInfo.iso}`;

    const exifTextWidth = measureWidth(ctx, exifText, infoFont);
    const modelTextWidth = measureWidth(ctx, exifInfo.model, boldFont);

    const textDistance = Math.floor(width * config.textToLineDistanceScale);
    const rightTextX = sideBorder + width - sidePadding - exifTextWidth;
    const lineX = rightTextX - textDistance;
    const leftTextX = lineX - textDistance - modelTextWidth;

    // Logo
    const brand = exifInfo.brand || 'canon';
    const logo = await loadLogo(brand, 'normal');
    const logoScale = (config.brandLogoScales && config.brandLogoScales[brand]) || config.logoScale;
    const logoHeight = Math.floor(watermarkHeight * logoScale);
    const logoRatio = logo.width / logo.height;
    const logoWidth = Math.floor(logoHeight * logoRatio);
    const logoX = sideBorder + sidePadding;
    const logoY = Math.floor(sideBorder + height + (watermarkHeight - logoHeight) / 2 + config.logoYOffset);
    ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);

    // Y 坐标（top 基线）
    const topRowY = Math.floor(sideBorder + height + watermarkHeight * config.topRowYScale);
    const bottomRowY = Math.floor(sideBorder + height + watermarkHeight * config.bottomRowYScale);
    const lineTop = Math.floor(sideBorder + height + watermarkHeight * config.lineTopScale);
    const lineBottom = Math.floor(sideBorder + height + watermarkHeight * config.lineBottomScale);

    // 灰线
    ctx.strokeStyle = 'rgb(180, 180, 180)';
    ctx.lineWidth = config.lineWidth;
    ctx.beginPath();
    ctx.moveTo(lineX, lineTop);
    ctx.lineTo(lineX, lineBottom);
    ctx.stroke();

    // 机型
    setFont(ctx, boldFont);
    ctx.fillStyle = 'black';
    ctx.fillText(exifInfo.model, leftTextX, topRowY);

    // 第二行左：昵称 / 镜头，右对齐到机型尾部
    const bottomLeftText = displayMode === 'lens' ? exifInfo.lens : nickname;
    const bottomLeftWidth = measureWidth(ctx, bottomLeftText, smallFont);
    const modelRightX = leftTextX + modelTextWidth;
    const bottomLeftX = modelRightX - bottomLeftWidth;
    setFont(ctx, smallFont);
    ctx.fillStyle = 'rgb(120, 120, 120)';
    ctx.fillText(bottomLeftText, bottomLeftX, bottomRowY);

    // EXIF
    setFont(ctx, infoFont);
    ctx.fillStyle = 'black';
    ctx.fillText(exifText, rightTextX, topRowY);

    // 时间
    setFont(ctx, smallFont);
    ctx.fillStyle = 'rgb(120, 120, 120)';
    ctx.fillText(exifInfo.datetime, rightTextX, bottomRowY);

    return canvas;
}

// =========================================================
// 样式三：模糊背景边框 + 圆角主图 + 阴影 + 居中文字
// =========================================================
async function renderStyle3(img, exifInfo) {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const shortSide = Math.min(width, height);
    const config = style3Config;

    const border = Math.floor(shortSide * config.borderScale);
    const bottomExtra = Math.floor(height * config.bottomExtraScale);
    const canvasW = width + border * 2;
    const canvasH = height + border * 2 + bottomExtra;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');

    // ---- 背景：先把原图缩到小尺寸再模糊放大 ----
    const bgSmallMax = 256;
    let sw, sh;
    if (Math.max(width, height) <= bgSmallMax) {
        sw = width; sh = height;
    } else if (width >= height) {
        sw = bgSmallMax;
        sh = Math.max(1, Math.floor(height * bgSmallMax / width));
    } else {
        sh = bgSmallMax;
        sw = Math.max(1, Math.floor(width * bgSmallMax / height));
    }

    const small = document.createElement('canvas');
    small.width = sw;
    small.height = sh;
    const sctx = small.getContext('2d');
    sctx.drawImage(img, 0, 0, sw, sh);

    const targetBlur = Math.min(canvasW, canvasH) * config.blurRadiusScale;
    const smallBlur = Math.max(2.0, targetBlur * Math.min(sw, sh) / Math.min(canvasW, canvasH));

    // 先把原图绘制到画布（带 filter）实现模糊
    ctx.save();
    ctx.filter = `blur(${smallBlur}px) brightness(0.78)`;
    ctx.drawImage(small, 0, 0, canvasW, canvasH);
    ctx.restore();

    // ---- 阴影 + 圆角主图 ----
    const cornerRadius = Math.floor(shortSide * config.cornerRadiusScale);
    const shadowOffset = Math.floor(height * config.shadowOffsetScale);
    const shadowBlur = Math.floor(height * config.shadowBlurScale);
    const imgX = border;
    const imgY = border;

    ctx.save();
    // shadow 在 fill 时生效，这里用 fillRect 触发阴影，再单独画图本身
    ctx.shadowColor = `rgba(0, 0, 0, ${config.shadowAlpha / 255})`;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = shadowOffset;
    ctx.fillStyle = 'rgba(0,0,0,1)';
    roundRectPath(ctx, imgX, imgY, width, height, cornerRadius);
    ctx.fill();
    ctx.restore();

    // 然后画主图（带圆角剪裁），覆盖在阴影上
    ctx.save();
    roundRectPath(ctx, imgX, imgY, width, height, cornerRadius);
    ctx.clip();
    ctx.drawImage(img, imgX, imgY, width, height);
    ctx.restore();

    // ---- 文字区 ----
    const textAreaTop = imgY + height;
    const textAreaH = border + bottomExtra;

    const modelFontSize = Math.floor(textAreaH * config.modelFontScale);
    const exifFontSize = Math.floor(textAreaH * config.exifFontScale);
    const boldFont = `bold ${modelFontSize}px "Helvetica Neue", Arial, sans-serif`;
    const infoFont = `${exifFontSize}px "Helvetica Neue", Arial, sans-serif`;

    const brand = exifInfo.brand || 'canon';
    const modelText = brand === 'canon' ? (exifInfo.rawModel || exifInfo.model) : exifInfo.model;

    const logo = await loadLogo(brand, 'style3');
    const logoH = Math.floor(modelFontSize * config.logoHeightToFont);
    const logoRatio = logo.width / logo.height;
    const logoW = Math.floor(logoH * logoRatio);
    const logoTextGap = Math.floor(modelFontSize * config.logoTextGapToFont);

    const modelW = measureWidth(ctx, modelText, boldFont);
    const row1W = logoW + logoTextGap + modelW;
    const imgCenterX = imgX + Math.floor(width / 2);
    const row1X = imgCenterX - Math.floor(row1W / 2);

    const exifText = `${exifInfo.focal}mm  F${exifInfo.fnumber}  ${exifInfo.exposure}s  ISO${exifInfo.iso}`;
    const exifW = measureWidth(ctx, exifText, infoFont);
    const exifX = imgCenterX - Math.floor(exifW / 2);

    // 行高近似：直接用字号近似墨迹高度
    const modelVisualH = modelFontSize;
    const exifVisualH = exifFontSize;
    const row1H = Math.max(logoH, modelVisualH);
    const rowGap = Math.floor(textAreaH * config.rowGapScale);
    const totalH = row1H + rowGap + exifVisualH;
    const blockTop = textAreaTop + Math.floor((textAreaH - totalH) / 2);

    const row1Top = blockTop;
    const row1CenterY = row1Top + Math.floor(row1H / 2);
    const logoY = row1CenterY - Math.floor(logoH / 2);
    const modelY = row1CenterY - Math.floor(modelVisualH / 2);
    const row2Top = row1Top + row1H + rowGap;
    const row2Y = row2Top;

    ctx.drawImage(logo, row1X, logoY, logoW, logoH);

    setFont(ctx, boldFont);
    ctx.fillStyle = 'white';
    ctx.fillText(modelText, row1X + logoW + logoTextGap, modelY);

    setFont(ctx, infoFont);
    ctx.fillStyle = 'white';
    ctx.fillText(exifText, exifX, row2Y);

    return canvas;
}

// =========================================================
// 主入口
// =========================================================
export async function processWatermark(imageFile, exifInfo, displayMode, nickname, watermarkStyle) {
    const orientation = exifInfo.orientation || 1;
    const img = await loadOrientedImage(imageFile, orientation);

    if (watermarkStyle === 'style3') {
        return await renderStyle3(img, exifInfo);
    }
    return await renderStyle1And2(img, exifInfo, displayMode, nickname, watermarkStyle);
}

// =========================================================
// canvas -> Blob
// =========================================================
export function canvasToBlob(canvas, mime = 'image/jpeg', quality = 0.95) {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), mime, quality);
    });
}
