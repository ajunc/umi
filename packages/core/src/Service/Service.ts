import { AsyncSeriesWaterfallHook } from '@umijs/deps/compiled/tapable';
import { BabelRegister, lodash, NodeEnv } from '@umijs/utils';
import assert from 'assert';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { join } from 'path';
import Config from '../Config/Config';
import { getUserConfigWithKey } from '../Config/utils/configUtils';
import Logger from '../Logger/Logger';
import {
  ApplyPluginsType,
  ConfigChangeType,
  EnableBy,
  PluginType,
  ServiceStage,
} from './enums';
import getPaths from './getPaths';
import PluginAPI from './PluginAPI';
import { ICommand, IHook, IPackage, IPlugin, IPreset } from './types';
import isPromise from './utils/isPromise';
import loadDotEnv from './utils/loadDotEnv';
import { pathToObj, resolvePlugins, resolvePresets } from './utils/pluginUtils';

const logger = new Logger('umi:core:Service');

export interface IServiceOpts {
  cwd: string;
  pkg?: IPackage;
  presets?: string[];
  plugins?: string[];
  configFiles?: string[];
  env?: NodeEnv;
}

interface IConfig {
  presets?: string[];
  plugins?: string[];
  [key: string]: any;
}

// TODO
// 1. duplicated key

// Node.js 所有的异步 I/O 操作在完成时都会发送一个事件到事件队列。
// Node.js 里面的许多对象都会分发事件：一个 net.Server 对象会在每次有新连接时触发一个事件， 
// 一个 fs.readStream 对象会在文件被打开的时候触发一个事件。 所有这些产生事件的对象都是 events.EventEmitter 的实例。
// EventEmitter 的核心就是事件触发与事件监听器功能的封装
export default class Service extends EventEmitter {
  // 项目根路径
  cwd: string;
  // 项目 package.json 文件的绝对路径
  pkg: IPackage;
  skipPluginIds: Set<string> = new Set<string>();
  // lifecycle stage
  // 生命周期，表示执行到什么阶段
  stage: ServiceStage = ServiceStage.uninitialized;
  // registered commands
  commands: {
    [name: string]: ICommand | string;
  } = {};
  // including presets and plugins
  // 存放解析完成之后所有的 plugin
  plugins: {
    [id: string]: IPlugin;
  } = {};
  // plugin methods
  // key 是方法名
  pluginMethods: {
    [name: string]: Function;
  } = {};
  // initial presets and plugins from arguments, config, process.env, and package.json
  // 初始化时候扫描到的 Presets
  initialPresets: IPreset[];
  // 初始化时候扫描到的 Plugins
  initialPlugins: IPlugin[];
  // presets and plugins for registering
  _extraPresets: IPreset[] = [];
  _extraPlugins: IPlugin[] = [];
  // user config
  // (.umirc.ts等文件)用户配置
  userConfig: IConfig;
  // configInstance 是处理用户配置的一个类，userConfig 就是 configInstance 处理的结果
  configInstance: Config;
  config: IConfig | null = null;
  // babel register
  babelRegister: BabelRegister;
  // hooks
  hooksByPluginId: {
    [id: string]: IHook[];
  } = {};
  hooks: {
    [key: string]: IHook[];
  } = {};
  // paths
  // 根据 userConfig 生成的路径信息
  paths: {
    // 项目根目录
    cwd?: string;
    // node modules 文件目录
    absNodeModulesPath?: string;
    // 如果有 src 就是 src 目录
    absSrcPath?: string;
     // pages 或 page，默认pages，可配置
    absPagesPath?: string;
    // 默认 dist，可配置
    absOutputPath?: string;
    // .umi
    absTmpPath?: string;
  } = {};
  env: string | undefined;
  ApplyPluginsType = ApplyPluginsType;
  EnableBy = EnableBy;
  ConfigChangeType = ConfigChangeType;
  ServiceStage = ServiceStage;
  args: any;

