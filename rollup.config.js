import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import babel from 'rollup-plugin-babel';
import eslint from 'rollup-plugin-eslint';
import pkg from './package.json';

const plugins = [
	eslint({
		exclude:      ['**/*.json', 'node_modules/**'],
		throwOnError: process.env.ROLLUP_WATCH != 'true'
	}),
	json({
		preferConst: true
	}),
	babel(Object.assign({
		runtimeHelpers: true,
		babelrc:        false,
		exclude:        'node_modules/**'
	}, pkg.babel, {
		presets: pkg.babel.presets.map(_ => (
			_ == 'env'
				? 'es2015-rollup'
				: _
		))
	})),
	resolve({
		preferBuiltins: true
	}),
	commonjs()
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

export default [{
	input:  'src/index.js',
	watch:  {
		include: 'src/**/*.js'
	},
	plugins,
	external,
	output: {
		file:      pkg.main,
		format:    'cjs',
		sourcemap: true
	}
}];
