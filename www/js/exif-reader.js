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
// 安全调用一次 exifr.parse，捕获异常并返回 null
async function safeParse(exifr, input, options) {
    try {
        return await exifr.parse(input, options);
    } catch (e) {
        console.warn('[EXIF] parse 失败，options=', options, e);
        return null;
    }
}

// 把多个 parse 结果合并（后者补充前者缺失的字段）
function mergeTags(...tagSets) {
    const out = {};
    for (const t of tagSets) {
        if (!t || typeof t !== 'object') continue;
        for (const k of Object.keys(t)) {
            if (out[k] === undefined || out[k] === null || out[k] === '') {
                out[k] = t[k];
            }
        }
    }
    return out;
}

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

        // 关键修复：
        // 1) 关闭 makerNote —— 厂商私有结构很容易在某些机型上抛错，
        //    一旦抛错 exifr 会让整段 EXIF 拿到的字段不完整，
        //    具体表现就是"机型 + 曝光参数缺失，但镜头/时间还在"。
        // 2) 用显式的 pick 列表，告诉 exifr 我们只需要这些字段，
        //    避免去走解析链上的可疑分支。
        // 3) 同时跑一次"宽松"解析作为兜底，把缺失字段补上。
        const wantedTags = [
            'Make', 'Model',
            'LensModel', 'LensMake', 'LensInfo', 'Lens',
            'FocalLength', 'FocalLengthIn35mmFormat',
            'FNumber', 'ApertureValue',
            'ExposureTime', 'ShutterSpeedValue',
            'ISO', 'ISOSpeedRatings', 'PhotographicSensitivity', 'RecommendedExposureIndex',
            'DateTimeOriginal', 'DateTime', 'CreateDate',
            'Orientation'
        ];

        const strictPromise = safeParse(exifr, input, {
            tiff: true,
            ifd0: true,
            exif: true,
            gps: false,
            interop: false,
            ifd1: false,
            makerNote: false,   // 关键：关闭 makerNote
            userComment: false,
            pick: wantedTags
        });

        // 兜底：用最宽松的方式再跑一次（不传 pick，不开 makerNote）
        const fallbackPromise = safeParse(exifr, input, {
            tiff: true,
            ifd0: true,
            exif: true,
            gps: false,
            interop: false,
            ifd1: false,
            makerNote: false,
            userComment: false
        });

        const [strict, fallback] = await Promise.all([strictPromise, fallbackPromise]);
        console.log('[EXIF] strict 结果:', strict);
        console.log('[EXIF] fallback 结果:', fallback);

        const tags = mergeTags(strict, fallback);
        console.log('[EXIF] 合并后标签:', tags);

        if (!tags || Object.keys(tags).length === 0) {
            console.warn('[EXIF] 两次解析都没拿到任何字段');
        }

        // ---------- 字段提取 ----------

        // 品牌识别
        const rawMake = tags?.Make || '';
        const brand = detectBrand(rawMake);

        // 相机型号：注意如果没读到就保持空字符串，让上层知道是真没读到
        const rawModel = (tags?.Model && String(tags.Model).trim()) || '';
        const model = rawModel
            ? simplifyCameraModel(rawModel, brand)
            : '';

        // 焦距
        let focalRaw = tags?.FocalLength;
        if (focalRaw === undefined || focalRaw === null || focalRaw === '') {
            focalRaw = tags?.FocalLengthIn35mmFormat;
        }
        const focalNum = parseFraction(focalRaw);
        const focal = focalNum ? String(Math.round(focalNum)) : '';

        // 光圈：FNumber 优先；ApertureValue 是 APEX 值，需要换算 F = sqrt(2)^Av
        let fnumberStr = '';
        let fRaw = tags?.FNumber;
        if (fRaw === undefined || fRaw === null || fRaw === '') {
            const av = parseFraction(tags?.ApertureValue);
            if (av) fRaw = Math.pow(Math.SQRT2, av);
        }
        const fNum = parseFraction(fRaw);
        if (fNum) {
            fnumberStr = String(Math.round(fNum * 10) / 10);
        }

        // 快门
        let exposureStr = '';
        let expRaw = tags?.ExposureTime;
        if (expRaw === undefined || expRaw === null || expRaw === '') {
            // ShutterSpeedValue 是 APEX，T = 1 / 2^Tv
            const tv = parseFraction(tags?.ShutterSpeedValue);
            if (tv !== null && !Number.isNaN(tv)) {
                expRaw = 1 / Math.pow(2, tv);
            }
        }
        if (typeof expRaw === 'number') {
            if (expRaw >= 1) {
                exposureStr = String(Math.round(expRaw));
            } else if (expRaw > 0) {
                exposureStr = `1/${Math.round(1 / expRaw)}`;
            }
        } else if (expRaw) {
            const num = parseFraction(expRaw);
            if (num) {
                if (num >= 1) exposureStr = String(Math.round(num));
                else exposureStr = `1/${Math.round(1 / num)}`;
            } else {
                exposureStr = String(expRaw);
            }
        }

        // ISO
        const isoRaw = tags?.ISO
            ?? tags?.ISOSpeedRatings
            ?? tags?.PhotographicSensitivity
            ?? tags?.RecommendedExposureIndex;
        const iso = isoRaw ? String(Array.isArray(isoRaw) ? isoRaw[0] : isoRaw) : '';

        // 时间
        const dt = tags?.DateTimeOriginal || tags?.DateTime || tags?.CreateDate || null;
        const datetime = formatDateTime(dt);

        // 镜头型号
        let lens = tags?.LensModel || tags?.Lens || tags?.LensMake || '';
        if (!lens || String(lens).trim() === '--') {
            lens = 'Lens';
        }

        // 方向
        const orientation = tags?.Orientation || 1;

        // ---------- 默认值兜底（仅在真的缺失时使用，并打印警告便于排查）----------
        const def = getDefaultExifValues();
        const finalRawMake = rawMake || def.rawMake;
        const finalBrand = brand || def.brand;
        const finalRawModel = rawModel || def.rawModel;
        const finalModel = model || def.model;
        const finalFocal = focal || def.focal;
        const finalFnumber = fnumberStr || def.fnumber;
        const finalExposure = exposureStr || def.exposure;
        const finalIso = iso || def.iso;

        if (!rawModel) console.warn('[EXIF] Model 未读到，使用默认:', def.model);
        if (!focal) console.warn('[EXIF] FocalLength 未读到，使用默认:', def.focal);
        if (!fnumberStr) console.warn('[EXIF] FNumber 未读到，使用默认:', def.fnumber);
        if (!exposureStr) console.warn('[EXIF] ExposureTime 未读到，使用默认:', def.exposure);
        if (!iso) console.warn('[EXIF] ISO 未读到，使用默认:', def.iso);

        const result = {
            brand: finalBrand,
            rawMake: finalRawMake,
            model: finalModel,
            rawModel: finalRawModel,
            focal: finalFocal,
            fnumber: finalFnumber,
            exposure: finalExposure,
            iso: finalIso,
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
            ...getDefaultExifValues(),
            datetime: formatDateTime(null),
            lens: 'Lens',
            orientation: 1
        };
    }
}

function getDefaultExifValues() {
    return {
        brand: 'canon',
        rawMake: 'Canon',
        model: 'R6 Mark II',
        rawModel: 'Canon EOS R6m2',
        focal: '35',
        fnumber: '1.4',
        exposure: '1/100',
        iso: '100'
    };
}
