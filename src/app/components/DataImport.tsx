import { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import type { StockData, Dataset } from '../types';
import { readServerApiToken } from '../api/serverToken';
import { uploadExcelToServer } from '../api/serverApi';

interface DataImportProps {
  onDataImported: (dataset: Dataset) => void;
  existingDatasetNames: string[];
}

export function DataImport({ onDataImported, existingDatasetNames }: DataImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const useServer = !!readServerApiToken();
    if (useServer) {
      void runServerUpload(Array.from(files));
    } else {
      runClientParse(Array.from(files));
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  async function runServerUpload(files: File[]) {
    setUploading(true);
    let successCount = 0;
    let totalDataCount = 0;
    try {
      for (const file of files) {
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (extension !== 'xls' && extension !== 'xlsx') {
          toast.error(`${file.name}: 仅支持.xls或.xlsx格式`);
          continue;
        }
        if (existingDatasetNames.includes(file.name)) {
          toast.error(`${file.name}: 检测到重复文件，请勿重复导入相同数据集`);
          continue;
        }
        try {
          const dataset = await uploadExcelToServer(file);
          onDataImported(dataset);
          successCount++;
          totalDataCount += dataset.dataCount;
        } catch (err) {
          console.error(err);
          toast.error(
            `${file.name}: ${err instanceof Error ? err.message : '上传失败'}`
          );
        }
      }
      if (successCount > 0) {
        toast.success(`成功导入 ${successCount} 个数据集，共 ${totalDataCount} 条数据`);
      }
    } finally {
      setUploading(false);
    }
  }

  function runClientParse(files: File[]) {
    const totalFiles = files.length;
    let processedCount = 0;
    let successCount = 0;
    let totalDataCount = 0;

    files.forEach((file) => {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (extension !== 'xls' && extension !== 'xlsx') {
        toast.error(`${file.name}: 仅支持.xls或.xlsx格式`);
        processedCount++;
        checkAndShowSummary();
        return;
      }

      if (existingDatasetNames.includes(file.name)) {
        toast.error(`${file.name}: 检测到重复文件，请勿重复导入相同数据集`);
        processedCount++;
        checkAndShowSummary();
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });

          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];

          const jsonData: StockData[] = XLSX.utils.sheet_to_json(worksheet, {
            raw: false,
            dateNF: 'yyyy-mm-dd',
          });

          if (jsonData.length === 0) {
            toast.error(`${file.name}: 文件中没有数据`);
            processedCount++;
            checkAndShowSummary();
            return;
          }

          const fields = Object.keys(jsonData[0]);

          const dataset: Dataset = {
            id: `dataset_${Date.now()}_${Math.random()}`,
            name: file.name,
            importTime: new Date(),
            dataCount: jsonData.length,
            fields,
            data: jsonData,
          };

          onDataImported(dataset);
          successCount++;
          totalDataCount += jsonData.length;
          processedCount++;
          checkAndShowSummary();
        } catch (error) {
          console.error('Excel解析错误:', error);
          toast.error(`${file.name}: 文件解析失败`);
          processedCount++;
          checkAndShowSummary();
        }
      };

      reader.onerror = () => {
        toast.error(`${file.name}: 文件读取失败`);
        processedCount++;
        checkAndShowSummary();
      };

      reader.readAsBinaryString(file);
    });

    function checkAndShowSummary() {
      if (processedCount === totalFiles) {
        if (successCount > 0) {
          toast.success(`成功导入 ${successCount} 个数据集，共 ${totalDataCount} 条数据`);
        }
      }
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xls,.xlsx"
        onChange={handleFileSelect}
        className="hidden"
        multiple
        disabled={uploading}
      />
      <Button onClick={() => fileInputRef.current?.click()} size="default" disabled={uploading}>
        <Upload className="mr-2 h-4 w-4" />
        {uploading ? '上传中…' : '选择Excel文件（可多选）'}
      </Button>
    </>
  );
}
