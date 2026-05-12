const App = {
    invoices: [],
    selectedIds: new Set(),
    currentSort: { field: 'import_time', order: 'desc' },
    editingId: null,
    categories: [],

    init() {
        this.bindEvents();
        this.loadInvoices();
        this.loadStats();
        this.loadCategories();
        this.loadCompanies();
    },

    bindEvents() {
        // 弹窗控制
        document.getElementById('btnUpload').addEventListener('click', () => this.openModal('uploadModal'));
        document.getElementById('btnSettings').addEventListener('click', () => { this.loadCompanies(); this.openModal('settingsModal'); });

        document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target === el || e.target.classList.contains('modal-overlay')) {
                    this.closeModal(el.closest('.modal').id);
                }
            });
        });

        // 上传
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

        // 设置
        document.getElementById('btnAddCompany').addEventListener('click', () => this.addCompany());
        document.getElementById('btnBackup').addEventListener('click', () => this.backupDatabase());

        // 编辑
        document.getElementById('btnSaveEdit').addEventListener('click', () => this.saveEdit());

        // 筛选
        document.getElementById('btnFilter').addEventListener('click', () => this.loadInvoices());
        document.getElementById('btnClearFilter').addEventListener('click', () => {
            document.getElementById('filterMonth').value = '';
            document.getElementById('filterPerson').value = '';
            document.getElementById('filterType').value = '';
            document.getElementById('filterBuyer').value = '';
            document.getElementById('filterInvoiceNumber').value = '';
            this.loadInvoices();
        });

        // 操作按钮
        document.getElementById('btnCheckDup').addEventListener('click', () => this.checkDuplicates());
        document.getElementById('btnCheckBuyer').addEventListener('click', () => this.checkBuyer());
        document.getElementById('btnExport').addEventListener('click', () => this.exportExcel());
        document.getElementById('btnBatchDelete').addEventListener('click', () => this.batchDelete());
        document.getElementById('selectAll').addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));

        // 排序
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
        const params = new URLSearchParams();
        const month = document.getElementById('filterMonth').value;
        const person = document.getElementById('filterPerson').value;
        const type = document.getElementById('filterType').value;
        const buyer = document.getElementById('filterBuyer').value;
        const invoiceNumber = document.getElementById('filterInvoiceNumber').value;

        if (month) params.append('reimburse_month', month);
        if (person) params.append('reimburse_person', person);
        if (type) params.append('invoice_type', type);
        if (buyer) params.append('buyer_name', buyer);
        if (invoiceNumber) params.append('invoice_number', invoiceNumber);
        params.append('sort_by', this.currentSort.field);
        params.append('sort_order', this.currentSort.order);

        try {
            const res = await fetch('/api/invoices?' + params.toString());
            const data = await res.json();
            this.invoices = data.invoices || [];
            this.renderTable();
            this.updateSortIndicators();
            this.updateFilterTypeOptions();
        } catch (err) {
            this.showToast('加载数据失败', 'error');
        }
    },

    updateFilterTypeOptions() {
        const select = document.getElementById('filterType');
        const currentValue = select.value;
        // 从当前发票数据中提取唯一的发票类型
        const types = [...new Set(this.invoices.map(inv => inv.invoice_type).filter(Boolean))].sort();
        // 保留第一个 option（全部类型）
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
                    <td>${inv.total_amount !== null ? '¥' + inv.total_amount.toFixed(2) : ''}</td>
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

        // 重新绑定复选框事件
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

    async handleFiles(files) {
        const pdfFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (pdfFiles.length === 0) {
            this.showToast('请选择PDF文件', 'error');
            return;
        }

        const formData = new FormData();
        pdfFiles.forEach(f => formData.append('files', f));

        const resultsDiv = document.getElementById('uploadResults');
        resultsDiv.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>';

        try {
            const res = await fetch('/api/upload', { method: 'POST', body: formData });
            const data = await res.json();
            resultsDiv.innerHTML = '';

            let successCount = 0;
            let errorCount = 0;

            data.results.forEach(r => {
                const div = document.createElement('div');
                div.className = `upload-result ${r.success ? 'success' : 'error'}`;
                let msg = r.filename;
                if (r.success) {
                    successCount++;
                    const flags = [];
                    if (r.buyer_name_mismatch) flags.push('名称不符');
                    if (r.buyer_tax_id_mismatch) flags.push('税号不符');
                    if (flags.length) msg += ` (${flags.join(', ')})`;
                    msg += ' ✓';
                } else {
                    errorCount++;
                    msg += ` - ${r.message}`;
                }
                div.textContent = msg;
                resultsDiv.appendChild(div);
            });

            this.showToast(`导入完成: ${successCount} 成功, ${errorCount} 失败`, successCount > 0 ? 'success' : 'info');
            this.loadInvoices();
            this.loadStats();
        } catch (err) {
            resultsDiv.innerHTML = '';
            this.showToast('上传失败: ' + err.message, 'error');
        }
    },

    async loadStats() {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();
            const s = data.stats;
            document.getElementById('statTotal').textContent = s.total;
            document.getElementById('statDuplicate').textContent = s.duplicate_count;
            document.getElementById('statMismatch').textContent = s.name_mismatch_count + s.tax_mismatch_count;
            document.getElementById('statAmount').textContent = '¥' + s.total_amount.toFixed(2);
        } catch (err) {
            console.error('加载统计失败', err);
        }
    },

    async loadCategories() {
        try {
            const res = await fetch('/api/categories');
            const data = await res.json();
            this.categories = data.categories || [];
            this.updateCategoryDatalist();
        } catch (err) {
            console.error('加载分类失败', err);
        }
    },

    updateCategoryDatalist() {
        const dl = document.getElementById('categoryList');
        dl.innerHTML = this.categories.map(c => `<option value="${this.escapeHtml(c)}">`).join('');
    },

    async loadCompanies() {
        try {
            const res = await fetch('/api/companies');
            const data = await res.json();
            this.companies = data.companies || [];
            this.renderCompanies();
        } catch (err) {
            console.error('加载主体失败', err);
        }
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
        try {
            await fetch('/api/companies', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, tax_id: taxId })
            });
            document.getElementById('newCompanyName').value = '';
            document.getElementById('newCompanyTaxId').value = '';
            this.showToast('添加成功', 'success');
            this.loadCompanies();
        } catch (err) {
            this.showToast('添加失败', 'error');
        }
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
        try {
            await fetch(`/api/companies/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, tax_id: taxId })
            });
            this.showToast('保存成功', 'success');
            this.loadCompanies();
        } catch (err) {
            this.showToast('保存失败', 'error');
        }
    },

    async deleteCompany(id) {
        if (!confirm('确定删除该收票方主体？')) return;
        try {
            await fetch(`/api/companies/${id}`, { method: 'DELETE' });
            this.showToast('删除成功', 'success');
            this.loadCompanies();
        } catch (err) {
            this.showToast('删除失败', 'error');
        }
    },

    editInvoice(id) {
        const inv = this.invoices.find(i => i.id === id);
        if (!inv) return;
        this.editingId = id;
        document.getElementById('editCategory').value = inv.reimburse_category || '';
        document.getElementById('editPerson').value = inv.reimburse_person || '';
        document.getElementById('editMonth').value = inv.reimburse_month || '';
        document.getElementById('editRemark').value = inv.reimburse_remark || '';

        // 填充发票基本信息（只读）
        document.getElementById('infoInvoiceNumber').textContent = inv.invoice_number || '-';
        document.getElementById('infoInvoiceDate').textContent = inv.invoice_date || '-';
        document.getElementById('infoBuyerName').textContent = inv.buyer_name || '-';
        document.getElementById('infoSellerName').textContent = inv.seller_name || '-';
        document.getElementById('infoTotalAmount').textContent = inv.total_amount !== null ? '¥' + inv.total_amount.toFixed(2) : '-';

        // 填充开票明细（多行）
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

        try {
            await fetch(`/api/invoices/${this.editingId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            this.showToast('保存成功', 'success');
            this.closeModal('editModal');
            this.loadInvoices();
            this.loadCategories();
        } catch (err) {
            this.showToast('保存失败', 'error');
        }
    },

    async deleteInvoice(id) {
        if (!confirm('确定删除该发票记录？')) return;
        try {
            await fetch(`/api/invoices/${id}`, { method: 'DELETE' });
            this.showToast('删除成功', 'success');
            this.loadInvoices();
            this.loadStats();
        } catch (err) {
            this.showToast('删除失败', 'error');
        }
    },

    async batchDelete() {
        if (this.selectedIds.size === 0) {
            this.showToast('请先选择要删除的发票', 'info');
            return;
        }
        if (!confirm(`确定删除选中的 ${this.selectedIds.size} 张发票？`)) return;
        try {
            await fetch('/api/invoices/batch-delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(this.selectedIds) })
            });
            this.selectedIds.clear();
            document.getElementById('selectAll').checked = false;
            this.showToast('批量删除成功', 'success');
            this.loadInvoices();
            this.loadStats();
        } catch (err) {
            this.showToast('删除失败', 'error');
        }
    },

    async checkDuplicates() {
        try {
            const res = await fetch('/api/check-duplicates', { method: 'POST' });
            const data = await res.json();
            this.showToast(`检测到 ${data.duplicate_numbers.length} 个重复发票号码`, data.duplicate_numbers.length > 0 ? 'warning' : 'success');
            this.loadInvoices();
            this.loadStats();
        } catch (err) {
            this.showToast('检测失败', 'error');
        }
    },

    async checkBuyer() {
        try {
            const res = await fetch('/api/check-buyer', { method: 'POST' });
            const data = await res.json();
            this.showToast(`校验完成，更新了 ${data.updated.length} 条记录`, 'success');
            this.loadInvoices();
            this.loadStats();
        } catch (err) {
            this.showToast('校验失败', 'error');
        }
    },

    async exportExcel() {
        let url = '/api/export';
        if (this.selectedIds.size > 0) {
            url += '?ids=' + Array.from(this.selectedIds).join(',');
        }
        window.location.href = url;
    },

    async backupDatabase() {
        window.location.href = '/api/backup';
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

document.addEventListener('DOMContentLoaded', () => App.init());
