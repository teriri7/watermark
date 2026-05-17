from flask import Flask, render_template, request, send_file

from PIL import (
    Image,
    ImageDraw,
    ImageFont,
    ImageOps,
    ImageFilter,
    ImageEnhance
)

import io
import os
import exifread
import re
import piexif

from datetime import datetime


# =========================================================
# Flask 初始化
# =========================================================
app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Logo 文件路径 (按品牌 + 样式)
# 所有 logo 图片统一放在项目根目录下的 logo/ 文件夹中
LOGO_DIR = os.path.join(BASE_DIR, 'logo')

LOGO_PATHS = {
    'canon': {
        'normal': os.path.join(LOGO_DIR, 'canon.png'),
        'style3': os.path.join(LOGO_DIR, 'canon2.png')
    },
    'sony': {
        'normal': os.path.join(LOGO_DIR, 'sony.png'),
        'style3': os.path.join(LOGO_DIR, 'sony2.png')
    },
    'nikon': {
        'normal': os.path.join(LOGO_DIR, 'nikon.png'),
        'style3': os.path.join(LOGO_DIR, 'nikon2.png')
    }
}


# =========================================================
# 阿拉伯数字 -> 罗马数字 (1~10)
# =========================================================
_ROMAN_MAP = {
    '1': 'I',
    '2': 'II',
    '3': 'III',
    '4': 'IV',
    '5': 'V',
    '6': 'VI',
    '7': 'VII',
    '8': 'VIII',
    '9': 'IX',
    '10': 'X',
}


# =========================================================
# 品牌识别
#
# 根据 EXIF 'Image Make' 字段判断相机品牌
# 返回值: 'canon' / 'sony' / 'nikon' / 'canon' (默认)
# =========================================================
def detect_brand(make):

    if not make:
        return 'canon'

    make_upper = str(make).strip().upper()

    if 'CANON' in make_upper:
        return 'canon'
    if 'SONY' in make_upper:
        return 'sony'
    if 'NIKON' in make_upper:
        return 'nikon'

    return 'canon'


# =========================================================
# 机型名称简化 - Canon
#
# Canon EOS R6m2
# ->
# R6 Mark II
#
# 规则:
# 1. 去掉 Canon EOS / Canon / EOS 前缀
# 2. 末尾 m1~m10 -> Mark I~X (罗马数字)
# 3. 没有 m几 后缀的 (如 RP/R6/R8) 保持原样
# =========================================================
def _simplify_canon(model):

    model = model.replace('Canon EOS ', '')
    model = model.replace('Canon ', '')
    model = model.replace('EOS ', '')

    # 末尾 m1~m10 (不区分大小写) -> Mark I~X
    # 注意: 必须先匹配 m10, 否则会被 m1 误匹配
    model = re.sub(r'(?i)m10$', 'Mark X', model)
    model = re.sub(r'(?i)m9$', 'Mark IX', model)
    model = re.sub(r'(?i)m8$', 'Mark VIII', model)
    model = re.sub(r'(?i)m7$', 'Mark VII', model)
    model = re.sub(r'(?i)m6$', 'Mark VI', model)
    model = re.sub(r'(?i)m5$', 'Mark V', model)
    model = re.sub(r'(?i)m4$', 'Mark IV', model)
    model = re.sub(r'(?i)m3$', 'Mark III', model)
    model = re.sub(r'(?i)m2$', 'Mark II', model)
    model = re.sub(r'(?i)m1$', 'Mark I', model)

    return model.strip()


# =========================================================
# 机型名称简化 - Sony
#
# 索尼机型直接显示，例如:
# ILCE-7RM2 -> ILCE-7RM2
# ILCE-7M3 -> ILCE-7M3
#
# 仅去除可能存在的 "SONY " 前缀
# =========================================================
def _simplify_sony(model):

    # 去掉品牌前缀 (如果存在)
    model = re.sub(r'(?i)^sony\s+', '', model)

    return model.strip()


# =========================================================
# 机型名称简化 - Nikon
#
# NIKON Z6_3   -> Z6 Mark III
# NIKON Z5_2   -> Z5 Mark II
# NIKON D810   -> D810
# NIKON Z 6III -> Z6 Mark III  (兼容已带III的写法)
#
# 规则:
# 1. 去掉 NIKON CORPORATION / NIKON 前缀
# 2. 末尾 _N -> Mark <罗马数字>
# 3. 普通机型 (如 D810/Z5/Z6) 保持原样
# =========================================================
def _simplify_nikon(model):

    # 去掉品牌前缀
    model = re.sub(r'(?i)^nikon\s+corporation\s+', '', model)
    model = re.sub(r'(?i)^nikon\s+', '', model)

    # 处理 Z6_3 / Z5_2 这类下划线接数字的写法
    m = re.search(r'_(\d+)$', model)
    if m:
        num = m.group(1)
        roman = _ROMAN_MAP.get(num, num)
        model = re.sub(r'_\d+$', f' Mark {roman}', model)

    # 去掉机型中间多余的空格 (如 Z 6 -> Z6)
    model = re.sub(r'^([A-Za-z])\s+(\d)', r'\1\2', model)

    return model.strip()


# =========================================================
# 机型名称简化 (按品牌分流)
# =========================================================
def simplify_camera_model(model, brand='canon'):

    model = str(model).strip()

    if brand == 'sony':
        return _simplify_sony(model)
    if brand == 'nikon':
        return _simplify_nikon(model)
    return _simplify_canon(model)


