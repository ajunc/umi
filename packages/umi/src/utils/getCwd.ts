import { isAbsolute, join } from 'path';

export default () => {
  // process.cwd()方法返回 Node.js 进程当前工作的目录
  let cwd = process.cwd();
  if (process.env.APP_ROOT) {
    // avoid repeat cwd path
    if (!isAbsolute(process.env.APP_ROOT)) {
      return join(cwd, process.env.APP_ROOT);
    }
    return process.env.APP_ROOT;
  }
  return cwd;
};
