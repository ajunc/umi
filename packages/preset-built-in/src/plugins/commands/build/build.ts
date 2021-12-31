import { Logger } from '@umijs/core';
import { IApi } from '@umijs/types';
import { existsSync } from 'fs';
import { relative } from 'path';
import {
  cleanTmpPathExceptCache,
  getBundleAndConfigs,
  printFileSizes,
} from '../buildDevUtils';
import generateFiles from '../generateFiles';

const logger = new Logger('umi:preset-build-in');

export default function (api: IApi) {
  const {
    paths,
    // rimraf 包的作用：以包的形式包装rm -rf命令，用来删除文件和文件夹的，不管文件夹是否为空，都可删除.
    utils: { rimraf },
  } = api;

  api.registerCommand({
    name: 'build',
    description: 'build application for production',
    fn: async function () {
      // 删除 absTmpPath 路径下非  .cache 文件，具体代码很简单，就不看了
      cleanTmpPathExceptCache({
        absTmpPath: paths.absTmpPath!,
      });

      // generate files
      // 生成文件 onGenerateFiles hook
      await generateFiles({ api, watch: false });

      // build
      // 生成配置信息
      const { bundler, bundleConfigs, bundleImplementor } =
        await getBundleAndConfigs({ api });
      try {
        // clear output path before exec build
        if (process.env.CLEAR_OUTPUT !== 'none') {
          if (paths.absOutputPath && existsSync(paths.absOutputPath || '')) {
            logger.debug(`Clear OutputPath: ${paths.absNodeModulesPath}`);
            rimraf.sync(paths.absOutputPath);
          }
        }
        
        // bundler 调用 build 方法，进行打包
        const { stats } = await bundler.build({
          bundleConfigs,
          bundleImplementor,
        });
        if (process.env.RM_TMPDIR !== 'none') {
          cleanTmpPathExceptCache({
            absTmpPath: paths.absTmpPath!,
          });
        }
        printFileSizes(stats!, relative(process.cwd(), paths.absOutputPath!));
        // 构建完成时可以做的事。可能是失败的，注意判断 err 参数
        await api.applyPlugins({
          key: 'onBuildComplete',
          type: api.ApplyPluginsType.event,
          args: {
            stats,
          },
        });
      } catch (err) {
        await api.applyPlugins({
          key: 'onBuildComplete',
          type: api.ApplyPluginsType.event,
          args: {
            err,
          },
        });
        // throw build error
        throw err;
      }
    },
  });
}
