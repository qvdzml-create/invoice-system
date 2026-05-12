import re
import os


def parse_invoice_pdf(pdf_path):
    """解析PDF发票，返回提取的字段字典"""
    try:
        import pdfplumber
    except ImportError:
        return {'error': '缺少 pdfplumber 依赖，请执行: pip install pdfplumber'}

    if not os.path.exists(pdf_path):
        return {'error': 'PDF文件不存在'}

    try:
        with pdfplumber.open(pdf_path) as pdf:
            full_text = ''
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    full_text += text + '\n'
    except Exception as e:
        return {'error': f'PDF解析失败: {str(e)}'}

    if not full_text.strip():
        return {'error': '未能从PDF中提取到文本，可能为图片型PDF'}

    return extract_fields_from_text(full_text)


def extract_fields_from_text(text):
    """从发票文本中提取各个字段"""
    # 将 Kangxi Radicals 转换为普通汉字
    text = text.replace('\u2F26', '\u5B50')  # ⼦ → 子

    result = {}

    # 发票类型
    invoice_type_patterns = [
        r'(增值税电子专用发票|增值税电子普通发票|增值税专用发票|增值税普通发票|深圳电子普通发票|电子发票[（(](?:普通发票|专用发票)[)）]|电子发票|机动车销售统一发票|通用机打发票)',
    ]
    result['invoice_type'] = multi_match(text, invoice_type_patterns)

    # 发票代码 - 10位或12位数字
    code_patterns = [
        r'发票代码[：:]\s*(\d{10,12})',
        r'代码[：:]\s*(\d{10,12})',
        r'(\d{12})\s*发票号码',
    ]
    result['invoice_code'] = multi_match(text, code_patterns)

    # 发票号码 - 8位或20位数字
    number_patterns = [
        r'发票号码[：:]\s*(\d{8,20})',
        r'号码[：:]\s*(\d{8,20})',
        r'No[.:]?\s*(\d{8,20})',
        r'统一发票监.*?\n\s*(\d{20})',
        r'(\d{20})',
    ]
    result['invoice_number'] = multi_match(text, number_patterns)

    # 开票日期
    date_patterns = [
        r'开票日期[：:]\s*(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}[日]?|\d{4}[年/-]\d{1,2}[月/-]\d{1,2})',
        r'日期[：:]\s*(\d{4}[年/-]\d{1,2}[月/-]\d{1,2}[日]?)',
        r'国家税务总局\s+(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)',
        r'(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)',
    ]
    date_str = multi_match(text, date_patterns)
    result['invoice_date'] = normalize_date(date_str)

    # 检验码 - 通常在右上角，20位数字
    verify_patterns = [
        r'校验码[：:]\s*(\d{20})',
        r'检验码[：:]\s*(\d{20})',
    ]
    result['verify_code'] = multi_match(text, verify_patterns)

    # 密码区
    password_patterns = [
        r'密\s*码\s*区\s*([\s\S]{50,500})',
    ]
    result['password_area'] = multi_match(text, password_patterns)
    if result['password_area']:
        result['password_area'] = result['password_area'].replace('\n', ' ').strip()[:200]

    # 购买方信息
    result['buyer_name'] = extract_buyer_name(text)
    result['buyer_tax_id'] = extract_buyer_tax_id(text)
    result['buyer_address_phone'] = extract_buyer_address_phone(text)
    result['buyer_account'] = extract_buyer_account(text)

    # 销售方信息
    result['seller_name'] = extract_seller_name(text)
    result['seller_tax_id'] = extract_seller_tax_id(text)
    result['seller_address_phone'] = extract_seller_address_phone(text)

    # 金额信息
    result['amount'] = extract_amount(text)
    result['tax_amount'] = extract_tax_amount(text)
    result['total_amount'] = extract_total_amount(text)
    result['total_amount_cn'] = extract_total_amount_cn(text)

    # 开票项目/明细
    result['item_category'] = extract_item_category(text)
    result['item_details'] = extract_item_details(text)

    # 其他字段
    result['remarks'] = extract_remarks(text)
    result['payee'] = extract_payee(text)
    result['reviewer'] = extract_reviewer(text)
    result['drawer'] = extract_drawer(text)

    # 发票标题（第一行非空内容）
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    result['invoice_title'] = lines[0] if lines else ''

    return result


