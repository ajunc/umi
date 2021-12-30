// 使用 Node 核心模块 child_process 的 fork 方法，该接口专门用于衍生新的 Node.js 进程。
// 返回的子进程将内置一个额外的ipc通信通道，允许消息在父进程和子进程之间来回传递。
import { fork } from 'child_process';

const usedPorts: number[] = [];
let CURRENT_PORT: number | undefined;

interface IOpts {
  scriptPath: string;
}

export default function start({ scriptPath }: IOpts) {
  const execArgv = process.execArgv.slice(0);
  const inspectArgvIndex = execArgv.findIndex((argv) =>
    argv.includes('--inspect-brk'),
  );

  if (inspectArgvIndex > -1) {
    const inspectArgv = execArgv[inspectArgvIndex];
    execArgv.splice(
      inspectArgvIndex,
      1,
      inspectArgv.replace(/--inspect-brk=(.*)/, (match, s1) => {
        let port;
        try {
          port = parseInt(s1) + 1;
        } catch (e) {
          port = 9230; // node default inspect port plus 1.
        }
        if (usedPorts.includes(port)) {
          port += 1;
        }
        usedPorts.push(port);
        return `--inspect-brk=${port}`;
      }),
    );
  }

  // set port to env when current port has value
  if (CURRENT_PORT) {
    // @ts-ignore
    process.env.PORT = CURRENT_PORT;
  }

  // scriptPath 指的是 forkedDev 文件路径
  // process.argv.slice(2) 是命令参数 对于 umi dev 就是 ['dev']
  // process.execArgv 属性返回当 Node.js 进程被启动时，Node.js 特定的命令行选项
  const child = fork(scriptPath, process.argv.slice(2), { execArgv });

  // 子进程和主进程通讯
  // RESTART 重启，重新执行本方法
  // UPDATE_PORT，更新 CURRENT_PORT
  child.on('message', (data: any) => {
    const type = (data && data.type) || null;
    if (type === 'RESTART') {
      child.kill();
      start({ scriptPath });
    } else if (type === 'UPDATE_PORT') {
      // set current used port
      CURRENT_PORT = data.port as number;
    }
    process.send?.(data);
  });

  return child;
}
