import { IApi } from '@umijs/types';
import { winPath } from '@umijs/utils';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderReactPath, runtimePath } from './constants';

export function importsToStr(
  imports: { source: string; specifier?: string }[],
) {
  return imports.map((imp) => {
    const { source, specifier } = imp;
    if (specifier) {
      return `import ${specifier} from '${winPath(source)}';`;
    } else {
      return `import '${winPath(source)}';`;
    }
  });
}

export default function (api: IApi) {
  const {
    utils: { Mustache }, // js引擎模板
  } = api;

  // onGenerateFiles 生成临时文件，触发时机在 webpack 编译之前
  api.onGenerateFiles(async (args) => {
    // 模板文件
    const umiTpl = readFileSync(join(__dirname, 'umi.tpl'), 'utf-8');
    const rendererPath = await api.applyPlugins({
      key: 'modifyRendererPath',
      type: api.ApplyPluginsType.modify,
      initialValue: renderReactPath,
    });
    // 调用之前的 writeTmpFile 方法写文件
    api.writeTmpFile({
      path: 'umi.ts',
      // 替换模板中预先定义的变量
      content: Mustache.render(umiTpl, {
        // @ts-ignore
        enableTitle: api.config.title !== false,
        defaultTitle: api.config.title || '',
        rendererPath: winPath(rendererPath),
        runtimePath,
        rootElement: api.config.mountElementId,
        enableSSR: !!api.config.ssr,
        enableHistory: !!api.config.history,
        dynamicImport: !!api.config.dynamicImport,
        // 在入口文件最后添加代码。
        entryCode: (
          await api.applyPlugins({
            key: 'addEntryCode',
            type: api.ApplyPluginsType.add,
            initialValue: [],
          })
        ).join('\r\n'),
        // 在入口文件最前面（import 之后）添加代码。
        entryCodeAhead: (
          await api.applyPlugins({
            key: 'addEntryCodeAhead',
            type: api.ApplyPluginsType.add,
            initialValue: [],
          })
        ).join('\r\n'),
        // 添加补充相关的 import，在整个应用的最前面执行。
        polyfillImports: importsToStr(
          await api.applyPlugins({
            key: 'addPolyfillImports',
            type: api.ApplyPluginsType.add,
            initialValue: [],
          }),
        ).join('\r\n'),
        // 在入口文件现有 import 的前面添加 import。
        importsAhead: importsToStr(
          await api.applyPlugins({
            key: 'addEntryImportsAhead',
            type: api.ApplyPluginsType.add,
            initialValue: [],
          }),
        ).join('\r\n'),
        // 在入口文件现有 import 的后面添加 import。
        imports: importsToStr(
          await api.applyPlugins({
            key: 'addEntryImports',
            type: api.ApplyPluginsType.add,
            initialValue: [],
          }),
        ).join('\r\n'),
      }),
    });
  });
}