# =========================================================
# EXIF 读取
# =========================================================
def read_exif(image_stream):

    image_stream.seek(0)

    tags = exifread.process_file(
        image_stream,
        details=False
    )

    def get_tag(name, default='--'):
        return str(tags.get(name, default))

    # -----------------------------------------------------
    # 相机制造商 (品牌识别)
    # -----------------------------------------------------
    raw_make = get_tag('Image Make', '')
    brand = detect_brand(raw_make)

    # -----------------------------------------------------
    # 相机型号
    # -----------------------------------------------------
    raw_model = get_tag(
        'Image Model',
        'Canon EOS R6m2'
    )

    model = simplify_camera_model(raw_model, brand=brand)

    # -----------------------------------------------------
    # 焦距
    # -----------------------------------------------------
    focal = get_tag(
        'EXIF FocalLength',
        '35'
    )

    if '/' in focal:

        try:

            a, b = focal.split('/')

            focal = str(
                round(float(a) / float(b))
            )

        except:
            pass

    # -----------------------------------------------------
    # 光圈
    # -----------------------------------------------------
    fnumber = get_tag(
        'EXIF FNumber',
        '1.4'
    )

    if '/' in fnumber:

        try:

            a, b = fnumber.split('/')

            fnumber = round(
                float(a) / float(b),
                1
            )

        except:
            pass

    # -----------------------------------------------------
    # 快门
    # -----------------------------------------------------
    exposure = get_tag(
        'EXIF ExposureTime',
        '1/100'
    )

    # -----------------------------------------------------
    # ISO
    # -----------------------------------------------------
    iso = get_tag(
        'EXIF ISOSpeedRatings',
        '100'
    )

    # -----------------------------------------------------
    # 时间
    # -----------------------------------------------------
    dt = get_tag(
        'EXIF DateTimeOriginal',
        ''
    )

    try:

        dt_obj = datetime.strptime(
            dt,
            '%Y:%m:%d %H:%M:%S'
        )

        dt = dt_obj.strftime(
            '%Y.%m.%d %H:%M'
        )

    except:

        dt = datetime.now().strftime(
            '%Y.%m.%d %H:%M'
        )

    # -----------------------------------------------------
    # 镜头型号
    #
    # 完整显示，不做简化
    # -----------------------------------------------------
    lens = get_tag(
        'EXIF LensModel',
        ''
    )

    if lens in ('--', ''):
        lens = get_tag(
            'MakerNote LensModel',
            ''
        )

    if lens in ('--', ''):
        lens = get_tag(
            'EXIF LensSpecification',
            'Lens'
        )

    lens = str(lens).strip()
    if lens == '--' or lens == '':
        lens = 'Lens'

    return {
        'brand': brand,
        'raw_make': raw_make,
        'model': model,
        'raw_model': raw_model,
        'focal': focal,
        'fnumber': fnumber,
        'exposure': exposure,
        'iso': iso,
        'datetime': dt,
        'lens': lens
    }


# =========================================================
# 竖屏排版参数
#
# 以后主要修改这里
# =========================================================
portrait_config = {

    # =====================================================
    # 白边高度
    #
    # 0.11 = 图片高度11%
    #
    # 越大：
    # 白边越高
    # =====================================================
    "watermark_height_scale": 0.11,

    # =====================================================
    # 左右边距
    #
    # 控制：
    # logo距离左边
    # EXIF距离右边
    #
    # 越大：
    # 越往中间
    # =====================================================
    "side_padding_scale": 0.04,

    # =====================================================
    # 灰线顶部位置
    #
    # 越小越靠上
    # =====================================================
    "line_top_scale": 0.20,

    # =====================================================
    # 灰线底部位置
    #
    # 越大越靠下
    # =====================================================
    "line_bottom_scale": 0.80,

    # =====================================================
    # 灰线粗细
    # =====================================================
    "line_width": 10,

    # =====================================================
    # Logo大小 (默认值, 兜底用)
    #
    # 0.80 = logo高度
    # 等于白边高度80%
    #
    # 越大logo越大
    # =====================================================
    "logo_scale": 0.5,

    # =====================================================
    # Logo大小 (按品牌单独配置, 竖屏)
    #
    # 优先级高于 logo_scale
    # 想单独调整某个品牌, 改这里对应的值即可
    #
    # 越大logo越大
    # =====================================================
    "brand_logo_scales": {
        "canon": 0.5,
        "sony": 0.5,
        "nikon": 0.65,
    },

    # =====================================================
    # logo上下偏移
    #
    # 正数：
    # 往下移动
    #
    # 负数：
    # 往上移动
    # =====================================================
    "logo_y_offset": 0,

    # =====================================================
    # 主机型字体大小
    # =====================================================
    "model_font_scale": 0.21,

    # =====================================================
    # EXIF字体大小
    # =====================================================
    "exif_font_scale": 0.18,

    # =====================================================
    # nickname/时间字体大小
    # =====================================================
    "small_font_scale": 0.16,

    # =====================================================
    # 文字距离灰线距离
    #
    # 控制：
    # 机型尾部 → 灰线 距离
    # 灰线 → EXIF头部 距离
    #
    # (两边对称, 同一个数值)
    #
    # 越大：
    # 文字离灰线越远
    # =====================================================
    "text_to_line_distance_scale": 0.025,

    # =====================================================
    # 第一行Y位置
    #
    # 控制：
    # 机型
    # EXIF参数
    # =====================================================
    "top_row_y_scale": 0.28,

    # =====================================================
    # 第二行Y位置
    #
    # 控制：
    # nickname
    # 时间
    # =====================================================
    "bottom_row_y_scale": 0.53,

    # =====================================================
    # EXIF参数之间间距
    #
    # 例如：
    # 35mm   f/1.4   1/100s   ISO100
    #
    # 这里直接改空格即可
    # =====================================================
    "exif_spacing": " "
}


