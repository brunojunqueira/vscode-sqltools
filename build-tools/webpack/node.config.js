const path = require('path');
const setDefaults = require('./../common/set-defaults');
const parseEntries = require('./../common/parse-entries');
const webpack = require('webpack');

/**
 *
 * @param {object} entries
 * @param {string} packagePath
 * @returns {webpack.Configuration['plugins']}
 */
module.exports = function getNodeConfig({ entries, packagePath, externals = {} }) {
  const { entry, outDir, babelOptions } = parseEntries(entries, packagePath);

  /** @type webpack.Configuration */
  let config = {
    name: 'ls',
    target: 'node',
    entry,
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: [
            process.env.NODE_ENV !== 'development' && { loader: 'babel-loader', options: babelOptions },
            { loader: 'ts-loader', options: { transpileOnly: true } },
          ].filter(Boolean),
          exclude: /node_modules|\.test\..+/i,
        },
        process.env.NODE_ENV !== 'development' && {
          test: /\.js$/,
          use: [{ loader: 'babel-loader', options: babelOptions }],
          exclude: /\.test\..+/i,

        }
      ].filter(Boolean),
    },
    resolve: {
      extensions: ['.ts', '.js', '.json'],
      alias: {
        'pg-native': path.join(packagePath, '../../', 'node_modules/pg/lib/native/index.js'),
      },
      modules: ['node_modules', path.join(packagePath, '..', '..', 'node_modules')],
    },
    output: {
      filename: '[name].js',
      libraryTarget: 'commonjs2',
      ...(outDir ? {
        path: outDir
      } : {}),
    },
    externals: {
      // @TODO move to driver package
      // ibm_db: 'commonjs ibm_db',
      // oracledb: 'commonjs oracledb',
      // 'original-fs': 'fs',
      // '@sap/hana-client': 'commonjs @sap/hana-client',
      ...externals,
    },
  };

  return setDefaults(config);
};