def multi_match(text, patterns):
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ''


def normalize_date(date_str):
    if not date_str:
        return ''
    # 去除多余空格
    date_str = re.sub(r'\s+', '', date_str)
    date_str = date_str.replace('年', '-').replace('月', '-').replace('日', '')
    parts = date_str.split('-')
    if len(parts) == 3:
        year, month, day = parts
        month = month.zfill(2)
        day = day.zfill(2)
        return f"{year}-{month}-{day}"
    return date_str


def extract_buyer_name(text):
    """提取购买方名称"""
    # [^\S\n]* 匹配不换行的空白字符，避免跨行匹配到无关内容
    patterns = [
        r'购[买方]?名称[：:][^\S\n]*([^\n]{2,50})',
        r'购买方.*?名称[：:][^\S\n]*([^\n]{2,50})',
        r'名\s*称[：:][^\S\n]*([^\n]{2,50})[^\S\n]*纳税人识别号',
        r'买方.*?名称\s*[:：][^\S\n]*([^\n]{2,50})',
        r'买[^\S\n]*名称[：:][^\S\n]*([^\n]{2,50})',
        r'购[^\S\n]*名称[：:][^\S\n]*([^\n]{2,50})',
        r'购[^\S\n]*名[^\S\n]*称[：:][^\S\n]*([^\n]{2,50})',
        r'买方[^\S\n]+([^\n]{2,50})[^\S\n]+卖方',
        r'买[^\S\n]+方[^\S\n]+([^\n]{2,50})[^\S\n]+销[^\S\n]+方',
    ]
    name = multi_match(text, patterns)
    # 处理同一条行包含买卖双方的情况
    # sep 前面必须是空白字符，避免误截公司名称中的字（如"营销"含"销"）
    if name:
        for sep in ['售', '销', '密']:
            m = re.search(rf'\s{re.escape(sep)}', name)
            if m:
                name = name[:m.start()].strip()
                break
    # 过滤掉捕获到表头残留的垃圾值（如"售 名称："）
    if name and re.search(r'名称[：:]', name):
        name = ''
    # 兜底：深圳市税务局/税务局后面的第一家公司名
    if not name:
        match = re.search(r'(?:深圳市税务局|税务局)[^\S\n]*\n[^\S\n]*([^\n\d]{2,50}(?:公司|店|厂|中心|集团))', text)
        if match:
            name = match.group(1).strip()
            # 如果包含空格，取第一个（通常是购买方）
            if ' ' in name:
                name = name.split(' ')[0].strip()
    return name


def extract_buyer_tax_id(text):
    """提取购买方税号"""
    patterns = [
        r'纳税人识别号[：:]\s*([A-Z0-9]{15,20})',
        r'购.*?纳税人识别号[：:]\s*([A-Z0-9]{15,20})',
        r'税号[：:]\s*([A-Z0-9]{15,20})',
        r'统一社会信用代码[：:]\s*([A-Z0-9]{15,20})',
    ]
    result = multi_match(text, patterns)
    if result:
        return result
    # 兜底：标签和税号值分离的布局（如深圳电子普通发票竖排格式）
    # 查找包含两个税号的一行（空格分隔），取第一个
    match = re.search(r'(?:^|\n)\s*([A-Z0-9]{15,20})\s+([A-Z0-9]{15,20})\s*(?:\n|$)', text)
    if match:
        return match.group(1)
    return ''


def extract_buyer_address_phone(text):
    """提取购买方地址电话"""
    patterns = [
        r'地址、?[电话]?[：:]\s*([^\n]{5,80})',
        r'购买方.*?地址.*?[：:]\s*([^\n]{5,80})',
    ]
    return multi_match(text, patterns)


def extract_buyer_account(text):
    """提取购买方开户行及账号"""
    patterns = [
        r'开户行及账号[：:]\s*([^\n]{5,80})',
        r'开户银行[：:]\s*([^\n]{5,80})',
        r'账\s*号[：:]\s*([^\n]{5,80})',
    ]
    return multi_match(text, patterns)