# =========================================================
# 横屏排版参数
# =========================================================
landscape_config = {

    # =====================================================
    # 白边高度
    #
    # 0.13 = 图片高度13%
    #
    # 越大：
    # 白边越高
    # =====================================================
    "watermark_height_scale": 0.13,

    # =====================================================
    # 左右边距
    #
    # 控制：
    # logo距离左边
    # EXIF距离右边
    #
    # 越大：
    # 越往中间
    # =====================================================
    "side_padding_scale": 0.03,

    # =====================================================
    # 灰线顶部位置
    #
    # 越小越靠上
    # =====================================================
    "line_top_scale": 0.20,

    # =====================================================
    # 灰线底部位置
    #
    # 越大越靠下
    # =====================================================
    "line_bottom_scale": 0.8,

    # =====================================================
    # 灰线粗细
    # =====================================================
    "line_width": 10,

    # =====================================================
    # Logo大小 (默认值, 兜底用)
    #
    # 0.6 = logo高度
    # 等于白边高度60%
    #
    # 越大logo越大
    # =====================================================
    "logo_scale": 0.56,

    # =====================================================
    # Logo大小 (按品牌单独配置, 横屏)
    #
    # 优先级高于 logo_scale
    # 想单独调整某个品牌, 改这里对应的值即可
    #
    # 越大logo越大
    # =====================================================
    "brand_logo_scales": {
        "canon": 0.56,
        "sony": 0.56,
        "nikon": 0.56,
    },

    # =====================================================
    # logo上下偏移
    #
    # 正数：
    # 往下移动
    #
    # 负数：
    # 往上移动
    # =====================================================
    "logo_y_offset": 0,

    # =====================================================
    # 主机型字体大小
    # =====================================================
    "model_font_scale": 0.25,

    # =====================================================
    # EXIF字体大小
    # =====================================================
    "exif_font_scale": 0.23,

    # =====================================================
    # nickname/时间字体大小
    # =====================================================
    "small_font_scale": 0.16,

    # =====================================================
    # 文字距离灰线距离
    #
    # 控制：
    # 机型尾部 → 灰线 距离
    # 灰线 → EXIF头部 距离
    #
    # (两边对称, 同一个数值)
    #
    # 越大：
    # 文字离灰线越远
    # =====================================================
    "text_to_line_distance_scale": 0.020,

    # =====================================================
    # 第一行Y位置
    #
    # 控制：
    # 机型
    # EXIF参数
    # =====================================================
    "top_row_y_scale": 0.25,

    # =====================================================
    # 第二行Y位置
    #
    # 控制：
    # nickname
    # 时间
    # =====================================================
    "bottom_row_y_scale": 0.55,

    # =====================================================
    # EXIF参数之间间距
    #
    # 例如：
    # 35mm   f/1.4   1/100s   ISO100
    #
    # 这里直接改空格即可
    # =====================================================
    "exif_spacing": "  "
}


# =========================================================
# 样式三排版参数
#
# 模糊背景边框 + 圆角主图 + 阴影 + 居中文字
# =========================================================
style3_config = {

    # =====================================================
    # 四周边框宽度比例
    #
    # 参考样式二：底部白边的50% (相对图片高度)
    # 这里直接基于图片"短边"取值，
    # 让横竖屏视觉效果一致
    # =====================================================
    "border_scale": 0.055,

    # =====================================================
    # 底部额外高度
    #
    # 用于放置 logo + 机型 / 曝光参数
    # 相对图片高度
    # =====================================================
    "bottom_extra_scale": 0.055,

    # =====================================================
    # 主图圆角半径
    #
    # 相对图片"短边"
    # 越大越圆润
    # =====================================================
    "corner_radius_scale": 0.05,

    # =====================================================
    # 背景模糊强度
    #
    # 相对画布"短边"
    # 越大越模糊
    # =====================================================
    "blur_radius_scale": 0.05,

    # =====================================================
    # 背景拉伸放大倍数
    #
    # 用作模糊边框的源图必须比画布更大，
    # 这样裁切后边缘像素不会出现透明
    # =====================================================
    "bg_zoom": 1.25,

    # =====================================================
    # 阴影
    # =====================================================
    "shadow_offset_scale": 0.015,
    "shadow_blur_scale": 0.03,
    "shadow_alpha": 150,

    # =====================================================
    # 主机型字号 (相对底部文字区高度)
    # =====================================================
    "model_font_scale": 0.2,

    # =====================================================
    # 曝光参数字号
    # =====================================================
    "exif_font_scale": 0.16,

    # =====================================================
    # logo 高度 (相对主机型字号)
    #
    # 越大 logo 越突出，
    # 1.5 ≈ logo 比文字高 50%
    # =====================================================
    "logo_height_to_font": 1.2,

    # =====================================================
    # logo 与机型名之间的间距 (相对主机型字号)
    # =====================================================
    "logo_text_gap_to_font": 0.55,

    # =====================================================
    # 两行文字之间的间距 (相对底部文字区高度)
    # =====================================================
    "row_gap_scale": 0.15,
}


