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
 * 读取图片 EXIF 信息
 * @param {File} file - 图片文件
 * @returns {Promise<Object>} EXIF 信息对象
 */
export async function readExif(file) {
    try {
        // 动态导入 exifr（假设已通过 CDN 或打包工具引入）
        const exifr = window.exifr;
        if (!exifr) {
            throw new Error('exifr library not loaded');
        }
        
        const tags = await exifr.parse(file, {
            tiff: true,
            exif: true,
            gps: false,
            interop: false,
            ifd0: true,
            ifd1: false,
            makerNote: true,
            userComment: false,
        });
        
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
        
        return {
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
        
    } catch (error) {
        console.warn('EXIF 读取失败，使用默认值:', error);
        
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
