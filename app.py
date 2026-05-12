import os
import sys
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file

from database import (
    init_db, add_invoice, get_all_invoices, get_invoice, update_invoice,
    delete_invoice, batch_delete_invoices, update_invoice_flags, get_settings,
    set_setting, get_categories, add_category, get_duplicate_invoices, export_to_excel, backup_database,
    get_companies, add_company, delete_company, update_company
)
from pdf_parser import parse_invoice_pdf
from config import get_company_name, get_company_tax_id, set_company_name, set_company_tax_id

# PyInstaller 打包后，资源文件在 sys._MEIPASS 临时目录中
if getattr(sys, 'frozen', False):
    BASE_DIR = sys._MEIPASS
    template_dir = os.path.join(BASE_DIR, 'templates')
    static_dir = os.path.join(BASE_DIR, 'static')
    app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    app = Flask(__name__)

UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')

os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route('/')
def index():
    return render_template('index.html')


def check_buyer_against_companies(parsed, companies):
    """多主体收票方校验：通过名称找到对应主体，再比对税号"""
    buyer_name_mismatch = 0
    buyer_tax_id_mismatch = 0

    if not companies:
        return buyer_name_mismatch, buyer_tax_id_mismatch

    if not parsed.get('buyer_name'):
        buyer_name_mismatch = 1
        buyer_tax_id_mismatch = 1
        return buyer_name_mismatch, buyer_tax_id_mismatch

    # 查找名称匹配的主体
    matched_company = None
    for c in companies:
        if c.get('name') and c['name'].strip() == parsed['buyer_name'].strip():
            matched_company = c
            break

    if matched_company is None:
        # 没有找到对应主体，名称不匹配
        buyer_name_mismatch = 1
        buyer_tax_id_mismatch = 1
    else:
        # 找到对应主体，名称通过，检查税号
        if matched_company.get('tax_id') and parsed.get('buyer_tax_id'):
            if matched_company['tax_id'].strip().upper() != parsed['buyer_tax_id'].strip().upper():
                buyer_tax_id_mismatch = 1

    return buyer_name_mismatch, buyer_tax_id_mismatch


@app.route('/api/upload', methods=['POST'])
def upload_invoices():
    files = request.files.getlist('files')
    if not files:
        return jsonify({'success': False, 'message': '未选择文件'}), 400

    results = []
    companies = get_companies()

    for file in files:
        if not file.filename.lower().endswith('.pdf'):
            results.append({
                'filename': file.filename,
                'success': False,
                'message': '仅支持PDF文件'
            })
            continue

        filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}_{file.filename}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        parsed = parse_invoice_pdf(filepath)
        if 'error' in parsed:
            results.append({
                'filename': file.filename,
                'success': False,
                'message': parsed['error']
            })
            continue

        parsed['pdf_path'] = filepath
        invoice_id = add_invoice(parsed)

        # 多主体收票方校验
        buyer_name_mismatch, buyer_tax_id_mismatch = check_buyer_against_companies(parsed, companies)

        update_invoice_flags(invoice_id,
                             buyer_name_mismatch=buyer_name_mismatch,
                             buyer_tax_id_mismatch=buyer_tax_id_mismatch)

        results.append({
            'filename': file.filename,
            'success': True,
            'invoice_id': invoice_id,
            'parsed': parsed,
            'buyer_name_mismatch': buyer_name_mismatch,
            'buyer_tax_id_mismatch': buyer_tax_id_mismatch
        })

    # 导入完成后自动触发重复检测
    duplicate_numbers = get_duplicate_invoices()
    dup_set = set(duplicate_numbers)
    all_invoices = get_all_invoices()
    for inv in all_invoices:
        is_dup = 1 if inv.get('invoice_number') in dup_set else 0
        if inv.get('is_duplicate') != is_dup:
            update_invoice_flags(inv['id'], is_duplicate=is_dup)

    return jsonify({'success': True, 'results': results, 'duplicate_numbers': duplicate_numbers})


@app.route('/api/invoices', methods=['GET'])
def list_invoices():
    filters = {}
    if request.args.get('reimburse_month'):
        filters['reimburse_month'] = request.args.get('reimburse_month')
    if request.args.get('reimburse_person'):
        filters['reimburse_person'] = request.args.get('reimburse_person')
    if request.args.get('invoice_type'):
        filters['invoice_type'] = request.args.get('invoice_type')
    if request.args.get('buyer_name'):
        filters['buyer_name'] = request.args.get('buyer_name')
    if request.args.get('invoice_number'):
        filters['invoice_number'] = request.args.get('invoice_number')

    sort_by = request.args.get('sort_by')
    sort_order = request.args.get('sort_order', 'desc')

    invoices = get_all_invoices(filters, sort_by, sort_order)
    return jsonify({'success': True, 'invoices': invoices})


@app.route('/api/invoices/<int:invoice_id>', methods=['GET'])
def get_invoice_detail(invoice_id):
    invoice = get_invoice(invoice_id)
    if not invoice:
        return jsonify({'success': False, 'message': '发票不存在'}), 404
    return jsonify({'success': True, 'invoice': invoice})


@app.route('/api/invoices/<int:invoice_id>', methods=['PUT'])
def update_invoice_detail(invoice_id):
    data = request.json
    update_invoice(invoice_id, data)

    # 如果更新了报销分类，加入分类库
    category = data.get('reimburse_category')
    if category:
        add_category(category)

    return jsonify({'success': True})


