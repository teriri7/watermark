/**
 * EXIF 读取模块
 * 使用 exifr 库读取照片元数据
 */

import { detectBrand, simplifyCameraModel } from './watermark.js';

// 格式化日期时间
function formatDateTime(dt) {
    if (!dt) {
        const now = new Date();
        return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    
    if (dt instanceof Date) {
        return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }
    
    // 尝试解析字符串格式 "YYYY:MM:DD HH:MM:SS"
    const match = String(dt).match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (match) {
        return `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}`;
    }
    
    return formatDateTime(null);
}

// 处理分数格式（如 "50/1" -> 50）
function parseFraction(val) {
    if (!val) return null;
    const str = String(val);
    if (str.includes('/')) {
        const [a, b] = str.split('/').map(Number);
        return b ? a / b : a;
    }
    return Number(val);
}

/**
 * 将 File 转换为 ArrayBuffer（安卓兼容性更好）
 * @param {File} file - 图片文件
 * @returns {Promise<ArrayBuffer>}
 */
function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

/**
 * 读取图片 EXIF 信息
 * @param {File} file - 图片文件
 * @returns {Promise<Object>} EXIF 信息对象
 */
export async function readExif(file) {
    console.log('[EXIF] 开始读取 EXIF 信息:', file.name, file.type, file.size);
    
    try {
        // 检查 exifr 库是否加载
        const exifr = window.exifr;
        if (!exifr) {
            console.error('[EXIF] exifr 库未加载！请检查 www/vendor/exifr.min.js 是否存在');
            throw new Error('exifr library not loaded');
        }
        
        console.log('[EXIF] exifr 库已加载，开始解析...');
        
        // 安卓环境下，先转为 ArrayBuffer 再解析（兼容性更好）
        let input = file;
        const isAndroid = /android/i.test(navigator.userAgent);
        if (isAndroid) {
            console.log('[EXIF] 检测到安卓环境，使用 ArrayBuffer 方式读取');
            try {
                input = await fileToArrayBuffer(file);
                console.log('[EXIF] ArrayBuffer 转换成功，大小:', input.byteLength);
            } catch (e) {
                console.warn('[EXIF] ArrayBuffer 转换失败，回退到 File 对象:', e);
                input = file;
            }
        }
        
        const tags = await exifr.parse(input, {
            tiff: true,
            exif: true,
            gps: false,
            interop: false,
            ifd0: true,
            ifd1: false,
            makerNote: true,
            userComment: false,
        });
        
        console.log('[EXIF] 解析成功，原始标签:', tags);
        
        // 品牌识别
        const rawMake = tags?.Make || '';
        const brand = detectBrand(rawMake);
        
        // 相机型号
        const rawModel = tags?.Model || 'Canon EOS R6m2';
        const model = simplifyCameraModel(rawModel, brand);
        
        // 焦距
        let focal = tags?.FocalLength || 35;
        focal = Math.round(parseFraction(focal) || 35);
        
        // 光圈
        let fnumber = tags?.FNumber || tags?.ApertureValue || 1.4;
        fnumber = parseFraction(fnumber) || 1.4;
        fnumber = Math.round(fnumber * 10) / 10;
        
        // 快门
        let exposure = tags?.ExposureTime || '1/100';
        if (typeof exposure === 'number') {
            if (exposure >= 1) {
                exposure = String(Math.round(exposure));
            } else {
                exposure = `1/${Math.round(1 / exposure)}`;
            }
        } else {
            exposure = String(exposure);
        }
        
        // ISO
        const iso = tags?.ISO || tags?.ISOSpeedRatings || 100;
        
        // 时间
        const dt = tags?.DateTimeOriginal || tags?.DateTime || null;
        const datetime = formatDateTime(dt);
        
        // 镜头型号
        let lens = tags?.LensModel || tags?.LensMake || '';
        if (!lens || lens === '--') {
            lens = 'Lens';
        }
        
        // 方向
        const orientation = tags?.Orientation || 1;
        
        const result = {
            brand,
            rawMake,
            model,
            rawModel,
            focal: String(focal),
            fnumber: String(fnumber),
            exposure,
            iso: String(iso),
            datetime,
            lens: String(lens).trim(),
            orientation
        };
        
        console.log('[EXIF] 最终结果:', result);
        return result;
        
    } catch (error) {
        console.error('[EXIF] 读取失败，使用默认值:', error);
        console.error('[EXIF] 错误详情:', {
            message: error.message,
            stack: error.stack,
            exifrLoaded: !!window.exifr,
            fileInfo: { name: file.name, type: file.type, size: file.size }
        });
        
        // 返回默认值
        return {
            brand: 'canon',
            rawMake: 'Canon',
            model: 'R6 Mark II',
            rawModel: 'Canon EOS R6m2',
            focal: '35',
            fnumber: '1.4',
            exposure: '1/100',
            iso: '100',
            datetime: formatDateTime(null),
            lens: 'Lens',
            orientation: 1
        };
    }
}
