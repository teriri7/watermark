/**
 * EXIF 读取模块（修复版 - 品牌识别与机型简化）
 * 使用 exifr 库读取照片元数据
 */

// =====================================================
// 工具函数
// =====================================================

function hasValue(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return !Number.isNaN(v);
    return true;
}

function isValidValue(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (typeof v === 'number') return !Number.isNaN(v) && v !== 0;
    return true;
}

function toNumber(val) {
    if (!hasValue(val)) return null;
    if (Array.isArray(val)) return toNumber(val[0]);
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
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

function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function mergeTags(...tagSets) {
    const out = {};
    for (const t of tagSets) {
        if (!t || typeof t !== 'object') continue;
        for (const k of Object.keys(t)) {
            const newVal = t[k];
            if (!isValidValue(out[k]) ||
                (typeof newVal === 'number' && newVal !== 0 && out[k] === 0)) {
                out[k] = newVal;
            }
        }
    }
    return out;
}

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
// 品牌识别（仅佳能/索尼/尼康，否则返回空）
// =====================================================
function detectBrand(make) {
    if (!make) return '';
    const upper = make.toUpperCase();
    if (upper.includes('CANON')) return 'canon';
    if (upper.includes('SONY')) return 'sony';
    if (upper.includes('NIKON')) return 'nikon';
    return '';
}

// =====================================================
// 机型简化（罗马数字映射）
// =====================================================
const ROMAN_MAP = {
    '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V',
    '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X'
};

function simplifyCanon(model) {
    // 去除品牌前缀
    model = model.replace(/Canon EOS\s*/i, '');
    model = model.replace(/Canon\s*/i, '');
    model = model.replace(/EOS\s*/i, '');
    
    // 处理末尾 m1~m10 (不区分大小写)
    model = model.replace(/m10$/i, 'Mark X');
    model = model.replace(/m9$/i, 'Mark IX');
    model = model.replace(/m8$/i, 'Mark VIII');
    model = model.replace(/m7$/i, 'Mark VII');
    model = model.replace(/m6$/i, 'Mark VI');
    model = model.replace(/m5$/i, 'Mark V');
    model = model.replace(/m4$/i, 'Mark IV');
    model = model.replace(/m3$/i, 'Mark III');
    model = model.replace(/m2$/i, 'Mark II');
    model = model.replace(/m1$/i, 'Mark I');
    
    return model.trim();
}

function simplifySony(model) {
    // 仅去除 "SONY " 前缀
    return model.replace(/^sony\s+/i, '').trim();
}

function simplifyNikon(model) {
    // 去除 "NIKON CORPORATION " 或 "NIKON "
    model = model.replace(/^NIKON\s+CORPORATION\s*/i, '');
    model = model.replace(/^NIKON\s*/i, '');
    
    // 处理 _数字 后缀 -> Mark 罗马数字
    model = model.replace(/_(\d+)$/i, (_, num) => {
        return ' Mark ' + (ROMAN_MAP[num] || num);
    });
    
    // 合并字母与数字之间的空格 (如 Z 6 -> Z6)
    model = model.replace(/^([A-Z])\s+(\d)/i, '$1$2');
    
    return model.trim();
}

function simplifyCameraModel(model, brand) {
    if (!model || typeof model !== 'string') return '';
    model = model.trim();
    
    switch (brand) {
        case 'sony':
            return simplifySony(model);
        case 'nikon':
            return simplifyNikon(model);
        case 'canon':
        default:
            // 佳能或其他未识别品牌均按佳能处理（只去除前缀）
            return simplifyCanon(model);
    }
}

// =====================================================
// 默认值
// =====================================================
function getDefaultExifValues() {
    return {
        brand: 'canon',         // 仅用于极端兜底，不会覆盖识别结果
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

    let tags = null;
    let buf = null;
    try {
        buf = await fileToArrayBuffer(file);
    } catch (e) {
        console.warn('[EXIF] ArrayBuffer 转换失败:', e);
    }

    // 尝试 1：默认配置 + ArrayBuffer
    if (buf) {
        const r = await safeParse(exifr, buf, undefined, '尝试1[默认+ArrayBuffer]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 2：默认配置 + File
    if (!isComplete(tags)) {
        const r = await safeParse(exifr, file, undefined, '尝试2[默认+File]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 3：无 makerNote + 转换
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

    // 尝试 4：全开（含 XMP）
    if (!isComplete(tags) && buf) {
        const r = await safeParse(exifr, buf, {
            tiff: true,
            ifd0: true,
            exif: true,
            gps: true,
            interop: true,
            ifd1: true,
            xmp: true,
            makerNote: true,
            translateValues: true,
            reviveValues: true,
            mergeOutput: true
        }, '尝试4[全开+XMP]');
        if (r) tags = mergeTags(tags, r);
    }

    // 尝试 5：空配置兜底
    if (!isComplete(tags)) {
        const r = await safeParse(exifr, buf || file, {}, '尝试5[空配置]');
        if (r) tags = mergeTags(tags, r);
    }

    if (!tags) tags = {};
    console.log('[EXIF] 合并后的最终 tags:', Object.keys(tags));

    // ---------- 字段提取 ----------
    const rawMake = hasValue(tags.Make) ? String(tags.Make).trim() : '';
    const brand = detectBrand(rawMake);

    const rawModel = hasValue(tags.Model) ? String(tags.Model).trim() : '';
    const model = rawModel ? simplifyCameraModel(rawModel, brand) : '';

    // 焦距
    let focalNum = toNumber(tags.FocalLength)
                || toNumber(tags['FocalLengthIn35mmFormat'])
                || toNumber(tags['FocalLengthIn35mmFilm']);
    const focal = (focalNum !== null && focalNum > 0) ? String(Math.round(focalNum)) : '';

    // 光圈
    let fNum = toNumber(tags.FNumber);
    if ((fNum === null || fNum === 0)) {
        const av = toNumber(tags.ApertureValue);
        if (av !== null && av > 0) fNum = Math.pow(Math.SQRT2, av);
    }
    if ((fNum === null || fNum === 0)) {
        fNum = toNumber(tags['Aperture']) || toNumber(tags['MaxApertureValue']);
    }
    const fnumberStr = (fNum !== null && fNum > 0) ? String(Math.round(fNum * 10) / 10) : '';

    // 快门
    let expNum = toNumber(tags.ExposureTime);
    if ((expNum === null || expNum === 0)) {
        const tv = toNumber(tags.ShutterSpeedValue);
        if (tv !== null) expNum = 1 / Math.pow(2, tv);
    }
    if ((expNum === null || expNum === 0)) {
        expNum = toNumber(tags['ExposureTime']) || toNumber(tags['ShutterSpeed']);
    }
    let exposureStr = '';
    if (expNum !== null && expNum > 0) {
        exposureStr = expNum >= 1 ? String(Math.round(expNum * 10) / 10).replace(/\.0$/, '') : `1/${Math.round(1 / expNum)}`;
    } else if (typeof tags.ExposureTime === 'string' && tags.ExposureTime.trim() !== '') {
        exposureStr = tags.ExposureTime.trim();
    }

    // ISO
    let isoNum = toNumber(tags.ISO)
              || toNumber(tags.ISOSpeedRatings)
              || toNumber(tags.PhotographicSensitivity)
              || toNumber(tags.RecommendedExposureIndex)
              || toNumber(tags['ISOSpeed']);
    const iso = (isoNum !== null && isoNum > 0) ? String(Math.round(isoNum)) : '';

    // 时间
    const dt = tags.DateTimeOriginal || tags.DateTime || tags.CreateDate || tags.ModifyDate || null;
    const datetime = formatDateTime(dt);

    // 镜头
    let lens = tags.LensModel || tags.Lens || tags.LensMake || '';
    if (typeof lens !== 'string') lens = String(lens || '');
    lens = lens.trim();
    if (!lens || lens === '--') lens = 'Lens';

    // 方向
    const orientation = toNumber(tags.Orientation) || 1;

    // 默认值仅用于完全没有值的极端情况
    const def = getDefaultExifValues();

    const result = {
        brand: brand || '',                    // 未识别时保持空，不再强制佳能
        rawMake: rawMake || '',
        model: model || '',                   // 未识别时保持空
        rawModel: rawModel || '',
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
