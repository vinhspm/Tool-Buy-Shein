const XLSX = require('xlsx');
const path = require('path');

/**
 * Reads an Excel (.xlsx) file and returns array of row objects.
 * Expected columns: product_url, color, size, quantity, shipping_address
 */
function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return rows.map((row, index) => ({
    rowIndex: index + 2, // Excel row number (1-based header)
    product_url: String(row['product_url'] || row['Product URL'] || '').trim(),
    color:       String(row['color'] || row['Color'] || '').trim(),
    size:        String(row['size'] || row['Size'] || '').trim(),
    quantity:    parseInt(row['quantity'] || row['Quantity'] || 1, 10),
    shipping_address: String(row['shipping_address'] || row['Shipping Address'] || '').trim(),
  })).filter(row => row.product_url); // skip empty rows
}

module.exports = { parseExcel };