  constructor(opts: IServiceOpts) {
    super();

    logger.debug('opts:');
    logger.debug(opts);
     // 从入参或者 process 获得 cwd pkg env
    this.cwd = opts.cwd || process.cwd();
    // repoDir should be the root dir of repo
    this.pkg = opts.pkg || this.resolvePackage();
    this.env = opts.env || process.env.NODE_ENV;
    // cwd 必须存在
    assert(existsSync(this.cwd), `cwd ${this.cwd} does not exist.`);

    // register babel before config parsing
    this.babelRegister = new BabelRegister();

    // load .env or .local.env
    logger.debug('load env');
    // 加载环境变量
    this.loadEnv();

    // get user config without validation
    logger.debug('get user config');

    // 创建 Config 对象，获得 userConfig
    // Config 也是 umi 中非常重要的一个类，负责 umi 配置文件的解析
    const configFiles = opts.configFiles;
    this.configInstance = new Config({
      cwd: this.cwd,
      service: this,
      localConfig: this.env === 'development',
      configFiles:
        Array.isArray(configFiles) && !!configFiles[0]
          ? configFiles
          : undefined,
    });

    // Umi 可以在在 .umirc.ts(js) 或 config/config.ts(js) 中配置项目和插件，
    // getUserConfig 方法会从者几个文件中找出存在的那个文件，读取其中的配置。
    // userConfig 获得配置文件(.umirc.ts 等) export 的对象
    this.userConfig = this.configInstance.getUserConfig();
    logger.debug('userConfig:');
    logger.debug(this.userConfig);

    // get paths
    // userConfig 中我们配置了一些路径，这里通过 userConfig 中的配置计算路径。
    // 比如 userConfig.outputPath 配置了输出文件路径，默认是 dist
    this.paths = getPaths({
      cwd: this.cwd,
      config: this.userConfig!,
      env: this.env,
    });
    logger.debug('paths:');
    logger.debug(this.paths);

    // setup initial presets and plugins
    const baseOpts = {
      pkg: this.pkg,
      cwd: this.cwd,
    };

    // 初始化 Presets, 来源于四处
    // 1. 构造 Service 传参
    // 2. process.env 中指定
    // 3. package.json 中 devDependencies 指定
    // 4. 用户在 .umirc.ts 文件中配置。
    this.initialPresets = resolvePresets({
      ...baseOpts,
      presets: opts.presets || [],
      userConfigPresets: this.userConfig.presets || [],
    });

    // 为了方便理解，举个例子，在 package.json 中安装了 @umijs/preset-react，那最终会生成这样一个对象
    // {
    //   id: '@umijs/preset-react',
    //   key: 'react',
    //   path: '项目地址/node_modules/@umijs/preset-react/lib/index.js',
    //   apply: ...,
    //   defaultConfig: null
    // }

    // 初始化 Plugins。和 Presets 一样
    this.initialPlugins = resolvePlugins({
      ...baseOpts,
      plugins: opts.plugins || [],
      userConfigPlugins: this.userConfig.plugins || [],
    });

    // 在 umi 命令章节，，看到 umi 默认增加了一个 umiAlias plugin，生成如下对象。
    // {
    //   id: './node_modules/umi/lib/plugins/umiAlias',
    //   key: 'umiAlias',
    //   path: '项目地址/node_modules/umi/lib/plugins/umiAlias.js',
    //   apply: ...,
    //   defaultConfig: null
    // }

    // initialPresets 和 initialPlugins 放入 babelRegister 中
    this.babelRegister.setOnlyMap({
      key: 'initialPlugins',
      value: lodash.uniq([
        ...this.initialPresets.map(({ path }) => path),
        ...this.initialPlugins.map(({ path }) => path),
      ]),
    });
    logger.debug('initial presets:');
    logger.debug(this.initialPresets);
    logger.debug('initial plugins:');
    logger.debug(this.initialPlugins);
  }

  setStage(stage: ServiceStage) {
    this.stage = stage;
  }

  resolvePackage() {
    try {
      return require(join(this.cwd, 'package.json'));
    } catch (e) {
      return {};
    }
  }

  loadEnv() {
    // 当前项目路径下的 .env 文件
    const basePath = join(this.cwd, '.env');
    // 当前项目路径下的 .env.local 文件
    const localPath = `${basePath}.local`;
    loadDotEnv(localPath);
    loadDotEnv(basePath);
  }

