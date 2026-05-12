const App = {
    invoices: [],
    selectedIds: new Set(),
    currentSort: { field: 'import_time', order: 'desc' },
    editingId: null,
    categories: [],
    companies: [],
    pdfDocs: {},

    async init() {
        await this.initDB();
        this.bindEvents();
        await this.loadInvoices();
        await this.loadStats();
        await this.loadCategories();
        await this.loadCompanies();
    },

    async initDB() {
        this.db = new Dexie('InvoiceDB');
        this.db.version(1).stores({
            invoices: '++id, invoice_number, invoice_type, invoice_date, buyer_name, buyer_tax_id, seller_name, seller_tax_id, total_amount, reimburse_category, reimburse_person, reimburse_month, import_time, is_duplicate, buyer_name_mismatch, buyer_tax_id_mismatch',
            companies: '++id, name, tax_id',
            categories: '++id, name'
        });
    },

    bindEvents() {
        document.getElementById('btnUpload').addEventListener('click', () => this.openModal('uploadModal'));
        document.getElementById('btnSettings').addEventListener('click', () => { this.loadCompanies(); this.openModal('settingsModal'); });

        document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target === el || e.target.classList.contains('modal-overlay')) {
                    this.closeModal(el.closest('.modal').id);
                }
            });
        });

        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        uploadArea.addEventListener('click', () => fileInput.click());
        uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            this.handleFiles(e.dataTransfer.files);
        });
        fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

        document.getElementById('btnAddCompany').addEventListener('click', () => this.addCompany());
        document.getElementById('btnBackup').addEventListener('click', () => this.backupDatabase());
        document.getElementById('btnSaveEdit').addEventListener('click', () => this.saveEdit());
        document.getElementById('btnFilter').addEventListener('click', () => this.loadInvoices());
        document.getElementById('btnClearFilter').addEventListener('click', () => {
            document.getElementById('filterMonth').value = '';
            document.getElementById('filterPerson').value = '';
            document.getElementById('filterType').value = '';
            document.getElementById('filterBuyer').value = '';
            document.getElementById('filterInvoiceNumber').value = '';
            this.loadInvoices();
        });

        document.getElementById('btnCheckDup').addEventListener('click', () => this.checkDuplicates());
        document.getElementById('btnCheckBuyer').addEventListener('click', () => this.checkBuyer());
        document.getElementById('btnExport').addEventListener('click', () => this.exportExcel());
        document.getElementById('btnBatchDelete').addEventListener('click', () => this.batchDelete());
        document.getElementById('selectAll').addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));

        document.querySelectorAll('.col-sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (this.currentSort.field === field) {
                    this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
                } else {
                    this.currentSort.field = field;
                    this.currentSort.order = 'desc';
                }
                this.loadInvoices();
            });
        });
    },

    openModal(id) {
        document.getElementById(id).classList.add('active');
        if (id === 'uploadModal') {
            document.getElementById('uploadResults').innerHTML = '';
        }
    },

    closeModal(id) {
        document.getElementById(id).classList.remove('active');
    },

    async loadInvoices() {
        const month = document.getElementById('filterMonth').value.trim();
        const person = document.getElementById('filterPerson').value.trim();
        const type = document.getElementById('filterType').value;
        const buyer = document.getElementById('filterBuyer').value.trim();
        const invoiceNumber = document.getElementById('filterInvoiceNumber').value.trim();

        let collection = this.db.invoices.orderBy(this.currentSort.field);
        if (this.currentSort.order === 'desc') collection = collection.reverse();

        const all = await collection.toArray();
        this.invoices = all.filter(inv => {
            if (month && inv.reimburse_month !== month) return false;
            if (person && (!inv.reimburse_person || !inv.reimburse_person.includes(person))) return false;
            if (type && inv.invoice_type !== type) return false;
            if (buyer && (!inv.buyer_name || !inv.buyer_name.includes(buyer))) return false;
            if (invoiceNumber && (!inv.invoice_number || !inv.invoice_number.includes(invoiceNumber))) return false;
            return true;
        });

        this.renderTable();
        this.updateSortIndicators();
        this.updateFilterTypeOptions();
    },

    renderTable() {
        const tbody = document.getElementById('tableBody');
        if (this.invoices.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="13" class="empty-message">暂无发票数据，点击上方「导入发票」按钮开始</td></tr>';
            return;
        }

        tbody.innerHTML = this.invoices.map(inv => {
            const isDanger = inv.is_duplicate || inv.buyer_name_mismatch || inv.buyer_tax_id_mismatch;
            let badges = '';
            if (inv.is_duplicate) badges += '<span class="badge badge-danger">重复</span> ';
            if (inv.buyer_name_mismatch) badges += '<span class="badge badge-danger">名称不符</span> ';
            if (inv.buyer_tax_id_mismatch) badges += '<span class="badge badge-danger">税号不符</span> ';

            return `
                <tr class="${isDanger ? 'row-danger' : ''}" data-id="${inv.id}">
                    <td class="col-checkbox"><input type="checkbox" class="row-checkbox" data-id="${inv.id}" ${this.selectedIds.has(inv.id) ? 'checked' : ''}></td>
                    <td>${this.escapeHtml(inv.invoice_type || '')} ${badges}</td>
                    <td>${this.escapeHtml(inv.invoice_number || '')}</td>
                    <td>${this.escapeHtml(inv.invoice_date || '')}</td>
                    <td class="truncate" title="${this.escapeHtml(inv.buyer_name || '')}">${this.escapeHtml(inv.buyer_name || '')}</td>
                    <td class="truncate" title="${this.escapeHtml(inv.buyer_tax_id || '')}">${this.escapeHtml(inv.buyer_tax_id || '')}</td>
                    <td class="truncate" title="${this.escapeHtml(inv.seller_name || '')}">${this.escapeHtml(inv.seller_name || '')}</td>
                    <td>${inv.total_amount !== null && inv.total_amount !== undefined ? '¥' + inv.total_amount.toFixed(2) : ''}</td>
                    <td>${this.escapeHtml(inv.reimburse_category || '')}</td>
                    <td>${this.escapeHtml(inv.reimburse_person || '')}</td>
                    <td>${this.escapeHtml(inv.reimburse_month || '')}</td>
                    <td>${this.escapeHtml(inv.import_time || '')}</td>
                    <td>
                        <div class="action-btns">
                            <button class="btn-icon" onclick="App.editInvoice(${inv.id})">编辑</button>
                            <button class="btn-icon" onclick="App.deleteInvoice(${inv.id})">删除</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.row-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = parseInt(e.target.dataset.id);
                if (e.target.checked) {
                    this.selectedIds.add(id);
                } else {
                    this.selectedIds.delete(id);
                }
                this.updateSelectAllState();
            });
        });
    },

    updateSortIndicators() {
        document.querySelectorAll('.col-sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === this.currentSort.field) {
                th.classList.add(this.currentSort.order === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    },

    toggleSelectAll(checked) {
        if (checked) {
            this.invoices.forEach(inv => this.selectedIds.add(inv.id));
        } else {
            this.selectedIds.clear();
        }
        this.renderTable();
    },

    updateSelectAllState() {
        const allIds = this.invoices.map(i => i.id);
        const allSelected = allIds.length > 0 && allIds.every(id => this.selectedIds.has(id));
        document.getElementById('selectAll').checked = allSelected;
    },

    updateFilterTypeOptions() {
        const select = document.getElementById('filterType');
        const currentValue = select.value;
        const types = [...new Set(this.invoices.map(inv => inv.invoice_type).filter(Boolean))].sort();
        const firstOption = select.options[0];
        select.innerHTML = '';
        select.appendChild(firstOption);
        types.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            select.appendChild(opt);
        });
        select.value = currentValue;
    },

    async handleFiles(files) {
        const pdfFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (pdfFiles.length === 0) {
            this.showToast('请选择PDF文件', 'error');
            return;
        }

        const resultsDiv = document.getElementById('uploadResults');
        resultsDiv.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>';

        const companies = await this.db.companies.toArray();
        let successCount = 0;
        let errorCount = 0;
        resultsDiv.innerHTML = '';

        for (const file of pdfFiles) {
            const r = await parseInvoicePdf(file);
            const div = document.createElement('div');
            div.className = `upload-result ${r.error ? 'error' : 'success'}`;
            let msg = file.name;
            if (r.error) {
                errorCount++;
                msg += ` - ${r.error}`;
            } else {
                successCount++;
                const flags = [];
                if (r.buyer_name_mismatch) flags.push('名称不符');
                if (r.buyer_tax_id_mismatch) flags.push('税号不符');
                if (flags.length) msg += ` (${flags.join(', ')})`;
                msg += ' ✓';

                r.import_time = new Date().toLocaleString('zh-CN');
                r.pdf_name = file.name;
                const id = await this.db.invoices.add(r);

                if (r.reimburse_category) {
                    const exists = await this.db.categories.where('name').equals(r.reimburse_category).count();
                    if (!exists) await this.db.categories.add({ name: r.reimburse_category });
                }
            }
            div.textContent = msg;
            resultsDiv.appendChild(div);
        }

        await this.autoCheckDuplicates();
        this.showToast(`导入完成: ${successCount} 成功, ${errorCount} 失败`, successCount > 0 ? 'success' : 'info');
        this.loadInvoices();
        this.loadStats();
    },

    async autoCheckDuplicates() {
        const all = await this.db.invoices.toArray();
        const numberMap = {};
        all.forEach(inv => {
            const num = inv.invoice_number;
            if (num) {
                numberMap[num] = (numberMap[num] || 0) + 1;
            }
        });
        const dupNumbers = new Set(Object.keys(numberMap).filter(n => numberMap[n] > 1));
        for (const inv of all) {
            const isDup = dupNumbers.has(inv.invoice_number) ? 1 : 0;
            if (inv.is_duplicate !== isDup) {
                await this.db.invoices.update(inv.id, { is_duplicate: isDup });
            }
        }
    },

    async loadStats() {
        const all = await this.db.invoices.toArray();
        const total = all.length;
        const duplicate_count = all.filter(i => i.is_duplicate).length;
        const name_mismatch_count = all.filter(i => i.buyer_name_mismatch).length;
        const tax_mismatch_count = all.filter(i => i.buyer_tax_id_mismatch).length;
        const total_amount = all.reduce((sum, i) => sum + (i.total_amount || 0), 0);

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statDuplicate').textContent = duplicate_count;
        document.getElementById('statMismatch').textContent = name_mismatch_count + tax_mismatch_count;
        document.getElementById('statAmount').textContent = '¥' + total_amount.toFixed(2);
    },

    async loadCategories() {
        this.categories = await this.db.categories.toArray().then(arr => arr.map(c => c.name));
        this.updateCategoryDatalist();
    },

    updateCategoryDatalist() {
        const dl = document.getElementById('categoryList');
        dl.innerHTML = this.categories.map(c => `<option value="${this.escapeHtml(c)}">`).join('');
    },

    async loadCompanies() {
        this.companies = await this.db.companies.toArray();
        this.renderCompanies();
    },

    renderCompanies() {
        const container = document.getElementById('companyList');
        if (this.companies.length === 0) {
            container.innerHTML = '<div class="company-empty">暂无收票方主体，请添加</div>';
            return;
        }
        container.innerHTML = this.companies.map(c => `
            <div class="company-item" data-id="${c.id}">
                <div class="company-info">
                    <div class="company-name">${this.escapeHtml(c.name)}</div>
                    <div class="company-tax">${this.escapeHtml(c.tax_id || '未设置税号')}</div>
                </div>
                <div class="company-actions">
                    <button onclick="App.editCompany(${c.id})">编辑</button>
                    <button class="btn-danger-text" onclick="App.deleteCompany(${c.id})">删除</button>
                </div>
            </div>
        `).join('');
    },

    async addCompany() {
        const name = document.getElementById('newCompanyName').value.trim();
        const taxId = document.getElementById('newCompanyTaxId').value.trim();
        if (!name) {
            this.showToast('请输入公司名称', 'error');
            return;
        }
        await this.db.companies.add({ name, tax_id: taxId });
        document.getElementById('newCompanyName').value = '';
        document.getElementById('newCompanyTaxId').value = '';
        this.showToast('添加成功', 'success');
        this.loadCompanies();
    },

    editCompany(id) {
        const c = this.companies.find(x => x.id === id);
        if (!c) return;
        const item = document.querySelector(`.company-item[data-id="${id}"]`);
        if (!item) return;
        item.innerHTML = `
            <div class="company-edit-row" style="grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 8px; align-items: center;">
                <input type="text" id="editCompanyName-${id}" value="${this.escapeHtml(c.name)}" placeholder="公司名称">
                <input type="text" id="editCompanyTaxId-${id}" value="${this.escapeHtml(c.tax_id || '')}" placeholder="纳税人识别号">
                <button onclick="App.saveCompanyEdit(${id})">保存</button>
                <button class="btn-danger-text" onclick="App.cancelCompanyEdit(${id})">取消</button>
            </div>
        `;
    },

    cancelCompanyEdit(id) {
        this.renderCompanies();
    },

    async saveCompanyEdit(id) {
        const name = document.getElementById(`editCompanyName-${id}`).value.trim();
        const taxId = document.getElementById(`editCompanyTaxId-${id}`).value.trim();
        if (!name) {
            this.showToast('请输入公司名称', 'error');
            return;
        }
        await this.db.companies.update(id, { name, tax_id: taxId });
        this.showToast('保存成功', 'success');
        this.loadCompanies();
    },

    async deleteCompany(id) {
        if (!confirm('确定删除该收票方主体？')) return;
        await this.db.companies.delete(id);
        this.showToast('删除成功', 'success');
        this.loadCompanies();
    },

    editInvoice(id) {
        const inv = this.invoices.find(i => i.id === id);
        if (!inv) return;
        this.editingId = id;
        document.getElementById('editCategory').value = inv.reimburse_category || '';
        document.getElementById('editPerson').value = inv.reimburse_person || '';
        document.getElementById('editMonth').value = inv.reimburse_month || '';
        document.getElementById('editRemark').value = inv.reimburse_remark || '';

        document.getElementById('infoInvoiceNumber').textContent = inv.invoice_number || '-';
        document.getElementById('infoInvoiceDate').textContent = inv.invoice_date || '-';
        document.getElementById('infoBuyerName').textContent = inv.buyer_name || '-';
        document.getElementById('infoSellerName').textContent = inv.seller_name || '-';
        document.getElementById('infoTotalAmount').textContent = inv.total_amount !== null && inv.total_amount !== undefined ? '¥' + inv.total_amount.toFixed(2) : '-';

        const detailsEl = document.getElementById('infoItemDetails');
        const detailsGroup = document.getElementById('detailsGroup');
        if (inv.item_details) {
            detailsEl.textContent = inv.item_details;
            detailsGroup.style.display = 'block';
        } else {
            detailsGroup.style.display = 'none';
        }

        this.openModal('editModal');
    },

    async saveEdit() {
        const data = {
            reimburse_category: document.getElementById('editCategory').value.trim(),
            reimburse_person: document.getElementById('editPerson').value.trim(),
            reimburse_month: document.getElementById('editMonth').value.trim(),
            reimburse_remark: document.getElementById('editRemark').value.trim()
        };

        await this.db.invoices.update(this.editingId, data);
        if (data.reimburse_category) {
            const exists = await this.db.categories.where('name').equals(data.reimburse_category).count();
            if (!exists) await this.db.categories.add({ name: data.reimburse_category });
        }
        this.showToast('保存成功', 'success');
        this.closeModal('editModal');
        this.loadInvoices();
        this.loadCategories();
    },

    async deleteInvoice(id) {
        if (!confirm('确定删除该发票记录？')) return;
        await this.db.invoices.delete(id);
        this.showToast('删除成功', 'success');
        this.loadInvoices();
        this.loadStats();
    },

    async batchDelete() {
        if (this.selectedIds.size === 0) {
            this.showToast('请先选择要删除的发票', 'info');
            return;
        }
        if (!confirm(`确定删除选中的 ${this.selectedIds.size} 张发票？`)) return;
        await this.db.invoices.bulkDelete(Array.from(this.selectedIds));
        this.selectedIds.clear();
        document.getElementById('selectAll').checked = false;
        this.showToast('批量删除成功', 'success');
        this.loadInvoices();
        this.loadStats();
    },

    async checkDuplicates() {
        await this.autoCheckDuplicates();
        const all = await this.db.invoices.toArray();
        const dupNumbers = new Set();
        const numberMap = {};
        all.forEach(inv => {
            const num = inv.invoice_number;
            if (num) {
                numberMap[num] = (numberMap[num] || 0) + 1;
            }
        });
        Object.keys(numberMap).forEach(n => { if (numberMap[n] > 1) dupNumbers.add(n); });
        this.showToast(`检测到 ${dupNumbers.size} 个重复发票号码`, dupNumbers.size > 0 ? 'warning' : 'success');
        this.loadInvoices();
        this.loadStats();
    },

    async checkBuyer() {
        const companies = await this.db.companies.toArray();
        const all = await this.db.invoices.toArray();
        let updated = 0;
        for (const inv of all) {
            const [nameMismatch, taxMismatch] = checkBuyerAgainstCompanies(inv, companies);
            if (inv.buyer_name_mismatch !== nameMismatch || inv.buyer_tax_id_mismatch !== taxMismatch) {
                await this.db.invoices.update(inv.id, {
                    buyer_name_mismatch: nameMismatch,
                    buyer_tax_id_mismatch: taxMismatch
                });
                updated++;
            }
        }
        this.showToast(`校验完成，更新了 ${updated} 条记录`, 'success');
        this.loadInvoices();
        this.loadStats();
    },

    async exportExcel() {
        const ids = Array.from(this.selectedIds);
        let data;
        if (ids.length > 0) {
            data = [];
            for (const id of ids) {
                const inv = await this.db.invoices.get(id);
                if (inv) data.push(inv);
            }
        } else {
            data = await this.db.invoices.toArray();
        }

        const headers = [
            '发票类型', '发票号码', '开票日期', '购买方名称', '购买方税号',
            '销售方名称', '销售方税号', '价税合计', '开票明细',
            '报销分类', '报销人', '报销月', '备注', '导入时间'
        ];
        const rows = data.map(inv => [
            inv.invoice_type || '',
            inv.invoice_number || '',
            inv.invoice_date || '',
            inv.buyer_name || '',
            inv.buyer_tax_id || '',
            inv.seller_name || '',
            inv.seller_tax_id || '',
            inv.total_amount || '',
            inv.item_details || '',
            inv.reimburse_category || '',
            inv.reimburse_person || '',
            inv.reimburse_month || '',
            inv.reimburse_remark || '',
            inv.import_time || ''
        ]);

        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '发票数据');
        XLSX.writeFile(wb, `发票导出_${new Date().toLocaleString('zh-CN').replace(/[/:]/g, '-')}.xlsx`);
    },

    async backupDatabase() {
        const data = {
            invoices: await this.db.invoices.toArray(),
            companies: await this.db.companies.toArray(),
            categories: await this.db.categories.toArray()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoices_backup_${new Date().toLocaleString('zh-CN').replace(/[/: ]/g, '')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('备份成功', 'success');
    },

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

function checkBuyerAgainstCompanies(inv, companies) {
    let buyer_name_mismatch = 0;
    let buyer_tax_id_mismatch = 0;
    if (!companies || companies.length === 0) return [0, 0];
    if (!inv.buyer_name) return [1, 1];

    const matched = companies.find(c => c.name && c.name.trim() === inv.buyer_name.trim());
    if (!matched) {
        buyer_name_mismatch = 1;
        buyer_tax_id_mismatch = 1;
    } else if (matched.tax_id && inv.buyer_tax_id) {
        if (matched.tax_id.trim().toUpperCase() !== inv.buyer_tax_id.trim().toUpperCase()) {
            buyer_tax_id_mismatch = 1;
        }
    }
    return [buyer_name_mismatch, buyer_tax_id_mismatch];
}

async function parseInvoicePdf(file) {
    try {
        // 禁用 worker，避免跨域问题
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items.map(item => item.str).join('\n');
            if (text) fullText += text + '\n';
        }
        if (!fullText.trim()) {
            return { error: '未能从PDF中提取到文本，可能为图片型PDF' };
        }
        return extractFieldsFromText(fullText);
    } catch (e) {
        console.error('PDF解析错误:', e);
        return { error: 'PDF解析失败: ' + (e.message || e) };
    }
}

function extractFieldsFromText(text) {
    text = text.replace('⼦', '子');
    const result = {};

    const typePatterns = [
        /(增值税电子专用发票|增值税电子普通发票|增值税专用发票|增值税普通发票|深圳电子普通发票|电子发票|机动车销售统一发票|通用机打发票)/,
    ];
    result.invoice_type = multiMatch(text, typePatterns);

    const codePatterns = [
        /发票代码[：:]\s*(\d{10,12})/,
        /代码[：:]\s*(\d{10,12})/,
        /(\d{12})\s*发票号码/,
    ];
    result.invoice_code = multiMatch(text, codePatterns);

    const numberPatterns = [
        /发票号码[：:]\s*(\d{8,20})/,
        /号码[：:]\s*(\d{8,20})/,
        /No[.:]?\s*(\d{8,20})/,
        /统一发票监.*?\n\s*(\d{20})/,
        /(\d{20})/,
    ];
    result.invoice_number = multiMatch(text, numberPatterns);

    const datePatterns = [
        /开票日期[：:]\s*(\d{4}[年/\-]\d{1,2}[月/\-]\d{1,2}[日]?|\d{4}[年/\-]\d{1,2}[月/\-]\d{1,2})/,
        /日期[：:]\s*(\d{4}[年/\-]\d{1,2}[月/\-]\d{1,2}[日]?)/,
        /国家税务总局\s+(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)/,
        /(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?)/,
    ];
    result.invoice_date = normalizeDate(multiMatch(text, datePatterns));

    const verifyPatterns = [/校验码[：:]\s*(\d{20})/, /检验码[：:]\s*(\d{20})/];
    result.verify_code = multiMatch(text, verifyPatterns);

    const passwordPatterns = [/密\s*码\s*区\s*([\s\S]{50,500})/];
    result.password_area = multiMatch(text, passwordPatterns);
    if (result.password_area) {
        result.password_area = result.password_area.replace(/\n/g, ' ').trim().slice(0, 200);
    }

    result.buyer_name = extractBuyerName(text);
    result.buyer_tax_id = extractBuyerTaxId(text);
    result.buyer_address_phone = extractBuyerAddressPhone(text);
    result.buyer_account = extractBuyerAccount(text);
    result.seller_name = extractSellerName(text);
    result.seller_tax_id = extractSellerTaxId(text);
    result.seller_address_phone = extractSellerAddressPhone(text);
    result.amount = extractAmount(text);
    result.tax_amount = extractTaxAmount(text);
    result.total_amount = extractTotalAmount(text);
    result.total_amount_cn = extractTotalAmountCn(text);
    result.item_category = extractItemCategory(text);
    result.item_details = extractItemDetails(text);
    result.remarks = extractRemarks(text);
    result.payee = extractPayee(text);
    result.reviewer = extractReviewer(text);
    result.drawer = extractDrawer(text);

    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    result.invoice_title = lines[0] || '';

    const companies = [];
    try { companies.push(...(await App.db.companies.toArray())); } catch (e) {}
    const [buyer_name_mismatch, buyer_tax_id_mismatch] = checkBuyerAgainstCompanies(result, companies);
    result.buyer_name_mismatch = buyer_name_mismatch;
    result.buyer_tax_id_mismatch = buyer_tax_id_mismatch;

    return result;
}

function multiMatch(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1].trim();
    }
    return '';
}

function normalizeDate(dateStr) {
    if (!dateStr) return '';
    dateStr = dateStr.replace(/\s+/g, '');
    dateStr = dateStr.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const [year, month, day] = parts;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return dateStr;
}

function extractBuyerName(text) {
    const patterns = [
        /购[买方]?名称[：:][^\S\n]*([^\n]{2,50})/,
        /购买方.*?名称[：:][^\S\n]*([^\n]{2,50})/,
        /名\s*称[：:][^\S\n]*([^\n]{2,50})[^\S\n]*纳税人识别号/,
        /买方.*?名称\s*[:：][^\S\n]*([^\n]{2,50})/,
        /买[^\S\n]*名称[：:][^\S\n]*([^\n]{2,50})/,
        /购[^\S\n]*名称[：:][^\S\n]*([^\n]{2,50})/,
        /购[^\S\n]*名[^\S\n]*称[：:][^\S\n]*([^\n]{2,50})/,
        /买方[^\S\n]+([^\n]{2,50})[^\S\n]+卖方/,
        /买[^\S\n]+方[^\S\n]+([^\n]{2,50})[^\S\n]+销[^\S\n]+方/,
    ];
    let name = multiMatch(text, patterns);
    if (name) {
        for (const sep of ['售', '销', '密']) {
            const idx = name.indexOf(sep);
            if (idx > 0 && name[idx - 1].match(/\s/)) {
                name = name.slice(0, idx).trim();
                break;
            }
        }
    }
    if (!name) {
        const match = text.match(/(?:深圳市税务局|税务局)[^\S\n]*\n[^\S\n]*([^\n\d]{2,50}(?:公司|店|厂|中心|集团))/);
        if (match) {
            name = match[1].trim();
            if (name.includes(' ')) name = name.split(' ')[0].trim();
        }
    }
    return name;
}

function extractBuyerTaxId(text) {
    const patterns = [
        /纳税人识别号[：:]\s*([A-Z0-9]{15,20})/,
        /购.*?纳税人识别号[：:]\s*([A-Z0-9]{15,20})/,
        /税号[：:]\s*([A-Z0-9]{15,20})/,
        /统一社会信用代码[：:]\s*([A-Z0-9]{15,20})/,
    ];
    let result = multiMatch(text, patterns);
    if (result) return result;
    const match = text.match(/(?:^|\n)\s*([A-Z0-9]{15,20})\s+([A-Z0-9]{15,20})\s*(?:\n|$)/);
    if (match) return match[1];
    return '';
}

function extractBuyerAddressPhone(text) {
    const patterns = [
        /地址、?[电话]?[：:]\s*([^\n]{5,80})/,
        /购买方.*?地址.*?[：:]\s*([^\n]{5,80})/,
    ];
    return multiMatch(text, patterns);
}

function extractBuyerAccount(text) {
    const patterns = [
        /开户行及账号[：:]\s*([^\n]{5,80})/,
        /开户银行[：:]\s*([^\n]{5,80})/,
        /账\s*号[：:]\s*([^\n]{5,80})/,
    ];
    return multiMatch(text, patterns);
}

function extractSellerName(text) {
    const patterns = [
        /销[售方]?名称[：:][^\S\n]*([^\n]{2,50})/,
        /销售方.*?名称[：:][^\S\n]*([^\n]{2,50})/,
        /销售方.*?名\s*称[：:][^\S\n]*([^\n]{2,50})/,
        /售[^\S\n]*名称[：:][^\S\n]*([^\n]{2,50})/,
        /销[^\S\n]*名称[：:][^\S\n]*([^\n]{2,50})/,
        /销[^\S\n]*名[^\S\n]*称[：:][^\S\n]*([^\n]{2,50})/,
        /售[^\S\n]*名[^\S\n]*称[：:][^\S\n]*([^\n]{2,50})/,
    ];
    let name = multiMatch(text, patterns);
    if (name) return name;

    let match = text.match(/销[^\S\n]*\n[^\S\n]*(?:名\s*称[：:][^\S\n]*)?([^\n\d]{2,50}(?:公司|店|厂|中心|集团))/);
    if (match) return match[1].trim();

    match = text.match(/(?:深圳市税务局|税务局)[^\S\n]*\n[^\S\n]*[^\n]+(?:公司|店|厂|中心|集团)[^\S\n]+([^\n\d]{2,50}(?:公司|店|厂|中心|集团))/);
    if (match) return match[1].trim();

    const allNames = [...text.matchAll(/名\s*称[：:][^\S\n]*([^\n\d]{2,50}(?:公司|店|厂|中心|集团))/g)];
    if (allNames.length >= 2) return allNames[allNames.length - 1][1].trim();
    return '';
}

function extractSellerTaxId(text) {
    const patterns = [
        /销售方.*?纳税人识别号[：:]\s*([A-Z0-9]{15,20})/,
        /销方税号[：:]\s*([A-Z0-9]{15,20})/,
        /销售方.*?统一社会信用代码[/\w]*[：:]\s*([A-Z0-9]{15,20})/,
    ];
    let result = multiMatch(text, patterns);
    if (result) return result;

    let allMatches = [...text.matchAll(/统一社会信用代码[/\w]*[：:]\s*([A-Z0-9]{15,20})/g)];
    if (allMatches.length >= 2) return allMatches[1][1];

    allMatches = [...text.matchAll(/纳税人识别号[：:]\s*([A-Z0-9]{15,20})/g)];
    if (allMatches.length >= 2) return allMatches[1][1];

    const match = text.match(/(?:^|\n)\s*([A-Z0-9]{15,20})\s+([A-Z0-9]{15,20})\s*(?:\n|$)/);
    if (match) return match[2];
    return '';
}

function extractSellerAddressPhone(text) {
    const patterns = [/销售方.*?地址[、电话]?[：:]\s*([^\n]{5,80})/];
    return multiMatch(text, patterns);
}

function extractAmount(text) {
    const patterns = [
        /合\s*计\s*[\s\S]*?[¥￥]?\s*([\d,]+\.\d{2})/,
        /金额\s*[（(]不含税[)）]?\s*[:：]?\s*[¥￥]?\s*([\d,]+\.\d{2})/,
        /价税合计.*?[¥￥]?\s*([\d,]+\.\d{2})/,
    ];
    return parseAmount(multiMatch(text, patterns));
}

function extractTaxAmount(text) {
    const patterns = [
        /税\s*额\s*[:：]?\s*[¥￥]?\s*([\d,]+\.\d{2})/,
        /合\s*计.*?[¥￥]?\s*[\d,]+\.\d{2}\s*[¥￥]?\s*([\d,]+\.\d{2})/,
    ];
    return parseAmount(multiMatch(text, patterns));
}

function extractTotalAmount(text) {
    const patterns = [
        /价税合计[（(]小写[)）].*?[¥￥]?\s*([\d,]+\.\d{2})/,
        /价税合计.*?[¥￥]?\s*([\d,]+\.\d{2})/,
        /小写[：:]\s*[¥￥]?\s*([\d,]+\.\d{2})/,
    ];
    return parseAmount(multiMatch(text, patterns));
}

function extractTotalAmountCn(text) {
    const patterns = [
        /价税合计[（(]大写[)）]\s*([^\n（(]{2,40}?)\s*[（(]小写[)）]/,
        /价税合计[（(]大写[)）][：:]\s*([^\n]{5,40})/,
        /大写[：:]\s*([^\n]{5,40})/,
    ];
    let cn = multiMatch(text, patterns);
    if (cn) {
        cn = cn.replace(/[（(]小写[)）].*/, '').trim();
    }
    return cn;
}

function parseAmount(amtStr) {
    if (!amtStr) return null;
    const val = parseFloat(amtStr.replace(/,/g, ''));
    return isNaN(val) ? null : val;
}

function extractItemCategory(text) {
    const patterns = [
        /货物或应税劳务、服务名称\s*([^\n]{2,30})/,
        /项\s*目\s*名\s*称\s*([^\n]{2,30})/,
        /服\s*务\s*名\s*称\s*([^\n]{2,30})/,
    ];
    const result = multiMatch(text, patterns);
    if (result && ['规格型号', '单位', '数量', '单价', '金额', '税率'].some(kw => result.includes(kw))) {
        return '';
    }
    return result;
}

function extractItemDetails(text) {
    const lines = text.split('\n');
    const details = [];
    let inTable = false;
    const headerKeywords = ['规格型号', '单位', '数量', '单价', '金额'];

    for (const line of lines) {
        if (['货物或应税劳务', '项目名称', '规格型号'].some(kw => line.includes(kw))) {
            inTable = true;
            continue;
        }
        if (!inTable) continue;

        const lineNoSpace = line.replace(/ /g, '');
        if (['合计', '价税合计', '购买方', '销售方', '备注', '收款人', '复核人', '开票人'].some(kw => lineNoSpace.includes(kw))) {
            inTable = false;
            continue;
        }

        const stripped = line.trim();
        if (!stripped) continue;
        if (headerKeywords.filter(kw => stripped.includes(kw)).length >= 3) continue;
        if (/\d+\.?\d*/.test(stripped)) {
            if (stripped.length < 10 && !stripped.startsWith('*')) continue;
            details.push(stripped);
        }
    }
    return details.join('\n');
}

function extractRemarks(text) {
    const patterns = [/备\s*注[：:]\s*([^\n]{0,200})/];
    return multiMatch(text, patterns);
}

function extractPayee(text) {
    const patterns = [
        /收\s*款\s*人[：:]\s*([^\n\s]{1,20})/,
        /收款人[:：]\s*([^\n]{1,20})/,
    ];
    return multiMatch(text, patterns);
}

function extractReviewer(text) {
    const patterns = [
        /复\s*核[人]?[：:]\s*([^\n\s]{1,20})/,
        /复核人[:：]\s*([^\n]{1,20})/,
    ];
    return multiMatch(text, patterns);
}

function extractDrawer(text) {
    const patterns = [
        /开\s*票\s*人[：:]\s*([^\n\s]{1,20})/,
        /开票人[:：]\s*([^\n]{1,20})/,
    ];
    return multiMatch(text, patterns);
}

document.addEventListener('DOMContentLoaded', () => App.init());
