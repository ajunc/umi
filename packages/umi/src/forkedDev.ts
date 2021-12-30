import { chalk, yParser } from '@umijs/utils';
import initWebpack from './initWebpack';
import { Service } from './ServiceWithBuiltIn';
import getCwd from './utils/getCwd';
import getPkg from './utils/getPkg';

const args = yParser(process.argv.slice(2));

(async () => {
  try {
    process.env.NODE_ENV = 'development';
    // Init webpack version determination and require hook
    initWebpack();

    // umi 的命令执行流程：

    // 1、参数规范化。
    // 2、处理 version 和 help 命令。
    // 3、启动新的 nodejs 进程，处理子进程和主进程通讯，用于停止子进程。
    // 4、构造 Service 对象，传入了一个 presets 和 一个 plugin， 执行该对象 run 方法。
    // 5、不论是调用 start 还是 build 方法，最终的目的都是生成一个 service 对象，service 对象是 umi 的核心对象，用于实现 umi 的插件机制。

    // 核心代码， umi build 时执行的也是这段代码
    const service = new Service({
      cwd: getCwd(),
      pkg: getPkg(process.cwd()),
    });
    await service.run({
      name: 'dev',
      args,
    });

    let closed = false;
    // kill(2) Ctrl-C
    process.once('SIGINT', () => onSignal('SIGINT'));
    // kill(3) Ctrl-\
    process.once('SIGQUIT', () => onSignal('SIGQUIT'));
    // kill(15) default
    process.once('SIGTERM', () => onSignal('SIGTERM'));

    function onSignal(signal: string) {
      if (closed) return;
      closed = true;

      // 退出时触发插件中的onExit事件
      service.applyPlugins({
        key: 'onExit',
        type: service.ApplyPluginsType.event,
        args: {
          signal,
        },
      });
      process.exit(0);
    }
  } catch (e) {
    console.error(chalk.red(e.message));
    console.error(e.stack);
    process.exit(1);
  }
})();
