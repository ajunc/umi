import { parse } from '@umijs/deps/compiled/dotenv';
import { existsSync, readFileSync } from 'fs';

/**
 * dotenv wrapper
 * @param envPath string
 */
//  loadEnv 方法用于加载 .env 或者是 .env.local 文件中的环境变量，如果文件存在，读取其中的每行，放入 process.env 
export default function loadDotEnv(envPath: string): void {
  if (existsSync(envPath)) {
    const parsed = parse(readFileSync(envPath, 'utf-8')) || {};
    Object.keys(parsed).forEach((key) => {
      // eslint-disable-next-line no-prototype-builtins
      if (!process.env.hasOwnProperty(key)) {
        process.env[key] = parsed[key];
      }
    });
  }
}
