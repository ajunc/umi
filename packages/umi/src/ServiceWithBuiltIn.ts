import { IServiceOpts, Service as CoreService } from '@umijs/core';
import { dirname } from 'path';

class Service extends CoreService {
  constructor(opts: IServiceOpts) {
    // 增加 UMI_VERSION
    // umi 包 package.json 文件中定义的 version
    process.env.UMI_VERSION = require('../package').version;

    // 增加 UMI_DIR 
    // umi 这个包所在的路径
    // require.resolve 函数查询某个模块文件的带有完整绝对路径的文件名
    process.env.UMI_DIR = dirname(require.resolve('../package'));

    // super 实际上用在两种语法中:
    // constructor 内的 super(): 执行父类的构造函数。必须至少执行一次。
    // 一般方法内的 super.method(): 执行父类的 (未必同名的) 方法。不是必需。
    super({
      ...opts,
      presets: [
        // 后续看下 @umijs/preset-built-in 
        require.resolve('@umijs/preset-built-in'),
        ...(opts.presets || []),
      ],
      // umiAlias，该插件修改 webpack 配置中的 alias
      plugins: [require.resolve('./plugins/umiAlias'), ...(opts.plugins || [])],
    });
  }
}

export { Service };