  async init() {
    this.setStage(ServiceStage.init);
    // we should have the final hooksByPluginId which is added with api.register()
    // 获得plugin列表
    await this.initPresetsAndPlugins();

    // collect false configs, then add to this.skipPluginIds
    // skipPluginIds include two parts:
    // 1. api.skipPlugins()
    // 2. user config with the `false` value
    // Object.keys(this.hooksByPluginId).forEach(pluginId => {
    //   const { key } = this.plugins[pluginId];
    //   if (this.getPluginOptsWithKey(key) === false) {
    //     this.skipPluginIds.add(pluginId);
    //   }
    // });

    // delete hooks from this.hooksByPluginId with this.skipPluginIds
    // for (const pluginId of this.skipPluginIds) {
    //   if (this.hooksByPluginId[pluginId]) delete this.hooksByPluginId[pluginId];
    //   delete this.plugins[pluginId];
    // }

    // hooksByPluginId -> hooks
    // hooks is mapped with hook key, prepared for applyPlugins()
    this.setStage(ServiceStage.initHooks);

    // key是plugin或者preset的id， value是一系列的hook
    // hooksByPluginId 中注册了所有的plugin要执行的方法
    Object.keys(this.hooksByPluginId).forEach((id) => {
      const hooks = this.hooksByPluginId[id];
      hooks.forEach((hook) => {
        // key代表hook名称
        const { key } = hook;
        hook.pluginId = id;

        // hook 中有字段 pluginId（插件id），key（hook名称），fn（hook执行方法）
        this.hooks[key] = (this.hooks[key] || []).concat(hook);
      });
    });

    // plugin is totally ready
    // 触发所有插件的 onPluginReady 方法
    // onPluginReady 在插件初始化完成触发。在 onStart 之前，此时还没有 config 和 paths，他们尚未解析好。
    this.setStage(ServiceStage.pluginReady);
    await this.applyPlugins({
      key: 'onPluginReady',
      type: ApplyPluginsType.event,
    });

    // get config, including:
    // 1. merge default config
    // 2. validate
    // modifyDefaultConfig 修改默认配置。
    this.setStage(ServiceStage.getConfig);
    const defaultConfig = await this.applyPlugins({
      key: 'modifyDefaultConfig',
      type: this.ApplyPluginsType.modify,
      initialValue: await this.configInstance.getDefaultConfig(),
    });

    // modifyConfig 修改最终配置
    this.config = await this.applyPlugins({
      key: 'modifyConfig',
      type: this.ApplyPluginsType.modify,
      initialValue: this.configInstance.getConfig({
        defaultConfig,
      }) as any,
    });

    // merge paths to keep the this.paths ref
    this.setStage(ServiceStage.getPaths);
    // config.outputPath may be modified by plugins
    if (this.config!.outputPath) {
      this.paths.absOutputPath = join(this.cwd, this.config!.outputPath);
    }

    // 修改 paths 对象
    const paths = (await this.applyPlugins({
      key: 'modifyPaths',
      type: ApplyPluginsType.modify,
      initialValue: this.paths,
    })) as object;
    Object.keys(paths).forEach((key) => {
      this.paths[key] = paths[key];
    });
  }

  async initPresetsAndPlugins() {
    this.setStage(ServiceStage.initPresets);
    // this._extraPlugins 中存放了解析 presets 过程中得到的 plugin
    this._extraPlugins = [];

    // 遍历 initialPresets，分别 init
    while (this.initialPresets.length) {
      await this.initPreset(this.initialPresets.shift()!);
    }

    this.setStage(ServiceStage.initPlugins);

    // 遍历plugin 全集，分别 init
    this._extraPlugins.push(...this.initialPlugins);
    while (this._extraPlugins.length) {
      await this.initPlugin(this._extraPlugins.shift()!);
    }
  }

  getPluginAPI(opts: any) {
    const pluginAPI = new PluginAPI(opts);

    // register built-in methods
    // 为这个 preset 或者是 plugin 增加沟子
    // 这几个方法会在 init 中依次被触发 
    [
      'onPluginReady', // 在插件初始化完成触发
      'modifyPaths', // 在插件初始化完成触发
      'onStart', // 在命令注册函数执行前触发
      'modifyDefaultConfig', // 修改默认配置
      'modifyConfig', // 修改最终配置
    ].forEach((name) => {
      // 这几个都属于扩展方法
      pluginAPI.registerMethod({ name, exitsError: false });
    });

    // 设置 pluginAPI 代理
    // pluginAPI 可以获得 service 中的部分成员变量
    // 还可以拿到 pluginMethods 中注册的方法
    return new Proxy(pluginAPI, {
      get: (target, prop: string) => {
        // 由于 pluginMethods 需要在 register 阶段可用
        // 必须通过 proxy 的方式动态获取最新，以实现边注册边使用的效果
        if (this.pluginMethods[prop]) return this.pluginMethods[prop];
        if (
          [
            'applyPlugins',
            'ApplyPluginsType',
            'EnableBy',
            'ConfigChangeType',
            'babelRegister',
            'stage',
            'ServiceStage',
            'paths',
            'cwd',
            'pkg',
            'userConfig',
            'config',
            'env',
            'args',
            'hasPlugins',
            'hasPresets',
          ].includes(prop)
        ) {
          return typeof this[prop] === 'function'
            ? this[prop].bind(this)
            : this[prop];
        }
        return target[prop];
      },
    });
  }

