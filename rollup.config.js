import commonjs from 'rollup-plugin-commonjs';
import babel from 'rollup-plugin-babel';
import json from 'rollup-plugin-json';
import { eslint } from 'rollup-plugin-eslint';
import pkg from './package.json';

const plugins = [
	eslint({
		exclude:      ['**/*.json', 'node_modules/**'],
		throwOnError: process.env.ROLLUP_WATCH != 'true'
	}),
	json({
		preferConst: true
	}),
	commonjs(),
	babel({
		runtimeHelpers: true
	})
];
const dependencies = [].concat(
	['crypto', 'stream', 'events', 'buffer', 'util'],
	Object.keys(pkg.dependencies)
);

function external(id) {
	return dependencies.some(_ =>
		_ == id || id.indexOf(`${_}/`) == 0
	);
}

export default {
	input:  'src/index.js',
	plugins,
	external,
	output: {
		file:      pkg.main,
		format:    'cjs',
		sourcemap: 'inline'
	}
};
