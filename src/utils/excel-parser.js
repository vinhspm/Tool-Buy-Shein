const XLSX = require('xlsx');
const path = require('path');

/**
 * Reads an Excel (.xlsx) file and returns array of row objects.
 * Expected columns: sku_code, color, size, quantity, shipping_address, shop_code
 */
function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return rows.map((row, index) => ({
    rowIndex: index + 2, // Excel row number (1-based header)
    color:       String(row['color'] || row['Color'] || '').trim(),
    size:        String(row['size'] || row['Size'] || '').trim(),
    quantity:    parseInt(row['quantity'] || row['Quantity'] || 1, 10),
    shipping_address: String(row['shipping_address'] || row['Shipping Address'] || '').trim(),
    sku_code:    String(row['sku_code'] || row['SKU Code'] || '').trim(),
    shop_code:   String(row['shop_code'] || row['Shop Code'] || '').trim(),
  })).filter(row => row.sku_code); // skip empty rows
}

module.exports = { parseExcel };