  async applyAPI(opts: { apply: Function; api: PluginAPI }) {
    let ret = opts.apply()(opts.api);
    if (isPromise(ret)) {
      ret = await ret;
    }
    return ret || {};
  }

  async initPreset(preset: IPreset) {
    const { id, key, apply } = preset;
    // 标记位 用于深度遍历
    preset.isPreset = true;

    // 获得一个 PluginAPI 的实例，通过该实例可以拿到 service 中的部分成员变量以及注册到 pluginMethods 中的方法
    // api 是插件编写的入参，插件对外暴露方法就靠 api
    const api = this.getPluginAPI({ id, key, service: this });

    // register before apply
    // preset 集成了 plugin
    // this.plugins[plugin.id] = plugin;
    this.registerPlugin(preset);
    // TODO: ...defaultConfigs 考虑要不要支持，可能这个需求可以通过其他渠道实现
    // 这里获得的就是这个 preset 中包含的 presets 和 plugins
    const { presets, plugins, ...defaultConfigs } = await this.applyAPI({
      api,
      apply,
    });

    // register extra presets and plugins
    if (presets) {
      assert(
        Array.isArray(presets),
        `presets returned from preset ${id} must be Array.`,
      );
      // 插到最前面，下个 while 循环优先执行
      this._extraPresets.splice(
        0,
        0,
        ...presets.map((path: string) => {
          return pathToObj({
            type: PluginType.preset,
            path,
            cwd: this.cwd,
          });
        }),
      );
    }

    // 深度优先
    const extraPresets = lodash.clone(this._extraPresets);
    this._extraPresets = [];
    while (extraPresets.length) {
      await this.initPreset(extraPresets.shift()!);
    }

    if (plugins) {
      assert(
        Array.isArray(plugins),
        `plugins returned from preset ${id} must be Array.`,
      );
      // 将解析出的 pluigin 放到 _extraPlugins 中
      this._extraPlugins.push(
        ...plugins.map((path: string) => {
          return pathToObj({
            type: PluginType.plugin,
            path,
            cwd: this.cwd,
          });
        }),
      );
    }
  }

  async initPlugin(plugin: IPlugin) {
    const { id, key, apply } = plugin;
    // 为 plugin 增加 hook 调用
    const api = this.getPluginAPI({ id, key, service: this });

    // register before apply
    this.registerPlugin(plugin);

    // 执行插件，插件的执行主要是调用 api 上的方法，进行 hook 等相关的注册
    await this.applyAPI({ api, apply });
  }

  getPluginOptsWithKey(key: string) {
    return getUserConfigWithKey({
      key,
      userConfig: this.userConfig,
    });
  }

  //registerPlugin 将 plugin 注册到 service 的 plugins 字段上。
  //这个方法虽然叫 registerPlugin，但是 preset 其实也会注册到上面。
  registerPlugin(plugin: IPlugin) {
    // 考虑要不要去掉这里的校验逻辑
    // 理论上不会走到这里，因为在 describe 的时候已经做了冲突校验
    if (this.plugins[plugin.id]) {
      const name = plugin.isPreset ? 'preset' : 'plugin';
      throw new Error(`\
${name} ${plugin.id} is already registered by ${this.plugins[plugin.id].path}, \
${name} from ${plugin.path} register failed.`);
    }
    this.plugins[plugin.id] = plugin;
  }

  isPluginEnable(pluginId: string) {
    // api.skipPlugins() 的插件
    if (this.skipPluginIds.has(pluginId)) return false;

    const { key, enableBy } = this.plugins[pluginId];

    // 手动设置为 false
    if (this.userConfig[key] === false) return false;

    // 配置开启
    if (enableBy === this.EnableBy.config && !(key in this.userConfig)) {
      return false;
    }

    // 函数自定义开启
    if (typeof enableBy === 'function') {
      return enableBy();
    }

    // 注册开启
    return true;
  }

  hasPlugins(pluginIds: string[]) {
    return pluginIds.every((pluginId) => {
      const plugin = this.plugins[pluginId];
      return plugin && !plugin.isPreset && this.isPluginEnable(pluginId);
    });
  }

