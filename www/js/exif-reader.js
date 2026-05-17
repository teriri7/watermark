/**
 * EXIF 读取模块
 * 使用 exifr 库读取照片元数据
 *
 * 关键点（Android WebView 兼容）：
 * 1) 关闭 makerNote（厂商私有段，结构非标准，常导致解析失败）
 * 2) 多次串行尝试解析，不同方式互为兜底
 * 3) 不使用 pick 选项（某些 exifr 版本对 pick 行为不一致）
 * 4) 对返回值类型做完整兼容（数字/字符串/分数/Rational/数组）
 */

import { detectBrand, simplifyCameraModel } from './watermark.js';

// =====================================================
// 工具函数
// =====================================================

// 是否为"有效值"（注意：数字 0 也算有效；空字符串、null、undefined、NaN 不算）
function hasValue(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return !Number.isNaN(v);
    return true;
}

// 把一个 EXIF 值转成数字（兼容数字 / 字符串 / "a/b" / Rational对象 / 数组）
function toNumber(val) {
    if (!hasValue(val)) return null;

    // 数组（如某些 ISO 字段返回 [100]）
    if (Array.isArray(val)) {
        return toNumber(val[0]);
    }

    // 数字
    if (typeof val === 'number') {
        return Number.isFinite(val) ? val : null;
    }

    // Rational 对象
    if (typeof val === 'object') {
        if ('numerator' in val && 'denominator' in val) {
            const d = Number(val.denominator);
            return d ? Number(val.numerator) / d : Number(val.numerator);
        }
        if ('value' in val) return toNumber(val.value);
    }

    // 字符串
    const s = String(val).trim();
    if (s === '') return null;
    if (s.includes('/')) {
        const [a, b] = s.split('/').map(Number);
        if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
        if (Number.isFinite(a)) return a;
        return null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

// 格式化日期时间为 "YYYY.MM.DD HH:mm"
function formatDateTime(dt) {
    if (!dt) {
        const now = new Date();
        return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    if (dt instanceof Date) {
        return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    }
    const match = String(dt).match(/^(\d{4})[:\-/](\d{2})[:\-/](\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
        return `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}`;
    }
    return formatDateTime(null);
}

// File -> ArrayBuffer
function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// 把多个 parse 结果合并（前面的优先，后面的补充缺失字段）
function mergeTags(...tagSets) {
    const out = {};
    for (const t of tagSets) {
        if (!t || typeof t !== 'object') continue;
        for (const k of Object.keys(t)) {
            if (!hasValue(out[k])) {
                out[k] = t[k];
            }
        }
    }
    return out;
}

// 安全调用 exifr.parse
async function safeParse(exifr, input, options, label) {
    try {
        const r = await exifr.parse(input, options);
        console.log(`[EXIF] ${label} 成功:`, r);
        return r || null;
    } catch (e) {
        console.warn(`[EXIF] ${label} 失败:`, e?.message || e);
        return null;
    }
}

// 判断关键字段是否齐全（用于决定是否还要继续尝试）
function isComplete(tags) {
    if (!tags) return false;
    return hasValue(tags.Make)
        && hasValue(tags.Model)
        && (hasValue(tags.FNumber) || hasValue(tags.ApertureValue))
        && (hasValue(tags.ExposureTime) || hasValue(tags.ShutterSpeedValue))
        && (hasValue(tags.ISO) || hasValue(tags.ISOSpeedRatings) || hasValue(tags.PhotographicSensitivity));
}

// =====================================================
// 默认值
// =====================================================
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

// =====================================================
// 主函数
// =====================================================

/**
 * 读取图片 EXIF 信息
 * @param {File} file
 * @returns {Promise<Object>}
 */
export async function readExif(file) {
    console.log('[EXIF] 开始读取:', file.name, file.type, file.size);

    const exifr = window.exifr;
    if (!exifr) {
        console.error('[EXIF] exifr 库未加载');
        return {
            ...getDefaultExifValues(),
            datetime: formatDateTime(null),
            lens: 'Lens',
            orientation: 1
        };
    }

    // ---------- 多重串行尝试 ----------
    // 串行而非并行：避免同一 buffer 被并发读取时产生竞争状态
    let tags = null;

    // 优先把 file 转成 ArrayBuffer，Android WebView 上更稳
    let buf = null;
    try {
        buf = await fileToArrayBuffer(file);
        console.log('[EXIF] ArrayBuffer 大小:', buf.byteLength);
    } catch (e) {
        console.warn('[EXIF] ArrayBuffer 转换失败:', e);
    }

    // 尝试 1：默认配置（最简单），ArrayBuffer 输入
    if (buf) {
        const r = await safeParse(exifr, buf, undefined, '尝试1[默认+ArrayBuffer]');
        if (r) tags = mergeTags(tags, r);
        if (isComplete(tags)) {
            console.log('[EXIF] 尝试1 已读到完整字段，提前结束');
        }
    }

    // 尝试 2：默认配置，File 输入（某些环境 ArrayBuffer 路径有问题）
    if (!isComplete(tags)) {
        const r = await safeParse(exifr, file, undefined, '尝试2[默认+File]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 3：显式开启 ifd0 + exif，关闭 makerNote
    if (!isComplete(tags) && buf) {
        const r = await safeParse(exifr, buf, {
            tiff: true,
            ifd0: true,
            exif: true,
            gps: false,
            interop: false,
            ifd1: false,
            makerNote: false,
            userComment: false
        }, '尝试3[详细配置+ArrayBuffer]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 4：translateValues / reviveValues 全开（让 exifr 把原始值转成可读形式）
    if (!isComplete(tags) && buf) {
        const r = await safeParse(exifr, buf, {
            tiff: true,
            ifd0: true,
            exif: true,
            gps: false,
            interop: false,
            ifd1: false,
            makerNote: false,
            userComment: false,
            translateValues: true,
            reviveValues: true,
            mergeOutput: true
        }, '尝试4[translate+revive]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 5：使用 exifr.gps / exifr.thumbnail 等独立方法以外，
    //        再用一次完全裸调用（不传 options），最后兜底
    if (!isComplete(tags)) {
        const r = await safeParse(exifr, buf || file, {}, '尝试5[空配置]');
        if (r) tags = mergeTags(tags, r);
    }

    if (!tags) tags = {};
    console.log('[EXIF] 合并后的最终 tags 对象:', tags);
    console.log('[EXIF] tags 字段列表:', Object.keys(tags));

    // ---------- 字段提取 ----------

    // 品牌识别
    const rawMake = hasValue(tags.Make) ? String(tags.Make).trim() : '';
    const brand = detectBrand(rawMake);

    // 相机型号
    const rawModel = hasValue(tags.Model) ? String(tags.Model).trim() : '';
    const model = rawModel ? simplifyCameraModel(rawModel, brand) : '';

    // 焦距
    let focalNum = toNumber(tags.FocalLength);
    if (focalNum === null || focalNum === 0) {
        focalNum = toNumber(tags.FocalLengthIn35mmFormat);
    }
    const focal = (focalNum !== null && focalNum > 0) ? String(Math.round(focalNum)) : '';

    // 光圈
    let fNum = toNumber(tags.FNumber);
    if (fNum === null || fNum === 0) {
        // ApertureValue 是 APEX，F = sqrt(2)^Av
        const av = toNumber(tags.ApertureValue);
        if (av !== null && av > 0) {
            fNum = Math.pow(Math.SQRT2, av);
        }
    }
    const fnumberStr = (fNum !== null && fNum > 0)
        ? String(Math.round(fNum * 10) / 10)
        : '';

    // 快门
    let exposureStr = '';
    let expRaw = tags.ExposureTime;
    let expNum = toNumber(expRaw);
    if (expNum === null || expNum === 0) {
        // ShutterSpeedValue 是 APEX，T = 1 / 2^Tv
        const tv = toNumber(tags.ShutterSpeedValue);
        if (tv !== null) {
            expNum = 1 / Math.pow(2, tv);
        }
    }
    if (expNum !== null && expNum > 0) {
        if (expNum >= 1) {
            exposureStr = String(Math.round(expNum * 10) / 10).replace(/\.0$/, '');
        } else {
            exposureStr = `1/${Math.round(1 / expNum)}`;
        }
    } else if (typeof expRaw === 'string' && expRaw.trim() !== '') {
        exposureStr = expRaw.trim();
    }

    // ISO
    let isoNum = toNumber(tags.ISO);
    if (isoNum === null) isoNum = toNumber(tags.ISOSpeedRatings);
    if (isoNum === null) isoNum = toNumber(tags.PhotographicSensitivity);
    if (isoNum === null) isoNum = toNumber(tags.RecommendedExposureIndex);
    const iso = (isoNum !== null && isoNum > 0) ? String(Math.round(isoNum)) : '';

    // 时间
    const dt = tags.DateTimeOriginal || tags.DateTime || tags.CreateDate || tags.ModifyDate || null;
    const datetime = formatDateTime(dt);

    // 镜头型号
    let lens = tags.LensModel || tags.Lens || tags.LensMake || '';
    if (typeof lens !== 'string') lens = String(lens || '');
    lens = lens.trim();
    if (!lens || lens === '--') lens = 'Lens';

    // 方向
    const orientation = toNumber(tags.Orientation) || 1;

    // ---------- 默认值兜底 ----------
    const def = getDefaultExifValues();

    if (!rawMake) console.warn('[EXIF] ✗ Make 字段缺失');
    if (!rawModel) console.warn('[EXIF] ✗ Model 字段缺失');
    if (!focal) console.warn('[EXIF] ✗ FocalLength 字段缺失');
    if (!fnumberStr) console.warn('[EXIF] ✗ FNumber/ApertureValue 字段缺失');
    if (!exposureStr) console.warn('[EXIF] ✗ ExposureTime/ShutterSpeedValue 字段缺失');
    if (!iso) console.warn('[EXIF] ✗ ISO 字段缺失');

    const result = {
        brand: brand || def.brand,
        rawMake: rawMake || def.rawMake,
        model: model || def.model,
        rawModel: rawModel || def.rawModel,
        focal: focal || def.focal,
        fnumber: fnumberStr || def.fnumber,
        exposure: exposureStr || def.exposure,
        iso: iso || def.iso,
        datetime,
        lens,
        orientation
    };

    console.log('[EXIF] 最终结果:', result);
    return result;
}