def extract_seller_name(text):
    """提取销售方名称"""
    # [^\S\n]* 匹配不换行的空白字符，避免跨行匹配到无关内容
    patterns = [
        r'销[售方]?名称[：:][^\S\n]*([^\n]{2,50})',
        r'销售方.*?名称[：:][^\S\n]*([^\n]{2,50})',
        r'销售方.*?名\s*称[：:][^\S\n]*([^\n]{2,50})',
        r'售[^\S\n]*名称[：:][^\S\n]*([^\n]{2,50})',
        r'销[^\S\n]*名称[：:][^\S\n]*([^\n]{2,50})',
        r'销[^\S\n]*名[^\S\n]*称[：:][^\S\n]*([^\n]{2,50})',
        r'售[^\S\n]*名[^\S\n]*称[：:][^\S\n]*([^\n]{2,50})',
    ]
    name = multi_match(text, patterns)
    if name:
        return name
    # 兜底1：查找 "销" 字后面的公司名称（处理竖排版式）
    match = re.search(r'销[^\S\n]*\n[^\S\n]*(?:名\s*称[：:][^\S\n]*)?([^\n\d]{2,50}(?:公司|店|厂|中心|集团))', text)
    if match:
        return match.group(1).strip()
    # 兜底2：深圳市税务局/税务局后面的第二家公司名
    match = re.search(r'(?:深圳市税务局|税务局)[^\S\n]*\n[^\S\n]*[^\n]+(?:公司|店|厂|中心|集团)[^\S\n]+([^\n\d]{2,50}(?:公司|店|厂|中心|集团))', text)
    if match:
        return match.group(1).strip()
    # 兜底3：查找所有 "名 称：" 后面的公司名，取最后一个（销售方通常在底部）
    all_names = re.findall(r'名\s*称[：:][^\S\n]*([^\n\d]{2,50}(?:公司|店|厂|中心|集团))', text)
    if len(all_names) >= 2:
        return all_names[-1].strip()
    return ''


def extract_seller_tax_id(text):
    """提取销售方税号"""
    patterns = [
        r'销售方.*?纳税人识别号[：:]\s*([A-Z0-9]{15,20})',
        r'销方税号[：:]\s*([A-Z0-9]{15,20})',
        r'销售方.*?统一社会信用代码[/\w]*[：:]\s*([A-Z0-9]{15,20})',
    ]
    result = multi_match(text, patterns)
    if result:
        return result
    # 兜底1：查找所有 "统一社会信用代码/纳税人识别号" 后面的税号，取第二个
    all_matches = re.findall(r'统一社会信用代码[/\w]*[：:]\s*([A-Z0-9]{15,20})', text)
    if len(all_matches) >= 2:
        return all_matches[1]
    # 兜底2：查找所有独立的 "纳税人识别号" 后面的税号，取第二个
    all_matches2 = re.findall(r'纳税人识别号[：:]\s*([A-Z0-9]{15,20})', text)
    if len(all_matches2) >= 2:
        return all_matches2[1]
    # 兜底3：标签和税号值分离的布局，查找包含两个税号的一行，取第二个
    match = re.search(r'(?:^|\n)\s*([A-Z0-9]{15,20})\s+([A-Z0-9]{15,20})\s*(?:\n|$)', text)
    if match:
        return match.group(2)
    return ''


def extract_seller_address_phone(text):
    """提取销售方地址电话"""
    patterns = [
        r'销售方.*?地址[、电话]?[：:]\s*([^\n]{5,80})',
    ]
    return multi_match(text, patterns)


def extract_amount(text):
    """提取不含税金额"""
    patterns = [
        r'合\s*计\s*[\s\S]*?[¥￥]?\s*([\d,]+\.\d{2})',
        r'金额\s*[（(]不含税[)）]?\s*[:：]?\s*[¥￥]?\s*([\d,]+\.\d{2})',
        r'价税合计.*?[¥￥]?\s*([\d,]+\.\d{2})',
    ]
    amt = multi_match(text, patterns)
    return parse_amount(amt)


def extract_tax_amount(text):
    """提取税额"""
    patterns = [
        r'税\s*额\s*[:：]?\s*[¥￥]?\s*([\d,]+\.\d{2})',
        r'合\s*计.*?[¥￥]?\s*[\d,]+\.\d{2}\s*[¥￥]?\s*([\d,]+\.\d{2})',
    ]
    amt = multi_match(text, patterns)
    return parse_amount(amt)