  hasPresets(presetIds: string[]) {
    return presetIds.every((presetId) => {
      const preset = this.plugins[presetId];
      return preset && preset.isPreset && this.isPluginEnable(presetId);
    });
  }

  //applyPlugins 算是插件的核心方法，使用了 tapable 用于插件事件发布订阅和执行。
  async applyPlugins(opts: {
    key: string;
    type: ApplyPluginsType;
    initialValue?: any;
    args?: any;
  }) {
    // 通过 hook 名称获得 hook 列表
    const hooks = this.hooks[opts.key] || [];
    switch (opts.type) {
      case ApplyPluginsType.add:
        if ('initialValue' in opts) {
          assert(
            Array.isArray(opts.initialValue),
            `applyPlugins failed, opts.initialValue must be Array if opts.type is add.`,
          );
        }
        const tAdd = new AsyncSeriesWaterfallHook(['memo']);
        for (const hook of hooks) {
          if (!this.isPluginEnable(hook.pluginId!)) {
            continue;
          }
          // 注册回调
          tAdd.tapPromise(
            {
              name: hook.pluginId!,
              stage: hook.stage || 0,
              // @ts-ignore
              before: hook.before,
            },
            async (memo: any[]) => {
              const items = await hook.fn(opts.args);
              return memo.concat(items);
            },
          );
        }
        return await tAdd.promise(opts.initialValue || []);
      // modify，需对第一个参数做修改 
      case ApplyPluginsType.modify:
        const tModify = new AsyncSeriesWaterfallHook(['memo']);
        for (const hook of hooks) {
          if (!this.isPluginEnable(hook.pluginId!)) {
            continue;
          }
          tModify.tapPromise(
            {
              name: hook.pluginId!,
              stage: hook.stage || 0,
              // @ts-ignore
              before: hook.before,
            },
            async (memo: any) => {
              return await hook.fn(memo, opts.args);
            },
          );
        }
        return await tModify.promise(opts.initialValue);
      case ApplyPluginsType.event:
        // AsyncSeriesWaterfallHook 是一个异步钩子，上一个注册的异步回调执行之后的返回值会传递给下一个注册的回调
        const tEvent = new AsyncSeriesWaterfallHook(['_']);
        for (const hook of hooks) {
          if (!this.isPluginEnable(hook.pluginId!)) {
            continue;
          }
          // tapPromise 用于注册回调，回到函数中同步执行 hook 中的 fn 方法
          tEvent.tapPromise(
            {
              name: hook.pluginId!,
              stage: hook.stage || 0,
              // @ts-ignore
              before: hook.before,
            },
            async () => {
              await hook.fn(opts.args);
            },
          );
        }
        // 触发回调函数
        return await tEvent.promise();
      default:
        throw new Error(
          `applyPlugin failed, type is not defined or is not matched, got ${opts.type}.`,
        );
    }
  }

  async run({ name, args = {} }: { name: string; args?: any }) {
    args._ = args._ || [];
    // shift the command itself
    if (args._[0] === name) args._.shift();

    this.args = args;
    await this.init();

    logger.debug('plugins:');
    logger.debug(this.plugins);

    this.setStage(ServiceStage.run);
    // 执行 hook 的 onStart 方法
    await this.applyPlugins({
      key: 'onStart',
      type: ApplyPluginsType.event,
      args: {
        name,
        args,
      },
    });
    return this.runCommand({ name, args });
  }

  async runCommand({ name, args = {} }: { name: string; args?: any }) {
    assert(this.stage >= ServiceStage.init, `service is not initialized.`);

    args._ = args._ || [];
    // shift the command itself
    if (args._[0] === name) args._.shift();

    const command =
      typeof this.commands[name] === 'string'
        ? this.commands[this.commands[name] as string]
        : this.commands[name];
    assert(command, `run command failed, command ${name} does not exists.`);

    const { fn } = command as ICommand;
    return fn({ args });
  }
}

// 总结：

// umi 其实是一个插件和配置管理器。

// 为什么说它是配置管理器呢，umi 负责读取配置文件，收集用户配置，这些配置本身只是作为一个记录存在，并不生效。

// umi 的大部分作用是对插件的管理，umi 定义的 preset 和 plugin，本质都是 plugin。
//umi 定义了 PluginApi，该 api 提供了插件的核心方法，plugin 可以通过这个 api 注册一些特定阶段的行为。umi 会根据当前阶段依次调用插件注册的方法。

// umi 通过插件的形式实现了框架和业务的解耦，由于 umi 本身不负责任何的业务，用户可以通过安装不同的插件实现自定义的行为控制。
