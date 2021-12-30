import {
  compatESModuleRequire,
  createDebug,
  lodash,
  pkgUp,
  resolve,
  winPath,
} from '@umijs/utils';
import assert from 'assert';
import { existsSync } from 'fs';
import { basename, dirname, extname, join, relative } from 'path';
import { PluginType } from '../enums';
import { IPackage, IPlugin } from '../types';

const debug = createDebug('umi:core:Service:util:plugin');

interface IOpts {
  pkg: IPackage;
  cwd: string;
}

interface IResolvePresetsOpts extends IOpts {
  presets: string[];
  userConfigPresets: string[];
}

interface IResolvePluginsOpts extends IOpts {
  plugins: string[];
  userConfigPlugins: string[];
}

const RE = {
  [PluginType.plugin]: /^(@umijs\/|umi-)plugin-/,
  [PluginType.preset]: /^(@umijs\/|umi-)preset-/,
};

export function isPluginOrPreset(type: PluginType, name: string) {
  const hasScope = name.charAt(0) === '@';
  const re = RE[type];
  if (hasScope) {
    return re.test(name.split('/')[1]) || re.test(name);
  } else {
    return re.test(name);
  }
}

// getPluginsOrPresets 方法获得该项目的所有 preserts，或者是 plugins。

// 以 preserts 为例，项目 presets 来源有四处。

// 1、构造 Service 传参，@umijs/preset-built-in。
// 2、process.env 中指定。
// 3、package.json 中 devDependencies 指定，命名规则符合 /^(@umijs\/|umi-)preset-/ 这个正则。这一点就很牛逼了，只要安装，不用配置，就能使用。
// 4、用户在 .umirc.ts 文件中配置。
function getPluginsOrPresets(type: PluginType, opts: IOpts): string[] {
  const upperCaseType = type.toUpperCase();
  return [
    // opts
    ...((opts[type === PluginType.preset ? 'presets' : 'plugins'] as any) ||
      []),
    // env
    ...(process.env[`UMI_${upperCaseType}S`] || '').split(',').filter(Boolean),
    // dependencies
    ...Object.keys(opts.pkg.devDependencies || {})
      .concat(Object.keys(opts.pkg.dependencies || {}))
      .filter(isPluginOrPreset.bind(null, type)),
    // user config
    ...((opts[
      type === PluginType.preset ? 'userConfigPresets' : 'userConfigPlugins'
    ] as any) || []),
  ].map((path) => {
    if (typeof path !== 'string') {
      throw new Error(
        `Plugin resolved failed, Please check your plugins config, it must be array of string.\nError Plugin Config: ${JSON.stringify(
          path,
        )}`,
      );
    }
    // 变为绝对路径
    // extensions 表示该路径下顺位寻找 js 或是 ts 文件
    return resolve.sync(path, {
      basedir: opts.cwd,
      extensions: ['.js', '.ts'],
    });
  });
}

// e.g.
// initial-state -> initialState
// webpack.css-loader -> webpack.cssLoader
function nameToKey(name: string) {
  return name
    .split('.')
    .map((part) => lodash.camelCase(part))
    .join('.');
}

function pkgNameToKey(pkgName: string, type: PluginType) {
  // strip none @umijs scope
  if (pkgName.charAt(0) === '@' && !pkgName.startsWith('@umijs/')) {
    pkgName = pkgName.split('/')[1];
  }
  return nameToKey(pkgName.replace(RE[type], ''));
}

export function pathToObj({
  type,
  path,
  cwd,
}: {
  type: PluginType;
  path: string;
  cwd: string;
}) {
  let pkg = null;
  let isPkgPlugin = false;

  assert(existsSync(path), `${type} ${path} not exists, pathToObj failed`);

  const pkgJSONPath = pkgUp.sync({ cwd: path });
  // 找到路径下的 package.json 文件
  if (pkgJSONPath) {
    pkg = require(pkgJSONPath);
    // isPkgPlugin 表示是 persets
    isPkgPlugin =
      winPath(join(dirname(pkgJSONPath), pkg.main || 'index.js')) ===
      winPath(path);
  }

  // 设置 id
  let id;
  if (isPkgPlugin) {
    id = pkg!.name;
  } else if (winPath(path).startsWith(winPath(cwd))) {
    id = `./${winPath(relative(cwd, path))}`;
  } else if (pkgJSONPath) {
    id = winPath(join(pkg!.name, relative(dirname(pkgJSONPath), path)));
  } else {
    id = winPath(path);
  }
  id = id.replace('@umijs/preset-built-in/lib/plugins', '@@');
  id = id.replace(/\.js$/, '');

  // 设置 key
  // key 是驼峰式
  const key = isPkgPlugin
    ? pkgNameToKey(pkg!.name, type)
    : nameToKey(basename(path, extname(path)));

  return {
    id,
    key,
    path: winPath(path),
    apply() {
      // use function to delay require
      try {
        const ret = require(path);
        // use the default member for es modules
        return compatESModuleRequire(ret);
      } catch (e) {
        throw new Error(`Register ${type} ${path} failed, since ${e.message}`);
      }
    },
    defaultConfig: null,
  };
}

// resolvePresets 方法从四处获得 presets 全集的路径，然后根据路径获得 presets 文件。
export function resolvePresets(opts: IResolvePresetsOpts) {
  const type = PluginType.preset;
  // 获得 presets 路径
  const presets = [...getPluginsOrPresets(type, opts)];
  debug(`preset paths:`);
  debug(presets);
  return presets.map((path: string) => {
    return pathToObj({
      type,
      path,
      cwd: opts.cwd,
    });
  });
}

export function resolvePlugins(opts: IResolvePluginsOpts) {
  const type = PluginType.plugin;
  const plugins = getPluginsOrPresets(type, opts);
  debug(`plugin paths:`);
  debug(plugins);
  return plugins.map((path: string) => {
    return pathToObj({
      type,
      path,
      cwd: opts.cwd,
    });
  });
}

export function isValidPlugin(plugin: IPlugin) {
  return plugin.id && plugin.key && plugin.apply;
}
