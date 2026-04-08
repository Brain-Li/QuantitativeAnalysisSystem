// 股票数据类型定义
export interface StockData {
  [key: string]: string | number | Date | null;
}

// 数据集类型
export interface Dataset {
  id: string;
  name: string;
  importTime: Date;
  dataCount: number;
  fields: string[];
  data: StockData[];
  /**
   * 本地导入：`indexeddb` 表示行数据在浏览器 IndexedDB，`data` 为空以减轻内存占用。
   * 未设置或 `inline` 表示行数据在 `data` 中（小表）。
   */
  storage?: "inline" | "indexeddb";
}

// 字段配置
export interface FieldConfig {
  name: string;
  visible: boolean;
  order: number;
}