# =========================================================
# 给图片应用圆角
# =========================================================
def _apply_rounded_corners(img, radius):

    img = img.convert('RGBA')

    mask = Image.new('L', img.size, 0)

    mask_draw = ImageDraw.Draw(mask)

    mask_draw.rounded_rectangle(
        (0, 0, img.size[0], img.size[1]),
        radius=radius,
        fill=255
    )

    rounded = Image.new('RGBA', img.size, (0, 0, 0, 0))

    rounded.paste(img, (0, 0), mask)

    return rounded


# =========================================================
# 样式三渲染
# =========================================================
def _render_style3(
    image,
    exif_info,
    base_name,
    original_icc,
    original_exif,
    img_format
):

    config = style3_config

    width, height = image.size

    short_side = min(width, height)

    # =====================================================
    # 边框宽度
    #
    # 顶/左/右 = border (基于短边)
    # 底部 = border + bottom_extra (额外放文字)
    # =====================================================
    border = int(short_side * config["border_scale"])

    bottom_extra = int(height * config["bottom_extra_scale"])

    canvas_w = width + border * 2
    canvas_h = height + border * 2 + bottom_extra

    # =====================================================
    # 背景：低分辨率快速模糊后放大到画布尺寸
    #
    # 原理：背景被强模糊后肉眼看不出分辨率差异。
    # 先缩小到固定小尺寸做模糊（GaussianBlur 复杂度 ~ 像素数 * 半径），
    # 再放大到画布尺寸，速度比直接对全尺寸大图模糊快 10-100 倍。
    # 不影响最终画质，因为：
    # 1. 背景区域只占画布外圈一小部分（被主图遮挡大部分）
    # 2. 强模糊本身就丢失高频细节，小图模糊+放大与大图模糊几乎等价
    # =====================================================
    bg_small_max = 256

    if max(width, height) <= bg_small_max:
        bg_small_w, bg_small_h = width, height
    elif width >= height:
        bg_small_w = bg_small_max
        bg_small_h = max(1, int(height * bg_small_max / width))
    else:
        bg_small_h = bg_small_max
        bg_small_w = max(1, int(width * bg_small_max / height))

    background_small = image.resize(
        (bg_small_w, bg_small_h),
        Image.Resampling.BILINEAR
    )

    # 与原始模糊视觉等效的小图模糊半径
    target_blur = min(canvas_w, canvas_h) * config["blur_radius_scale"]
    small_blur = max(
        2.0,
        target_blur * min(bg_small_w, bg_small_h)
        / min(canvas_w, canvas_h)
    )

    background_small = background_small.filter(
        ImageFilter.GaussianBlur(radius=small_blur)
    )

    # 直接放大到画布尺寸 (BILINEAR 已足够, 因为内容是模糊的)
    background = background_small.resize(
        (canvas_w, canvas_h),
        Image.Resampling.BILINEAR
    )

    # 轻微压暗 (ImageEnhance.Brightness 是 C 级实现,
    # 比 Image.eval(lambda) 快很多)
    background = ImageEnhance.Brightness(background).enhance(0.78)

    canvas = background.convert('RGBA')

    # =====================================================
    # 主图圆角 mask (不创建中间 RGBA 副本)
    # =====================================================
    corner_radius = int(
        short_side
        * config["corner_radius_scale"]
    )

    img_mask = Image.new('L', (width, height), 0)
    mask_draw = ImageDraw.Draw(img_mask)
    mask_draw.rounded_rectangle(
        (0, 0, width, height),
        radius=corner_radius,
        fill=255
    )

    img_x = border
    img_y = border

    # =====================================================
    # 阴影 (在较低分辨率下生成后放大, 提速)
    #
    # 阴影本身就是模糊的, 缩放不影响视觉效果。
    # =====================================================
    shadow_offset = int(
        height * config["shadow_offset_scale"]
    )
    shadow_blur = int(
        height * config["shadow_blur_scale"]
    )

    shadow_pad = shadow_blur * 2

    # 全尺寸阴影画布
    sw_full = width + shadow_pad * 2
    sh_full = height + shadow_pad * 2

    # 在 1/2 分辨率下生成阴影
    shadow_scale = 0.5
    sw_small = max(1, int(sw_full * shadow_scale))
    sh_small = max(1, int(sh_full * shadow_scale))

    shadow_layer = Image.new(
        'RGBA',
        (sw_small, sh_small),
        (0, 0, 0, 0)
    )

    sd = ImageDraw.Draw(shadow_layer)
    sd.rounded_rectangle(
        (
            int(shadow_pad * shadow_scale),
            int(shadow_pad * shadow_scale),
            int((shadow_pad + width) * shadow_scale),
            int((shadow_pad + height) * shadow_scale)
        ),
        radius=max(1, int(corner_radius * shadow_scale)),
        fill=(0, 0, 0, config["shadow_alpha"])
    )

    shadow_layer = shadow_layer.filter(
        ImageFilter.GaussianBlur(radius=shadow_blur * shadow_scale)
    )

    # 放大到全尺寸
    shadow_layer = shadow_layer.resize(
        (sw_full, sh_full),
        Image.Resampling.BILINEAR
    )

    canvas.alpha_composite(
        shadow_layer,
        (
            img_x - shadow_pad,
            img_y - shadow_pad + shadow_offset
        )
    )

    # =====================================================
    # 贴主图 (直接 paste + mask, 不创建中间 RGBA 全图副本)
    #
    # 注意: 这里 image 保持原始模式(通常是 RGB),
    # 不做无损像素变换, 完整保留主图画质。
    # =====================================================
    canvas.paste(image, (img_x, img_y), img_mask)

    # =====================================================
    # 文字区
    #
    # 范围：图片下沿 → 画布底
    # 高度：border + bottom_extra
    # =====================================================
    text_area_top = img_y + height
    text_area_h = border + bottom_extra

    # =====================================================
    # 字体
    # =====================================================
    font_path = 'C:/Windows/Fonts/arial.ttf'
    bold_font_path = 'C:/Windows/Fonts/arialbd.ttf'

    if not os.path.exists(font_path):
        font_path = 'C:/Windows/Fonts/msyh.ttc'

    if not os.path.exists(bold_font_path):
        bold_font_path = 'C:/Windows/Fonts/msyhbd.ttc'
        if not os.path.exists(bold_font_path):
            bold_font_path = font_path

    model_font_size = int(
        text_area_h * config["model_font_scale"]
    )
    exif_font_size = int(
        text_area_h * config["exif_font_scale"]
    )

    model_font = ImageFont.truetype(
        bold_font_path,
        model_font_size
    )
    exif_font = ImageFont.truetype(
        font_path,
        exif_font_size
    )

    draw = ImageDraw.Draw(canvas)

    # =====================================================
    # 第一行：logo + 机型
    #
    # 不同品牌机型显示规则：
    #   canon -> raw_model (如 Canon EOS R6m2)
    #   sony  -> 简化后的 model (如 ILCE-7RM2)
    #   nikon -> 简化后的 model (如 Z6 Mark III)
    # =====================================================
    brand = exif_info.get('brand', 'canon')

    if brand == 'canon':
        model_text = exif_info.get('raw_model', exif_info['model'])
    else:
        model_text = exif_info.get('model', exif_info.get('raw_model', ''))

    # logo (按品牌选择 style3 专用 logo)
    brand_paths = LOGO_PATHS.get(brand, LOGO_PATHS['canon'])
    style3_logo_path = brand_paths.get('style3')
    normal_logo_path = brand_paths.get('normal')

    if style3_logo_path and os.path.exists(style3_logo_path):
        logo = Image.open(style3_logo_path).convert('RGBA')
    elif normal_logo_path and os.path.exists(normal_logo_path):
        # fallback: 用普通 logo
        logo = Image.open(normal_logo_path).convert('RGBA')
    else:
        # 终极 fallback: canon style3 logo
        logo = Image.open(LOGO_PATHS['canon']['style3']).convert('RGBA')

    logo_h = int(
        model_font_size
        * config["logo_height_to_font"]
    )
    logo_ratio = logo.width / logo.height
    logo_w = int(logo_h * logo_ratio)

    logo = logo.resize(
        (logo_w, logo_h),
        Image.Resampling.LANCZOS
    )

    logo_text_gap = int(
        model_font_size
        * config["logo_text_gap_to_font"]
    )

    # 机型文本宽度
    model_bbox = draw.textbbox(
        (0, 0),
        model_text,
        font=model_font
    )
    model_w = model_bbox[2] - model_bbox[0]

    # 第一行整体宽度 = logo + gap + model
    row1_w = logo_w + logo_text_gap + model_w

    # 第一行水平居中（与原图水平中心对齐）
    img_center_x = img_x + width // 2
    row1_x = img_center_x - row1_w // 2

    # =====================================================
    # 第二行：曝光参数
    # =====================================================
    exif_text = (
        f"{exif_info['focal']}mm  "
        f"F{exif_info['fnumber']}  "
        f"{exif_info['exposure']}s  "
        f"ISO{exif_info['iso']}"
    )

    exif_bbox = draw.textbbox(
        (0, 0),
        exif_text,
        font=exif_font
    )
    exif_w = exif_bbox[2] - exif_bbox[0]
    exif_h = exif_bbox[3] - exif_bbox[1]

    exif_x = img_center_x - exif_w // 2

    # =====================================================
    # 两行整体垂直居中
    #
    # 第一行：logo 与机型文字基于"视觉中心"对齐
    #         （而不是顶端对齐，避免文字看起来偏上）
    # 第二行：曝光参数同样基于墨迹中心定位
    # =====================================================
    row_gap = int(text_area_h * config["row_gap_scale"])

    # 文字真实墨迹高度（不含字体上下留白）
    model_visual_h = model_bbox[3] - model_bbox[1]
    exif_visual_h = exif_bbox[3] - exif_bbox[1]

    # 第一行的视觉高度 = logo 与文字墨迹中较大的一个
    row1_h = max(logo_h, model_visual_h)

    total_h = row1_h + row_gap + exif_visual_h

    block_top = text_area_top + (text_area_h - total_h) // 2

    # 第一行墨迹顶 / 中心 Y
    row1_top = block_top
    row1_center_y = row1_top + row1_h // 2

    # logo Y（图片）：让 logo 视觉中心与行中心对齐
    logo_y = row1_center_y - logo_h // 2

    # 机型 Y（文字）：让"墨迹中心"与行中心对齐
    # PIL 的 draw.text((x, y)) 中 y 是字体框上沿，
    # 墨迹中心相对 y 的偏移 = (bbox top + bbox bottom) / 2
    model_y = int(
        row1_center_y
        - (model_bbox[1] + model_bbox[3]) / 2
    )

    # 第二行 Y：墨迹中心居中
    row2_top = row1_top + row1_h + row_gap
    row2_center_y = row2_top + exif_visual_h // 2
    row2_y = int(
        row2_center_y
        - (exif_bbox[1] + exif_bbox[3]) / 2
    )

    # =====================================================
    # 绘制 logo
    # =====================================================
    canvas.alpha_composite(logo, (row1_x, logo_y))

    # =====================================================
    # 绘制机型 (白色)
    # =====================================================
    draw.text(
        (row1_x + logo_w + logo_text_gap, model_y),
        model_text,
        fill=(255, 255, 255, 255),
        font=model_font
    )

    # =====================================================
    # 绘制曝光参数 (白色)
    # =====================================================
    draw.text(
        (exif_x, row2_y),
        exif_text,
        fill=(255, 255, 255, 255),
        font=exif_font
    )

    # =====================================================
    # 输出图片
    # =====================================================
    out_canvas = canvas.convert('RGB')

    output = io.BytesIO()

    save_kwargs = {}
    if original_icc:
        save_kwargs['icc_profile'] = original_icc
    if original_exif:
        save_kwargs['exif'] = original_exif

    if img_format == 'JPEG':
        out_canvas.save(
            output,
            format=img_format,
            quality=100,
            subsampling=0,
            **save_kwargs
        )
        mimetype = 'image/jpeg'
        ext = 'jpg'
    elif img_format == 'PNG':
        out_canvas.save(
            output,
            format=img_format,
            **save_kwargs
        )
        mimetype = 'image/png'
        ext = 'png'
    else:
        out_canvas.save(
            output,
            format=img_format,
            quality=100,
            **save_kwargs
        )
        mimetype = f'image/{img_format.lower()}'
        ext = img_format.lower()

    output.seek(0)

    export_name = f'{base_name}_watermark.{ext}'

    return send_file(
        output,
        mimetype=mimetype,
        as_attachment=False,
        download_name=export_name
    )


