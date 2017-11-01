import { PluginError } from 'gulp-util';
import through from 'through2';
import Cache from 'cache-swap';
import File from 'vinyl';
import pick from 'object.pick';
import TaskProxy from './task-proxy';
import { version as VERSION } from '../package.json';

const fileCache = new Cache({ cacheDirName: 'gulp-cache' });

function defaultKey(file) {
	return `${VERSION}${file.contents.toString('base64')}`;
}

function defaultRestore(restored) {

	if (restored.contents) {
		// Handle node 0.11 buffer to JSON as object with { type: 'buffer', data: [...] }
		if (restored && restored.contents && Array.isArray(restored.contents.data)) {
			restored.contents = new Buffer(restored.contents.data);
		} else
		if (Array.isArray(restored.contents)) {
			restored.contents = new Buffer(restored.contents);
		} else
		if (typeof restored.contents === 'string') {
			restored.contents = new Buffer(restored.contents, 'base64');
		}
	}

	const restoredFile = new File(restored);

	// Restore any properties that the original task put on the file;
	// but omit the normal properties of the file
	Object.keys(restored).forEach((key) => {

		if (File.isCustomProp(key)) {
			restoredFile[key] = restored[key];
		}
	});

	return restoredFile;
}

function defaultValue(file) {
	// Convert from a File object (from vinyl) into a plain object
	return pick(file, ['cwd', 'base', 'contents', 'stat', 'history', 'path']);
}

const defaultOptions = {
	fileCache,
	name:    'default',
	success: true,
	key:     defaultKey,
	restore: defaultRestore,
	value:   defaultValue
};

plugin.Cache = Cache;
plugin.fileCache = fileCache;
plugin.defaultOptions = defaultOptions;

export default function plugin(task, inputOptions) {
	// Check for required task option
	if (!task) {
		throw new PluginError('gulp-cache', 'Must pass a task to cache()');
	}

	const options = {
		...plugin.defaultOptions,
		...task.cacheable,
		...inputOptions
	};

	const taskProxy = new TaskProxy(task, options);

	function each(file, enc, next) {

		if (file.isNull()) {
			next(null, file);
			return;
		}

		if (file.isStream()) {
			next(new PluginError('gulp-cache', 'Cannot operate on stream sources'));
			return;
		}

		const signals = taskProxy.processFile(file);

		signals.on('error', (err) => {
			next(new PluginError('gulp-cache', err));
		});

		signals.on('file', (file) => {
			this.push(file.clone());
		});

		signals.on('done', () => {
			next(null);
		});
	}

	function flush(next) {
		taskProxy.flush(next);
	}

	return through.obj(each, flush);
}

plugin.clear =
function clear(inputOptions) {

	const options = {
		...plugin.defaultOptions,
		...inputOptions
	};

	const taskProxy = new TaskProxy(null, options);

	async function each(file, enc, next) {

		if (file.isNull()) {
			next(null, file);
			return;
		}

		if (file.isStream()) {
			next(new PluginError('gulp-cache', 'Cannot operate on stream sources'));
			return;
		}

		try {
			await taskProxy.removeCachedResult();
			next(null, file);
			return;
		} catch (err) {
			next(new PluginError('gulp-cache', err));
			return;
		}
	}

	return through.obj(each);
};

plugin.clearAll =
function clearAll() {
	return new Promise((resolve, reject) => {
		fileCache.clear(null, (err) => {

			if (err) {
				reject(new PluginError(
					'gulp-cache',
					`Problem clearing the cache: ${err.message}`
				));
				return;
			}

			resolve();
		});
	});
};
