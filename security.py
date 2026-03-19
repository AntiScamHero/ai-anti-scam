import re
from urllib.parse import urlparse

TRUSTED_DOMAINS = [
    "google.com", "yahoo.com", "gov.tw", "line.me", 
    "facebook.com", "apple.com", "momo.com.tw", "pchome.com.tw"
]

def to_half_width(text):
    if not text: return ""
    return text.translate(str.maketrans(
        '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ',
        '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    ))

def mask_sensitive_data(text):
    if not text: return ""
    cleaned_text = to_half_width(text)
    cleaned_text = re.sub(r'[\u200B\u200C\u200D\uFEFF]', '', cleaned_text)
    noise = r'[\s\.\-•\*\_\|/\\:()\[\]{}📞☎️💳✉️]*'
    
    phone_regex = re.compile(r'0' + noise + r'9' + noise + r'(?:\d' + noise + r'){8}')
    cleaned_text = phone_regex.sub('[手機號碼已隱藏]', cleaned_text)
    
    id_regex = re.compile(r'[A-Za-z]' + noise + r'[12]' + noise + r'(?:\d' + noise + r'){8}')
    def id_replacer(match):
        start_idx = match.start()
        context_before = cleaned_text[max(0, start_idx - 6):start_idx]
        if any(keyword in context_before for keyword in ['型號', '編號', '序號', '代碼', '訂單', 'ID']):
            return match.group(0) 
        return '[身分證已隱藏]'
    cleaned_text = id_regex.sub(id_replacer, cleaned_text)
    
    cc_regex = re.compile(r'(?:\d' + noise + r'){12,16}\d')
    cleaned_text = cc_regex.sub('[信用卡號已隱藏]', cleaned_text)
        
    email_regex = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    cleaned_text = email_regex.sub('[Email已隱藏]', cleaned_text)
    
    if '零九' in cleaned_text:
        cn_regex = re.compile(r'零九[〇零一二三四五六七八九]{6,}')
        cleaned_text = cn_regex.sub('[手機號碼已隱藏]', cleaned_text)
    return cleaned_text

def is_genuine_white_listed(url):
    if not url: return False
    try:
        parsed = urlparse(url.lower().strip())
        host = parsed.hostname
        if not host: return False
        for domain in TRUSTED_DOMAINS:
            if host == domain or host.endswith("." + domain): return True
        return False
    except Exception:
        return False