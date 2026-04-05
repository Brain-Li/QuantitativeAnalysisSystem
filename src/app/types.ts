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
}

// 字段配置
export interface FieldConfig {
  name: string;
  visible: boolean;
  order: number;
}
