/**
 * EXIF 读取模块（修复版）
 * 使用 exifr 库读取照片元数据
 *
 * 修复要点：
 * 1) mergeTags 不再因 0 值占位而阻止后续正确值覆盖
 * 2) isComplete 判断更严格，避免提前终止
 * 3) 增加 XMP 解析尝试，并补充更多备选标签名
 */

import { detectBrand } from './watermark.js';

// =====================================================
// 工具函数
// =====================================================

// 是否为有效值（数字 0 也算有效，主要用于字符串/NaN检查）
function hasValue(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return !Number.isNaN(v);
    return true;
}

// 用于 mergeTags 的有效性判断：数字 0 视为无效（需允许后续覆盖）
function isValidValue(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return !Number.isNaN(v) && v !== 0;
    return true;
}

// 将一个 EXIF 值转换为数字（兼容数字/字符串/"a/b"/Rational对象/数组）
function toNumber(val) {
    if (!hasValue(val)) return null;

    if (Array.isArray(val)) {
        return toNumber(val[0]);
    }

    if (typeof val === 'number') {
        return Number.isFinite(val) ? val : null;
    }

    if (typeof val === 'object') {
        if ('numerator' in val && 'denominator' in val) {
            const d = Number(val.denominator);
            return d ? Number(val.numerator) / d : Number(val.numerator);
        }
        if ('value' in val) return toNumber(val.value);
    }

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

// File → ArrayBuffer
function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

// 合并多个 parse 结果：有效值优先，数字 0 可被非零值覆盖
function mergeTags(...tagSets) {
    const out = {};
    for (const t of tagSets) {
        if (!t || typeof t !== 'object') continue;
        for (const k of Object.keys(t)) {
            const newVal = t[k];
            // 已有值无效，或已有值为 0 且新值是非零有效数值，则覆盖
            if (!isValidValue(out[k]) ||
                (typeof newVal === 'number' && newVal !== 0 && out[k] === 0)) {
                out[k] = newVal;
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

// 判断关键字段是否齐全且有意义（不包含0或空字符串）
function isComplete(tags) {
    if (!tags) return false;
    const check = (k) => {
        const v = tags[k];
        if (v === null || v === undefined) return false;
        if (typeof v === 'number') return v > 0;
        if (typeof v === 'string') return v.trim() !== '';
        return true;
    };
    return check('Make')
        && check('Model')
        && (check('FNumber') || check('ApertureValue'))
        && (check('ExposureTime') || check('ShutterSpeedValue'))
        && (check('ISO') || check('ISOSpeedRatings') || check('PhotographicSensitivity'));
}

// =====================================================
// 默认值
// =====================================================
function getDefaultExifValues() {
    return {
        brand: null,
        rawMake: '',
        model: 'Unknown',
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

    // 多重串行尝试，顺序优化
    let tags = null;

    // 先将 File 转为 ArrayBuffer（Android WebView 更稳定）
    let buf = null;
    try {
        buf = await fileToArrayBuffer(file);
        console.log('[EXIF] ArrayBuffer 大小:', buf.byteLength);
    } catch (e) {
        console.warn('[EXIF] ArrayBuffer 转换失败:', e);
    }

    // 尝试 1：默认配置 + ArrayBuffer（快速获取基础段）
    if (buf) {
        const r = await safeParse(exifr, buf, undefined, '尝试1[默认+ArrayBuffer]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 2：默认配置 + File（兼容某些环境）
    if (!isComplete(tags)) {
        const r = await safeParse(exifr, file, undefined, '尝试2[默认+File]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 3：明确禁用 makerNote，但开启标准段 + 转换
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
            reviveValues: true
        }, '尝试3[无makerNote+转换]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 4：全开解析，包含 XMP 和 makerNote（兜底，可能捕获额外数据）
    if (!isComplete(tags) && buf) {
        const r = await safeParse(exifr, buf, {
            tiff: true,
            ifd0: true,
            exif: true,
            gps: true,
            interop: true,
            ifd1: true,
            xmp: true,            // 新增 XMP 支持
            makerNote: true,      // 允许但由 try/catch 保护
            translateValues: true,
            reviveValues: true,
            mergeOutput: true
        }, '尝试4[全开+XMP]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 5：空配置再次尝试（某些 exifr 版本行为差异）
    if (!isComplete(tags)) {
        const r = await safeParse(exifr, buf || file, {}, '尝试5[空配置]');
        if (r) tags = mergeTags(tags, r);
    }

    if (!tags) tags = {};
    console.log('[EXIF] 合并后的最终 tags 对象:', tags);
    console.log('[EXIF] tags 字段列表:', Object.keys(tags));

    // ---------- 字段提取（增加备选标签名） ----------

    // 品牌
    const rawMake = hasValue(tags.Make) ? String(tags.Make).trim() : '';

    // 相机型号
    const rawModel = hasValue(tags.Model) ? String(tags.Model).trim() : '';

    // 焦距：优先 FocalLength，再 FocalLengthIn35mmFormat 等
    let focalNum = toNumber(tags.FocalLength)
                || toNumber(tags['FocalLengthIn35mmFormat'])
                || toNumber(tags['FocalLengthIn35mmFilm']);

    // 光圈：FNumber → ApertureValue (APEX) → 其他键
    let fNum = toNumber(tags.FNumber);
    if ((fNum === null || fNum === 0)) {
        const av = toNumber(tags.ApertureValue);
        if (av !== null && av > 0) {
            fNum = Math.pow(Math.SQRT2, av);
        }
    }
    if ((fNum === null || fNum === 0)) {
        fNum = toNumber(tags['Aperture']) || toNumber(tags['MaxApertureValue']);
    }

    // 快门：ExposureTime → ShutterSpeedValue (APEX) → 字符串
    let expNum = toNumber(tags.ExposureTime);
    if ((expNum === null || expNum === 0)) {
        const tv = toNumber(tags.ShutterSpeedValue);
        if (tv !== null) {
            expNum = 1 / Math.pow(2, tv);
        }
    }
    if ((expNum === null || expNum === 0)) {
        expNum = toNumber(tags['ExposureTime']) || toNumber(tags['ShutterSpeed']);
    }

    // ISO：多个候选字段
    let isoNum = toNumber(tags.ISO)
              || toNumber(tags.ISOSpeedRatings)
              || toNumber(tags.PhotographicSensitivity)
              || toNumber(tags.RecommendedExposureIndex)
              || toNumber(tags['ISOSpeed']);

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

    // ---------- 结果组装（默认值兜底） ----------
    const def = getDefaultExifValues();
    const result = {
        brand: rawMake ? detectBrand(rawMake) : def.brand,
        rawMake: rawMake || def.rawMake,
        model: rawModel || def.model,
        focal: (focalNum !== null && focalNum > 0) ? String(Math.round(focalNum)) : def.focal,
        fnumber: (fNum !== null && fNum > 0)
            ? String(Math.round(fNum * 10) / 10)
            : def.fnumber,
        exposure: (() => {
            if (expNum !== null && expNum > 0) {
                if (expNum >= 1) return String(Math.round(expNum * 10) / 10).replace(/\.0$/, '');
                return `1/${Math.round(1 / expNum)}`;
            }
            if (typeof tags.ExposureTime === 'string' && tags.ExposureTime.trim() !== '') {
                return tags.ExposureTime.trim();
            }
            return def.exposure;
        })(),
        iso: (isoNum !== null && isoNum > 0) ? String(Math.round(isoNum)) : def.iso,
        datetime,
        lens,
        orientation
    };

    console.log('[EXIF] 最终结果:', result);
    return result;
}
