from database import get_settings, set_setting

DEFAULT_COMPANY_NAME = ''
DEFAULT_COMPANY_TAX_ID = ''


def get_company_name():
    settings = get_settings()
    return settings.get('company_name', DEFAULT_COMPANY_NAME)


def set_company_name(name):
    set_setting('company_name', name)


def get_company_tax_id():
    settings = get_settings()
    return settings.get('company_tax_id', DEFAULT_COMPANY_TAX_ID)


def set_company_tax_id(tax_id):
    set_setting('company_tax_id', tax_id)
