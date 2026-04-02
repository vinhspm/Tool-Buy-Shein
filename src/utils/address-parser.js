// Parses shipping_address string into structured fields
// Expected format (separated by \n):
// Line 0: Full name (will be split into firstName and lastName)
// Line 1: Comma-separated address: Country, State, City, {Detailed Address}
// Line 2: Phone number
// Line 3: ZIP / Postal code string (e.g. "Postal Code 12345" - only digits will be extracted)

function parseShippingAddress(raw) {
  if (!raw) return {};
  const lines = String(raw).split('\n').map(l => l.trim());
  
  // 1. Process Name (firstName, lastName)
  const fullName = lines[0] || '';
  const nameParts = fullName.split(' ').filter(Boolean);
  const firstName = nameParts.length > 0 ? nameParts[0] : '';
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  
  // 2. Process Address (Comma separated: Country, State, City, DetailedAddress...)
  const addressLine = lines[1] || '';
  const addressParts = addressLine.split(',').map(s => s.trim()).filter(Boolean);
  const country = addressParts.length > 0 ? addressParts[0] : '';
  const state = addressParts.length > 1 ? addressParts[1] : '';
  const city = addressParts.length > 2 ? addressParts[2] : '';
  const detailedAddress = addressParts.length > 3 ? addressParts.slice(3).join(', ') : '';
  
  // 3. Process Phone
  const phone = lines[2] || '';
  
  // 4. Process Zip (Extract digits from "Postal Code 61548")
  const zipRaw = lines[3] || '';
  const zipMatch = zipRaw.match(/\d+/);
  const zip = zipMatch ? zipMatch[0] : '';
  
  return {
    firstName,
    lastName,
    country,
    state,
    city,
    detailedAddress,
    phone,
    zip,
    raw
  };
}

module.exports = { parseShippingAddress };