@app.route('/api/invoices/<int:invoice_id>', methods=['DELETE'])
def delete_invoice_detail(invoice_id):
    delete_invoice(invoice_id)
    return jsonify({'success': True})


@app.route('/api/invoices/batch-delete', methods=['POST'])
def batch_delete():
    data = request.json
    ids = data.get('ids', [])
    if not ids:
        return jsonify({'success': False, 'message': '未选择发票'}), 400
    batch_delete_invoices(ids)
    return jsonify({'success': True})


@app.route('/api/settings', methods=['GET'])
def get_app_settings():
    return jsonify({
        'success': True,
        'settings': {
            'company_name': get_company_name(),
            'company_tax_id': get_company_tax_id()
        }
    })


@app.route('/api/settings', methods=['POST'])
def save_app_settings():
    data = request.json
    if 'company_name' in data:
        set_company_name(data['company_name'])
    if 'company_tax_id' in data:
        set_company_tax_id(data['company_tax_id'])
    return jsonify({'success': True})


@app.route('/api/categories', methods=['GET'])
def list_categories():
    return jsonify({'success': True, 'categories': get_categories()})


@app.route('/api/categories', methods=['POST'])
def add_new_category():
    data = request.json
    name = data.get('name', '').strip()
    if name:
        add_category(name)
    return jsonify({'success': True})


@app.route('/api/companies', methods=['GET'])
def list_companies():
    return jsonify({'success': True, 'companies': get_companies()})


@app.route('/api/companies', methods=['POST'])
def create_company():
    data = request.json
    name = data.get('name', '').strip()
    tax_id = data.get('tax_id', '').strip()
    if not name:
        return jsonify({'success': False, 'message': '公司名称不能为空'}), 400
    company_id = add_company(name, tax_id)
    return jsonify({'success': True, 'id': company_id})


@app.route('/api/companies/<int:company_id>', methods=['PUT'])
def modify_company(company_id):
    data = request.json
    name = data.get('name', '').strip()
    tax_id = data.get('tax_id', '').strip()
    if not name:
        return jsonify({'success': False, 'message': '公司名称不能为空'}), 400
    update_company(company_id, name, tax_id)
    return jsonify({'success': True})


@app.route('/api/companies/<int:company_id>', methods=['DELETE'])
def remove_company(company_id):
    delete_company(company_id)
    return jsonify({'success': True})


@app.route('/api/check-duplicates', methods=['POST'])
def check_duplicates():
    duplicate_numbers = get_duplicate_invoices()
    conn_numbers = set(duplicate_numbers)

    invoices = get_all_invoices()
    updated = []
    for inv in invoices:
        is_dup = 1 if inv.get('invoice_number') in conn_numbers else 0
        if inv.get('is_duplicate') != is_dup:
            update_invoice_flags(inv['id'], is_duplicate=is_dup)
            updated.append(inv['id'])

    return jsonify({'success': True, 'duplicate_numbers': duplicate_numbers, 'updated': updated})


@app.route('/api/check-buyer', methods=['POST'])
def check_buyer():
    companies = get_companies()

    invoices = get_all_invoices()
    updated = []
    for inv in invoices:
        buyer_name_mismatch, buyer_tax_id_mismatch = check_buyer_against_companies(inv, companies)

        if inv.get('buyer_name_mismatch') != buyer_name_mismatch or inv.get('buyer_tax_id_mismatch') != buyer_tax_id_mismatch:
            update_invoice_flags(inv['id'],
                                 buyer_name_mismatch=buyer_name_mismatch,
                                 buyer_tax_id_mismatch=buyer_tax_id_mismatch)
            updated.append(inv['id'])

    return jsonify({'success': True, 'updated': updated})


@app.route('/api/export', methods=['GET'])
def export_invoices():
    ids_param = request.args.get('ids')
    invoice_ids = None
    if ids_param:
        try:
            invoice_ids = [int(x) for x in ids_param.split(',') if x]
        except:
            pass

    filename = f"发票导出_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    export_to_excel(filepath, invoice_ids)

    return send_file(filepath, as_attachment=True, download_name=filename)


@app.route('/api/backup', methods=['GET'])
def backup_db():
    filename = f"invoices_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    backup_database(filepath)
    return send_file(filepath, as_attachment=True, download_name=filename)


@app.route('/api/stats', methods=['GET'])
def get_stats():
    invoices = get_all_invoices()
    total = len(invoices)
    duplicate_count = sum(1 for i in invoices if i.get('is_duplicate'))
    name_mismatch_count = sum(1 for i in invoices if i.get('buyer_name_mismatch'))
    tax_mismatch_count = sum(1 for i in invoices if i.get('buyer_tax_id_mismatch'))
    total_amount = sum(i.get('total_amount') or 0 for i in invoices)

    return jsonify({
        'success': True,
        'stats': {
            'total': total,
            'duplicate_count': duplicate_count,
            'name_mismatch_count': name_mismatch_count,
            'tax_mismatch_count': tax_mismatch_count,
            'total_amount': round(total_amount, 2)
        }
    })


if __name__ == '__main__':
    import socket
    init_db()
    port = int(os.environ.get('PORT', 5000))
    # 如果默认端口被占用，自动尝试下一个端口
    while port < 5010:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.bind(('127.0.0.1', port))
            s.close()
            break
        except OSError:
            port += 1
    print(f'发票管理系统启动中...')
    print(f'请在浏览器访问: http://localhost:{port}')
    import threading, webbrowser
    url = f'http://localhost:{port}'
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host='0.0.0.0', port=port, debug=False)
