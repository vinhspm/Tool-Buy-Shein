// Parses shipping_address string into structured fields
// Expected format (separated by \n):
// Line 0: Full name (will be split into firstName and lastName)
// Line 1: Comma-separated address: Country, State, City, {Detailed Address}
// Line 2: Phone number
// Line 3: ZIP / Postal code string (e.g. "Postal Code 12345" - only digits will be extracted)

function parseShippingAddress(raw) {
  if (!raw) return {};

  const rawStr = String(raw).trim();
  
  // ── 1. NẾU NGUỒN TỪ API (Dấu phẩy phân tách, không có \n) ───────────────────
  if (!rawStr.includes('\n') && rawStr.split(',').length >= 6) {
    const parts = rawStr.split(',').map(s => s.trim()).filter(Boolean);
    
    const fullName = parts[0] || '';
    const nameParts = fullName.split(' ').filter(Boolean);
    const firstName = nameParts.length > 0 ? nameParts[0] : '';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
    
    const country = parts[1] || '';
    const state = parts[2] || '';
    
    let phoneRaw = parts[parts.length - 1] || '';
    let phone = phoneRaw.replace(/^\(\+\d+\)/, '').trim(); 
    
    let zipRaw = parts[parts.length - 2] || '';
    const zipMatch = zipRaw.match(/\d+/);
    const zip = zipMatch ? zipMatch[0] : zipRaw;
    
    // City và Address phụ thuộc vào độ dài mảng (có thể có hoặc không có County)
    // Cấu trúc dự kiến: Name, Country, State, [County], City, Detailed Address..., ZIP, Phone
    let city = '';
    let detailedAddress = '';
    
    if (parts.length >= 8) {
       // Thường parts[3] là County, parts[4] là City
       city = parts[4] || '';
       detailedAddress = parts.slice(5, parts.length - 2).join(', ');
    } else {
       // Nếu parts.length < 8, parts[3] thường là City
       city = parts[3] || '';
       detailedAddress = parts.slice(4, parts.length - 2).join(', ');
    }
    
    return {
      firstName, lastName, country, state, city, detailedAddress, phone, zip, raw
    };
  }

  // ── 2. NẾU NGUỒN TỪ EXCEL (Xuống dòng \n) ────────────────────────────────────
  const lines = rawStr.split('\n').filter(l => l.trim() !== '').map(l => l.trim());
  
  const fullName = lines[0] || '';
  const nameParts = fullName.split(' ').filter(Boolean);
  const firstName = nameParts.length > 0 ? nameParts[0] : '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  
  const addressLine = lines[1] || '';
  const addressParts = addressLine.split(',').map(s => s.trim()).filter(Boolean);
  const country = addressParts.length > 0 ? addressParts[0] : '';
  const state = addressParts.length > 1 ? addressParts[1] : '';
  const city = addressParts.length > 2 ? addressParts[2] : '';
  const detailedAddress = addressParts.length > 3 ? addressParts.slice(3).join(', ') : '';
  
  let phone = lines[2] || '';
  phone = phone.replace(/^\(\+\d+\)/, '').trim(); 
  
  const zipRaw = lines[3] || '';
  const zipMatch = zipRaw.match(/\d+/);
  const zip = zipMatch ? zipMatch[0] : '';
  
  return {
    firstName, lastName, country, state, city, detailedAddress, phone, zip, raw
  };
}

module.exports = { parseShippingAddress };
