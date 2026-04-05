import XLSX from 'xlsx';

/**
 * 解析 Excel Buffer → 行对象数组（与前端 xlsx 行为接近）
 */
export function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel 中没有工作表');
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    raw: false,
    dateNF: 'yyyy-mm-dd',
    defval: null,
  });
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('工作表中没有数据行');
  }
  const fields = Object.keys(rows[0]);
  return { fields, rows };
}