# =========================================================
# 首页
# =========================================================
@app.route('/')
def index():
    return render_template('index.html')


# =========================================================
# 图片处理
# =========================================================
@app.route('/process', methods=['POST'])
def process_image():

    # =====================================================
    # 获取图片
    # =====================================================
    file = request.files['image']

    # =====================================================
    # 获取水印样式
    #
    # watermark_style:
    #   'style1' -> 水印一：仅底部白边 (默认)
    #   'style2' -> 水印二：上左右也有白边（宽度为底部的50%）
    # =====================================================
    watermark_style = request.form.get(
        'watermark_style',
        'style1'
    )

    # =====================================================
    # 获取显示模式
    #
    # display_mode:
    #   'nickname' -> 显示自定义昵称 (默认)
    #   'lens'     -> 显示 EXIF 中的镜头型号
    # =====================================================
    display_mode = request.form.get(
        'display_mode',
        'nickname'
    )

    # =====================================================
    # 获取nickname
    # =====================================================
    nickname = request.form.get(
        'nickname',
        '所有二刺螈都得死'
    )
    
    # 限制nickname长度 (最多10个中文或20个英文)
    current_len = 0
    truncated_nickname = ""
    for c in nickname:
        # 中文及全角字符算2个长度，英文及半角算1个
        if '\u4e00' <= c <= '\u9fff' or '\uff00' <= c <= '\uffef' or '\u3000' <= c <= '\u303f':
            current_len += 2
        else:
            current_len += 1
            
        if current_len > 20:
            break
        truncated_nickname += c
        
    nickname = truncated_nickname

    # =====================================================
    # 文件名
    # =====================================================
    original_filename = file.filename

    base_name = os.path.splitext(
        original_filename
    )[0]

    # =====================================================
    # 读取EXIF
    # =====================================================
    exif_info = read_exif(file.stream)

    file.stream.seek(0)

    # =====================================================
    # 自动修正手机照片方向
    # =====================================================
    image = Image.open(file.stream)
    
    img_format = image.format if image.format else 'JPEG'
    if img_format not in ['JPEG', 'PNG', 'WEBP']:
        img_format = 'JPEG'

    original_icc = image.info.get('icc_profile')
    raw_exif = image.info.get('exif')

    image = ImageOps.exif_transpose(image)

    # =====================================================
    # 重置 EXIF Orientation
    #
    # 像素已经被 exif_transpose 物理转正
    # 把 Orientation 标签置为 1 (正常方向)
    # 避免浏览器/查看器再旋转一次造成画面横倒
    #
    # 其他 EXIF 字段 (机型/光圈/快门/ISO/GPS 等)
    # 全部保留
    # =====================================================
    original_exif = None
    if raw_exif:
        try:
            exif_dict = piexif.load(raw_exif)
            if "0th" in exif_dict:
                exif_dict["0th"][piexif.ImageIFD.Orientation] = 1
            # 缩略图也一并清掉, 避免显示老的旋转过的缩略图
            exif_dict["thumbnail"] = None
            if "1st" in exif_dict:
                exif_dict["1st"] = {}
            original_exif = piexif.dump(exif_dict)
        except Exception:
            original_exif = None

    image = image.convert('RGB')

    width, height = image.size

    # =====================================================
    # 判断横竖屏
    # =====================================================
    is_portrait = height > width

    # =====================================================
    # 样式三：模糊背景边框 + 圆角主图 + 阴影 + 居中文字
    #
    # 此分支自包含完整流程并提前 return，
    # 不走下方样式一/样式二的渲染逻辑
    # =====================================================
    if watermark_style == 'style3':
        return _render_style3(
            image=image,
            exif_info=exif_info,
            base_name=base_name,
            original_icc=original_icc,
            original_exif=original_exif,
            img_format=img_format
        )

    # =====================================================
    # 自动选择配置
    # =====================================================
    if is_portrait:
        config = portrait_config
    else:
        config = landscape_config

    # =====================================================
    # 白边高度（底部）
    # =====================================================
    watermark_height = int(
        height
        * config["watermark_height_scale"]
    )

    # =====================================================
    # 三边白边宽度
    #
    # 样式一: 0 (仅底部白边)
    # 样式二: 底部白边的 50%
    # =====================================================
    if watermark_style == 'style2':
        side_border = int(watermark_height * 0.5)
    else:
        side_border = 0

    # =====================================================
    # 新画布尺寸
    #
    # 样式二在原图基础上:
    # 上 / 左 / 右各加 side_border
    # 下方仍是 watermark_height (用于绘制水印)
    # =====================================================
    new_width = width + side_border * 2
    new_height = height + watermark_height + side_border

    # =====================================================
    # 创建画布
    # =====================================================
    canvas = Image.new(
        'RGB',
        (new_width, new_height),
        'white'
    )

    # 原图粘贴位置:
    # 样式一: (0, 0)
    # 样式二: (side_border, side_border)
    canvas.paste(image, (side_border, side_border))

    draw = ImageDraw.Draw(canvas)

    # =====================================================
    # 字体
    # =====================================================
    font_path = 'C:/Windows/Fonts/arial.ttf'
    cn_font_path = 'C:/Windows/Fonts/msyh.ttc'

    if not os.path.exists(font_path):
        font_path = 'C:/Windows/Fonts/msyh.ttc'
        
    if not os.path.exists(cn_font_path):
        cn_font_path = font_path

    # =====================================================
    # 主机型字体 (加粗)
    # =====================================================
    bold_font_path = 'C:/Windows/Fonts/arialbd.ttf'
    if not os.path.exists(bold_font_path):
        bold_font_path = 'C:/Windows/Fonts/msyhbd.ttc'
        if not os.path.exists(bold_font_path):
            bold_font_path = font_path

    big_font = ImageFont.truetype(
        bold_font_path,
        int(
            watermark_height
            * config["model_font_scale"]
        )
    )

    # =====================================================
    # EXIF字体
    # =====================================================
    info_font = ImageFont.truetype(
        font_path,
        int(
            watermark_height
            * config["exif_font_scale"]
        )
    )

    # =====================================================
    # 小字体 (使用支持中文的字体)
    # =====================================================
    small_font = ImageFont.truetype(
        cn_font_path,
        int(
            watermark_height
            * config["small_font_scale"]
        )
    )

    # =====================================================
    # 左右边距
    #
    # 控制：
    # logo距离左边
    # 右侧参数距离右边
    # =====================================================
    side_padding = int(
        width
        * config["side_padding_scale"]
    )

    # =====================================================
    # EXIF间距
    #
    # 控制：
    # 35mm   f/1.4   1/100s   ISO100
    # =====================================================
    spacing = config["exif_spacing"]

    # =====================================================
    # EXIF文字
    # =====================================================
    exif_text = (
        f"{exif_info['focal']}mm"
        f"{spacing}"
        f"f/{exif_info['fnumber']}"
        f"{spacing}"
        f"{exif_info['exposure']}s"
        f"{spacing}"
        f"ISO{exif_info['iso']}"
    )

    # =====================================================
    # 测量 EXIF 文字宽度
    # =====================================================
    try:
        exif_text_bbox = draw.textbbox(
            (0, 0),
            exif_text,
            font=info_font
        )
        exif_text_width = (
            exif_text_bbox[2]
            - exif_text_bbox[0]
        )
    except AttributeError:
        exif_text_width = info_font.getsize(exif_text)[0]

    # =====================================================
    # 测量时间文字宽度
    # =====================================================
    try:
        time_text_bbox = draw.textbbox(
            (0, 0),
            exif_info['datetime'],
            font=small_font
        )
        time_text_width = (
            time_text_bbox[2]
            - time_text_bbox[0]
        )
    except AttributeError:
        time_text_width = small_font.getsize(
            exif_info['datetime']
        )[0]

    # =====================================================
    # 测量机型文字宽度
    # =====================================================
    try:
        model_text_bbox = draw.textbbox(
            (0, 0),
            exif_info['model'],
            font=big_font,
            stroke_width=1
        )
        model_text_width = (
            model_text_bbox[2]
            - model_text_bbox[0]
        )
    except AttributeError:
        model_text_width = big_font.getsize(
            exif_info['model']
        )[0]

    # =====================================================
    # 布局逻辑 (从右往左反推)
    #
    # 1. EXIF 尾部距离右边 = side_padding
    # 2. EXIF 起点 = width - side_padding - exif_text_width
    # 3. 灰线 = EXIF起点 - text_distance
    # 4. 机型尾部 = 灰线 - text_distance
    # 5. 机型起点 = 机型尾部 - model_text_width
    # 6. logo 左边距 = side_padding (与 EXIF 右边距对称)
    # =====================================================
    text_distance = int(
        width
        * config["text_to_line_distance_scale"]
    )

    # EXIF 起点 X
    # 让 EXIF 尾部距离 "图片右边" = side_padding
    # 样式二: 图片右边在画布上 = side_border + width
    right_text_x = (
        side_border
        + width
        - side_padding
        - exif_text_width
    )

    # 时间起点 X (与 EXIF 头部对齐)
    time_x = right_text_x

    # 灰线 X
    line_x = right_text_x - text_distance

    # 机型起点 X (让机型尾部距离灰线 = text_distance)
    left_text_x = line_x - text_distance - model_text_width

    # =====================================================
    # Logo (按品牌选择)
    # =====================================================
    brand = exif_info.get('brand', 'canon')
    logo_path = LOGO_PATHS.get(brand, {}).get('normal', LOGO_PATHS['canon']['normal'])
    
    if not os.path.exists(logo_path):
        logo_path = LOGO_PATHS['canon']['normal']
    
    logo = Image.open(logo_path).convert('RGBA')

    # =====================================================
    # logo高度 (按品牌读取)
    # =====================================================
    # 优先从 brand_logo_scales 读取，没有则用默认 logo_scale
    brand_logo_scales = config.get("brand_logo_scales", {})
    logo_scale = brand_logo_scales.get(brand, config["logo_scale"])
    
    logo_height = int(
        watermark_height
        * logo_scale
    )

    logo_ratio = logo.width / logo.height

    logo_width = int(
        logo_height
        * logo_ratio
    )

    logo = logo.resize(
        (logo_width, logo_height)
    )

    # =====================================================
    # logo左边位置
    #
    # 样式二: 图片左边在画布上 = side_border
    # =====================================================
    logo_x = side_border + side_padding

    # =====================================================
    # logo上下位置
    #
    # 样式二: 图片底边在画布上 = side_border + height
    # =====================================================
    logo_y = int(
        side_border
        +
        height
        +
        (
            watermark_height
            - logo_height
        ) / 2
        +
        config["logo_y_offset"]
    )

    canvas.paste(
        logo,
        (logo_x, logo_y),
        logo
    )

    # =====================================================
    # 第一行Y
    #
    # 控制：
    # 机型
    # EXIF
    #
    # 样式二: 图片底边在画布上 = side_border + height
    # =====================================================
    top_row_y = int(
        side_border
        +
        height
        +
        watermark_height
        * config["top_row_y_scale"]
    )

    # =====================================================
    # 第二行Y
    #
    # 控制：
    # nickname
    # 时间
    # =====================================================
    bottom_row_y = int(
        side_border
        +
        height
        +
        watermark_height
        * config["bottom_row_y_scale"]
    )

    # =====================================================
    # 灰线顶部
    # =====================================================
    line_top = int(
        side_border
        +
        height
        +
        watermark_height
        * config["line_top_scale"]
    )

    # =====================================================
    # 灰线底部
    # =====================================================
    line_bottom = int(
        side_border
        +
        height
        +
        watermark_height
        * config["line_bottom_scale"]
    )

    # =====================================================
    # 绘制灰线
    # =====================================================
    draw.line(
        (
            line_x,
            line_top,
            line_x,
            line_bottom
        ),
        fill=(180, 180, 180),
        width=config["line_width"]
    )

    # =====================================================
    # 第二行左侧文字
    #
    # display_mode = 'nickname' -> 自定义昵称
    # display_mode = 'lens'     -> EXIF 镜头型号 (完整显示)
    #
    # 与机型尾部右对齐
    # 机型尾部 X = left_text_x + model_text_width
    # 文字起点 X = 机型尾部 - 文字宽度
    # =====================================================
    if display_mode == 'lens':
        bottom_left_text = exif_info.get('lens', 'Lens')
    else:
        bottom_left_text = nickname

    model_right_x = left_text_x + model_text_width

    try:
        bottom_left_bbox = draw.textbbox(
            (0, 0),
            bottom_left_text,
            font=small_font
        )
        bottom_left_width = (
            bottom_left_bbox[2]
            - bottom_left_bbox[0]
        )
    except AttributeError:
        bottom_left_width = small_font.getsize(bottom_left_text)[0]

    bottom_left_x = model_right_x - bottom_left_width

    # =====================================================
    # 绘制机型
    # =====================================================
    draw.text(
        (left_text_x, top_row_y),
        exif_info['model'],
        fill='black',
        font=big_font,
        stroke_width=1,
        stroke_fill='black'
    )

    # =====================================================
    # 绘制第二行左侧文字 (昵称 或 镜头, 与机型尾部对齐)
    # =====================================================
    draw.text(
        (bottom_left_x, bottom_row_y),
        bottom_left_text,
        fill=(120, 120, 120),
        font=small_font
    )

    # =====================================================
    # 绘制EXIF (右对齐)
    # =====================================================
    draw.text(
        (right_text_x, top_row_y),
        exif_text,
        fill='black',
        font=info_font
    )

    # =====================================================
    # 绘制时间 (右对齐)
    # =====================================================
    draw.text(
        (time_x, bottom_row_y),
        exif_info['datetime'],
        fill=(120, 120, 120),
        font=small_font
    )

    # =====================================================
    # 输出图片
    # =====================================================
    output = io.BytesIO()

    save_kwargs = {}
    if original_icc:
        save_kwargs['icc_profile'] = original_icc
    if original_exif:
        save_kwargs['exif'] = original_exif

    if img_format == 'JPEG':
        canvas.save(
            output,
            format=img_format,
            quality=100,
            subsampling=0,
            **save_kwargs
        )
        mimetype = 'image/jpeg'
        ext = 'jpg'
    elif img_format == 'PNG':
        canvas.save(
            output,
            format=img_format,
            **save_kwargs
        )
        mimetype = 'image/png'
        ext = 'png'
    else:
        canvas.save(
            output,
            format=img_format,
            quality=100,
            **save_kwargs
        )
        mimetype = f'image/{img_format.lower()}'
        ext = img_format.lower()

    output.seek(0)

    # =====================================================
    # 导出文件名
    #
    # 1.jpg
    # ->
    # 1_watermark.jpg
    # =====================================================
    export_name = f'{base_name}_watermark.{ext}'

    return send_file(
        output,
        mimetype=mimetype,
        as_attachment=False,
        download_name=export_name
    )


# =========================================================
# 启动
# =========================================================
if __name__ == '__main__':

    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True
    )