def extract_total_amount(text):
    """提取价税合计（小写）"""
    patterns = [
        r'价税合计[（(]小写[)）].*?[¥￥]?\s*([\d,]+\.\d{2})',
        r'价税合计.*?[¥￥]?\s*([\d,]+\.\d{2})',
        r'小写[：:]\s*[¥￥]?\s*([\d,]+\.\d{2})',
    ]
    amt = multi_match(text, patterns)
    return parse_amount(amt)


def extract_total_amount_cn(text):
    """提取价税合计（大写）"""
    patterns = [
        r'价税合计[（(]大写[)）]\s*([^\n（(]{2,40}?)\s*[（(]小写[)）]',
        r'价税合计[（(]大写[)）][：:]\s*([^\n]{5,40})',
        r'大写[：:]\s*([^\n]{5,40})',
    ]
    cn = multi_match(text, patterns)
    if cn:
        cn = re.sub(r'[（(]小写[)）].*', '', cn).strip()
    return cn


def parse_amount(amt_str):
    if not amt_str:
        return None
    try:
        return float(amt_str.replace(',', ''))
    except:
        return None


def extract_item_category(text):
    """提取开票项目/商品大类"""
    patterns = [
        r'货物或应税劳务、服务名称\s*([^\n]{2,30})',
        r'项\s*目\s*名\s*称\s*([^\n]{2,30})',
        r'服\s*务\s*名\s*称\s*([^\n]{2,30})',
    ]
    result = multi_match(text, patterns)
    # 排除匹配到表头的情况
    if result and any(kw in result for kw in ['规格型号', '单位', '数量', '单价', '金额', '税率']):
        return ''
    return result


def extract_item_details(text):
    """提取开票明细，逐行列出商品信息"""
    lines = text.split('\n')
    details = []
    in_table = False

    # 跳过的表头特征词（需要多个同时出现才判定为表头）
    header_keywords = ['规格型号', '单位', '数量', '单价', '金额']

    for line in lines:
        # 检测商品明细区域起点
        if any(kw in line for kw in ['货物或应税劳务', '项目名称', '规格型号']):
            in_table = True
            continue

        if not in_table:
            continue

        # 检测商品明细区域终点
        # 检测商品明细区域终点（支持带空格的"合 计"等）
        line_no_space = line.replace(' ', '')
        if any(kw in line_no_space for kw in ['合计', '价税合计', '购买方', '销售方', '备注', '收款人', '复核人', '开票人']):
            in_table = False
            continue

        stripped = line.strip()
        if not stripped:
            continue

        # 跳过纯表头行（包含大量表头关键词）
        if sum(1 for kw in header_keywords if kw in stripped) >= 3:
            continue

        # 只保留包含数字的实质内容行（排除空行或纯文字说明）
        if re.search(r'\d+\.?\d*', stripped):
            # 过滤掉单独的规格型号补充行（如上一行已有完整数据，当前行过短）
            if len(stripped) < 10 and not stripped.startswith('*'):
                continue
            details.append(stripped)

    return '\n'.join(details) if details else ''


def extract_remarks(text):
    """提取备注"""
    patterns = [
        r'备\s*注[：:]\s*([^\n]{0,200})',
    ]
    return multi_match(text, patterns)


def extract_payee(text):
    """提取收款人"""
    patterns = [
        r'收\s*款\s*人[：:]\s*([^\n\s]{1,20})',
        r'收款人[:：]\s*([^\n]{1,20})',
    ]
    return multi_match(text, patterns)


def extract_reviewer(text):
    """提取复核人"""
    patterns = [
        r'复\s*核[人]?[：:]\s*([^\n\s]{1,20})',
        r'复核人[:：]\s*([^\n]{1,20})',
    ]
    return multi_match(text, patterns)


def extract_drawer(text):
    """提取开票人"""
    patterns = [
        r'开\s*票\s*人[：:]\s*([^\n\s]{1,20})',
        r'开票人[:：]\s*([^\n]{1,20})',
    ]
    return multi_match(text, patterns)
