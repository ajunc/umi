import { lodash, winPath } from '@umijs/utils';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { IServicePaths } from './types';

function isDirectoryAndExist(path: string) {
  return existsSync(path) && statSync(path).isDirectory();
}

function normalizeWithWinPath<T extends Record<any, string>>(obj: T) {
  return lodash.mapValues(obj, (value) => winPath(value));
}

export default function getServicePaths({
  cwd,
  config,
  env,
}: {
  cwd: string;
  config: any;
  env?: string;
}): IServicePaths {
  // absSrcPath 表示项目的根目录
  let absSrcPath = cwd;
  // 若果存在 src 目录，将 absSrcPath 定位到 src 路径下
  if (isDirectoryAndExist(join(cwd, 'src'))) {
    absSrcPath = join(cwd, 'src');
  }
  // singular 配置是否启用单数模式的目录(umi 竟然这个都管，醉了)
  // 如果配置了 singular，那么就是 src/page，默认是 src/pages
  const absPagesPath = config.singular
    ? join(absSrcPath, 'page')
    : join(absSrcPath, 'pages');
  // 临时文件路径
  const tmpDir = ['.umi', env !== 'development' && env]
    .filter(Boolean)
    .join('-');
  // outputPath 指定输出路径
  return normalizeWithWinPath({
    cwd,
    absNodeModulesPath: join(cwd, 'node_modules'),
    absOutputPath: join(cwd, config.outputPath || './dist'),
    absSrcPath,
    absPagesPath,
    absTmpPath: join(absSrcPath, tmpDir),
  });
}
