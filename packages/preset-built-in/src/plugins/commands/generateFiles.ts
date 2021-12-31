import { IApi } from '@umijs/types';
import { chokidar, lodash, winPath } from '@umijs/utils';
import { join } from 'path';

export default async ({ api, watch }: { api: IApi; watch?: boolean }) => {
  const { paths } = api;

  // 生成临时文件
  // 想要生成文件，实现 onGenerateFiles 方法
  async function generate(files?: { event: string; path: string }[]) {
    api.logger.debug('generate files', files);
    await api.applyPlugins({
      key: 'onGenerateFiles',
      type: api.ApplyPluginsType.event,
      args: {
        files: files || [],
      },
    });
  }

  const watchers: chokidar.FSWatcher[] = [];

  await generate();
  // watch 表示是否监听文件的变化
  if (watch) {
    // 添加重新临时文件生成的监听路径
    const watcherPaths = await api.applyPlugins({
      key: 'addTmpGenerateWatcherPaths',
      type: api.ApplyPluginsType.add,
      initialValue: [
        paths.absPagesPath!,
        join(paths.absSrcPath!, api.config?.singular ? 'layout' : 'layouts'),
        join(paths.absSrcPath!, 'app.tsx'),
        join(paths.absSrcPath!, 'app.ts'),
        join(paths.absSrcPath!, 'app.jsx'),
        join(paths.absSrcPath!, 'app.js'),
      ],
    });
    lodash
      .uniq<string>(watcherPaths.map((p: string) => winPath(p)))
      .forEach((p: string) => {
        // 生成监听
        createWatcher(p);
      });
    // process.on('SIGINT', () => {
    //   console.log('SIGINT');
    //   unwatch();
    // });
  }

  function unwatch() {
    watchers.forEach((watcher) => {
      watcher.close();
    });
  }
  
  // Nodejs里的 chokidar 模块可以更好的对文件进行监控，不会产生多次的事件
  function createWatcher(path: string) {
    const watcher = chokidar.watch(path, {
      // ignore .dotfiles and _mock.js
      ignored: /(^|[\/\\])(_mock.js$|\..)/,
      ignoreInitial: true,
    });
    let timer: any = null;
    let files: { event: string; path: string }[] = [];
    watcher.on('all', (event: string, path: string) => {
      if (timer) {
        clearTimeout(timer);
      }
      files.push({ event, path: winPath(path) });
      timer = setTimeout(async () => {
        timer = null;
        await generate(files);
        files = [];
      }, 2000);
    });
    watchers.push(watcher);
  }

  return unwatch;
};
